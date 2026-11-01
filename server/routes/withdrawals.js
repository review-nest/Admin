const express = require('express');
const { db, FieldValue } = require('../config/firebase');
const { fetchAll, WD_FIELDS } = require('../utils/db');
const { requirePerm, requireRecentAuth, can } = require('../middleware/auth');
const { asyncHandler, HttpError, paginate, parseRange, toMillis, num, str, lc, maskAccount, maskUpi } = require('../utils/helpers');
const { audit } = require('../utils/audit');
const { st, paidTime } = require('../services/stats');

const router = express.Router();
// 'approved' is what the existing mobile app already uses for "paid", so we keep it.
const FOLDERS = { pending: ['pending'], processing: ['processing'], paid: ['approved', 'paid', 'completed'], rejected: ['rejected'] };
const folderOf = (w) => Object.keys(FOLDERS).find((f) => FOLDERS[f].includes(st(w.status))) || 'pending';
const methodOf = (w) => (w.method ? lc(w.method) === 'upi' ? 'UPI' : 'Bank' : w.upiId ? 'UPI' : 'Bank');

function shape(w, canSee, dupKeys) {
  return {
    id: w.id, userId: w.userId || '', userName: w.userName || w.userEmail || 'User', amount: num(w.amount),
    status: st(w.status), folder: folderOf(w), method: methodOf(w), requestedAt: toMillis(w.createdAt),
    // sensitive details are masked by default for everyone
    upi: w.upiId ? maskUpi(w.upiId) : '',
    bank: w.accountNumber ? { holder: canSee ? w.accountHolderName || '' : '', bankName: w.bankName || '', account: maskAccount(w.accountNumber), ifsc: canSee ? w.ifscCode || '' : '' } : null,
    canReveal: canSee,
    transactionRef: w.transactionRef || w.utrNumber || '', paidAmount: w.paidAmount ?? (folderOf(w) === 'paid' ? num(w.amount) : null),
    paidAt: folderOf(w) === 'paid' ? paidTime(w) || null : null, processedBy: w.processedBy?.email || w.processedBy || '',
    reason: w.rejectionReason || (folderOf(w) === 'rejected' ? w.adminNote : '') || '',
    flags: dupKeys.has(`${w.userId}|${num(w.amount)}`) && ['pending', 'processing'].includes(st(w.status)) ? ['Another open request with the same amount'] : [],
  };
}

router.get('/', requirePerm('withdrawals.read'), asyncHandler(async (req, res) => {
  const all = await fetchAll('withdrawals', { select: WD_FIELDS });
  const canSee = can(req.admin.role, 'withdrawals.sensitive');
  const { fromMs, toMs } = parseRange(req.query);
  const q = lc(req.query.q);
  const method = req.query.method;

  const open = all.filter((w) => ['pending', 'processing'].includes(st(w.status)));
  const seen = {}; const dupKeys = new Set();
  open.forEach((w) => { const k = `${w.userId}|${num(w.amount)}`; seen[k] = (seen[k] || 0) + 1; if (seen[k] > 1) dupKeys.add(k); });

  let list = all.filter((w) => {
    const at = folderOf(w) === 'paid' && (req.query.by === 'paid') ? paidTime(w) : toMillis(w.createdAt);
    return at >= fromMs && at < toMs;
  });
  if (method === 'upi' || method === 'bank') list = list.filter((w) => lc(methodOf(w)) === method);
  if (q) list = list.filter((w) => `${w.id} ${w.userId || ''} ${w.userName || ''} ${w.transactionRef || w.utrNumber || ''}`.toLowerCase().includes(q));

  const counts = { pending: 0, processing: 0, paid: 0, rejected: 0 };
  const amounts = { pending: 0, processing: 0, paid: 0, rejected: 0 };
  list.forEach((w) => { const f = folderOf(w); counts[f] += 1; amounts[f] += num(w.paidAmount ?? w.amount); });

  const folder = FOLDERS[req.query.folder] ? req.query.folder : 'pending';
  const rows = list.filter((w) => folderOf(w) === folder).sort((a, b) => (folder === 'paid' ? paidTime(b) - paidTime(a) : toMillis(b.createdAt) - toMillis(a.createdAt)));
  res.json({ ...paginate(rows.map((w) => shape(w, canSee, dupKeys)), req.query, 20), folder, counts, amounts });
}));

// Reveal full payment details: Payout/Super admin, fresh login, always audited.
router.get('/:id/reveal', requirePerm('withdrawals.sensitive'), requireRecentAuth, asyncHandler(async (req, res) => {
  const s = await db.collection('withdrawals').doc(req.params.id).get();
  if (!s.exists) throw new HttpError(404, 'Withdrawal not found');
  const w = s.data();
  await audit(req, 'withdrawal.reveal_details', { type: 'withdrawal', id: s.id }, null, null, 'Viewed full payment details');
  res.json({ upiId: w.upiId || '', accountHolderName: w.accountHolderName || '', bankName: w.bankName || '', accountNumber: w.accountNumber || '', ifscCode: w.ifscCode || '' });
}));

router.post('/:id/processing', requirePerm('withdrawals.write'), asyncHandler(async (req, res) => {
  const ref = db.collection('withdrawals').doc(req.params.id);
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw new HttpError(404, 'Withdrawal not found');
    if (st(s.data().status) !== 'pending') throw new HttpError(409, 'Only pending requests can be moved to processing', 'BAD_STATE');
    tx.update(ref, { status: 'processing', processedBy: { uid: req.admin.uid, email: req.admin.email }, updatedAt: FieldValue.serverTimestamp() });
  });
  await audit(req, 'withdrawal.processing', { type: 'withdrawal', id: ref.id }, { status: 'pending' }, { status: 'processing' });
  res.json({ ok: true });
}));

router.post('/:id/paid', requirePerm('withdrawals.write'), requireRecentAuth, asyncHandler(async (req, res) => {
  const ref = db.collection('withdrawals').doc(req.params.id);
  const txnRef = str(req.body?.transactionRef, 80);
  if (txnRef.length < 4) throw new HttpError(400, 'Enter the transaction / UTR reference (at least 4 characters)');
  const dup = await db.collection('payoutTransactions').where('transactionRef', '==', txnRef).limit(1).get();
  if (!dup.empty && dup.docs[0].data().withdrawalId !== ref.id) throw new HttpError(409, 'This transaction reference was already used for another payout', 'DUPLICATE_REF');
  const paidAt = req.body.paidAt ? new Date(req.body.paidAt).getTime() : Date.now();
  if (Number.isNaN(paidAt) || paidAt > Date.now() + 5 * 60000) throw new HttpError(400, 'Payment date is not valid');

  const out = await db.runTransaction(async (tx) => { // transaction = lock against double processing
    const s = await tx.get(ref);
    if (!s.exists) throw new HttpError(404, 'Withdrawal not found');
    const w = s.data();
    if (!['pending', 'processing'].includes(st(w.status))) throw new HttpError(409, `This request is already ${st(w.status)}`, 'BAD_STATE');
    const paidAmount = req.body.paidAmount != null ? num(req.body.paidAmount) : num(w.amount);
    if (!(paidAmount > 0) || paidAmount > num(w.amount)) throw new HttpError(400, 'Paid amount must be more than 0 and not above the requested amount');
    const who = { uid: req.admin.uid, email: req.admin.email };
    const patch = { status: 'approved', transactionRef: txnRef, utrNumber: txnRef, paidAmount, paidAt: new Date(paidAt), processedAt: FieldValue.serverTimestamp(), processedBy: who, adminNote: `Paid (ref ${txnRef})`, updatedAt: FieldValue.serverTimestamp() };
    tx.update(ref, patch);
    if (w.userId) tx.set(db.collection('users').doc(w.userId).collection('withdrawals').doc(ref.id), { status: 'approved', utrNumber: txnRef, transactionRef: txnRef, adminNote: patch.adminNote, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    const pt = db.collection('payoutTransactions').doc();
    tx.set(pt, { id: pt.id, withdrawalId: ref.id, userId: w.userId || '', amount: paidAmount, method: w.upiId ? 'UPI' : 'Bank', transactionRef: txnRef, paidAt: new Date(paidAt), processedBy: who, createdAt: FieldValue.serverTimestamp() });
    return { amount: w.amount, userId: w.userId, paidAmount };
  });
  await audit(req, 'withdrawal.paid', { type: 'withdrawal', id: ref.id }, { status: 'pending' }, { status: 'paid', transactionRef: txnRef, paidAmount: out.paidAmount });
  res.json({ ok: true });
}));

router.post('/:id/reject', requirePerm('withdrawals.write'), requireRecentAuth, asyncHandler(async (req, res) => {
  const reason = str(req.body?.reason, 300);
  if (reason.length < 3) throw new HttpError(400, 'A rejection reason is required (the user will see it)');
  const ref = db.collection('withdrawals').doc(req.params.id);
  const out = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw new HttpError(404, 'Withdrawal not found');
    const w = s.data();
    if (!['pending', 'processing'].includes(st(w.status))) throw new HttpError(409, `This request is already ${st(w.status)}`, 'BAD_STATE');
    const amount = num(w.amount);
    let userRef = null; let uSnap = null;
    if (w.userId) { userRef = db.collection('users').doc(w.userId); uSnap = await tx.get(userRef); }
    tx.update(ref, { status: 'rejected', rejectionReason: reason, adminNote: reason, processedBy: { uid: req.admin.uid, email: req.admin.email }, updatedAt: FieldValue.serverTimestamp() });
    if (w.userId) tx.set(db.collection('users').doc(w.userId).collection('withdrawals').doc(ref.id), { status: 'rejected', adminNote: reason, rejectionReason: reason, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    if (uSnap && uSnap.exists) { // refund exactly once (guarded by the status check above)
      const bal = num(uSnap.data().walletBalance);
      tx.update(userRef, { walletBalance: bal + amount, updatedAt: FieldValue.serverTimestamp() });
      const led = userRef.collection('transactions').doc();
      tx.set(led, { ledgerId: led.id, userId: w.userId, amount, direction: 'credit', type: 'withdrawal_refund', note: `Withdrawal rejected: ${reason}`, withdrawalId: ref.id, balanceAfter: bal + amount, adminUid: req.admin.uid, createdAt: FieldValue.serverTimestamp() });
    }
    return { amount };
  });
  await audit(req, 'withdrawal.reject', { type: 'withdrawal', id: ref.id }, { status: 'pending' }, { status: 'rejected', refunded: out.amount }, reason);
  res.json({ ok: true });
}));

module.exports = router;
