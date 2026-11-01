const express = require('express');
const { db, FieldValue } = require('../config/firebase');
const { fetchAll, SUB_LIGHT, USER_LIGHT, WD_FIELDS } = require('../utils/db');
const { requirePerm, requireRecentAuth, can } = require('../middleware/auth');
const { asyncHandler, HttpError, paginate, parseRange, toMillis, num, str, lc, maskUpi, maskAccount } = require('../utils/helpers');
const { audit } = require('../utils/audit');
const { lastActive, isOnline, st, subTime } = require('../services/stats');

const router = express.Router();

const accountStatus = (u) => u.accountStatus || (u.isBanned ? 'blocked' : 'active');

function shape(u, now = Date.now()) {
  const online = isOnline(u, now);
  return {
    id: u.id, name: u.fullName || 'User', email: u.email || '', phone: u.phone || '',
    status: accountStatus(u), banReason: u.banReason || '', balance: num(u.walletBalance), tasksDone: num(u.completedTasksCount),
    registeredAt: toMillis(u.createdAt), lastActiveAt: lastActive(u) || null,
    // "Live" is only shown when a real heartbeat exists; otherwise we show last seen.
    presence: online ? 'live' : 'lastSeen',
  };
}

router.get('/', requirePerm('users.read'), asyncHandler(async (req, res) => {
  const users = await fetchAll('users', { select: USER_LIGHT });
  const now = Date.now();
  const q = lc(req.query.q);
  const { fromMs, toMs } = parseRange({ from: req.query.regFrom, to: req.query.regTo });
  let upiIds = null;
  if (q && q.includes('@') && can(req.admin.role, 'withdrawals.sensitive')) {
    // UPI search is restricted to roles that may see payment data
    const wds = await fetchAll('withdrawals', { select: ['userId', 'upiId'] });
    upiIds = new Set(wds.filter((w) => lc(w.upiId) === q || lc(w.upiId).includes(q)).map((w) => w.userId));
  }
  let list = users.map((u) => shape(u, now));
  if (q) list = list.filter((u) => `${u.id} ${u.name} ${u.email}`.toLowerCase().includes(q) || (upiIds && upiIds.has(u.id)));
  if (req.query.status && req.query.status !== 'all') list = list.filter((u) => u.status === req.query.status);
  if (req.query.minBal) list = list.filter((u) => u.balance >= num(req.query.minBal));
  if (req.query.maxBal) list = list.filter((u) => u.balance <= num(req.query.maxBal));
  list = list.filter((u) => u.registeredAt >= fromMs && u.registeredAt < toMs);
  const sort = req.query.sort || 'recent';
  list.sort((a, b) => (sort === 'balance' ? b.balance - a.balance : sort === 'active' ? (b.lastActiveAt || 0) - (a.lastActiveAt || 0) : b.registeredAt - a.registeredAt));
  res.json({ ...paginate(list, req.query, 20), liveCount: list.filter((u) => u.presence === 'live').length });
}));

router.get('/:id', requirePerm('users.read'), asyncHandler(async (req, res) => {
  const uref = db.collection('users').doc(req.params.id);
  const snap = await uref.get();
  if (!snap.exists) throw new HttpError(404, 'User not found');
  const user = { id: snap.id, ...snap.data() };
  const sensitive = can(req.admin.role, 'withdrawals.sensitive');

  const [subSnap, wdSnap, ledSnap, decisions, audits] = await Promise.all([
    db.collection('submissions').where('userId', '==', snap.id).select(...SUB_LIGHT).limit(300).get(),
    db.collection('withdrawals').where('userId', '==', snap.id).select(...WD_FIELDS).limit(200).get(),
    uref.collection('transactions').limit(300).get(),
    fetchAll('approvalDecisions', { where: [['userId', '==', snap.id]] }),
    fetchAll('auditLogs', { where: [['targetId', '==', snap.id]] }),
  ]);
  const subs = subSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => subTime(b) - subTime(a));
  const wds = wdSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
  const ledger = ledSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));

  res.json({
    profile: shape(user),
    stats: {
      submissions: subs.length, approved: subs.filter((s) => st(s.status) === 'approved').length,
      rejected: subs.filter((s) => st(s.status) === 'rejected').length, pending: subs.filter((s) => st(s.status) === 'pending').length,
      withdrawals: wds.length, withdrawn: wds.filter((w) => ['approved', 'paid', 'completed'].includes(st(w.status))).reduce((a, w) => a + num(w.amount), 0),
    },
    submissions: subs.slice(0, 100).map((s) => ({ id: s.id, taskId: s.taskId || '', taskTitle: s.taskTitle || '', status: st(s.status), reward: num(s.rewardAmount), at: subTime(s), reason: s.rejectionReason || s.adminNote || '' })),
    withdrawals: wds.map((w) => ({
      id: w.id, amount: num(w.amount), status: st(w.status), at: toMillis(w.createdAt), transactionRef: w.transactionRef || w.utrNumber || '',
      method: w.upiId ? 'UPI' : 'Bank', destination: w.upiId ? (sensitive ? maskUpi(w.upiId) : '••••') : maskAccount(w.accountNumber),
    })),
    ledger: ledger.slice(0, 150).map((l) => ({
      id: l.ledgerId || l.id, amount: num(l.amount), direction: l.direction || (['admin_deduct', 'withdrawal', 'task_reward_reversal'].includes(l.type) ? 'debit' : 'credit'),
      type: l.type || '', note: l.note || '', linked: l.submissionId || l.withdrawalId || '', at: toMillis(l.createdAt), balanceAfter: l.balanceAfter ?? null,
    })),
    activity: [
      ...decisions.map((d) => ({ at: toMillis(d.atMs), text: `${d.decision} · ${d.taskTitle || ''}`, by: d.adminEmail })),
      ...audits.map((a) => ({ at: toMillis(a.atMs), text: a.action + (a.note ? ` · ${a.note}` : ''), by: a.adminEmail })),
    ].sort((a, b) => b.at - a.at).slice(0, 50),
  });
}));

router.post('/:id/status', requirePerm('users.write'), asyncHandler(async (req, res) => {
  const status = req.body?.status;
  if (!['active', 'blocked', 'suspended'].includes(status)) throw new HttpError(400, 'Status must be active, blocked or suspended');
  const reason = str(req.body.reason, 300);
  if (status !== 'active' && reason.length < 3) throw new HttpError(400, 'A reason is required to block or suspend a user');
  const ref = db.collection('users').doc(req.params.id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpError(404, 'User not found');
  const before = accountStatus(snap.data());
  await ref.update({
    accountStatus: status, isBanned: status !== 'active', banReason: status === 'active' ? '' : reason,
    statusChangedAt: FieldValue.serverTimestamp(), statusChangedBy: req.admin.uid, updatedAt: FieldValue.serverTimestamp(),
  });
  await audit(req, `user.${status === 'active' ? 'unblock' : status === 'blocked' ? 'block' : 'suspend'}`, { type: 'user', id: ref.id }, { status: before }, { status }, reason);
  res.json({ ok: true });
}));

// Manual wallet adjustment: Super Admin only, fresh login, mandatory reason, ledger + audit.
router.post('/:id/wallet', requirePerm('*'), requireRecentAuth, asyncHandler(async (req, res) => {
  const type = req.body?.type;
  if (!['credit', 'debit'].includes(type)) throw new HttpError(400, 'Type must be credit or debit');
  const amount = Math.round(num(req.body.amount) * 100) / 100;
  if (!(amount > 0) || amount > 100000) throw new HttpError(400, 'Amount must be between ₹1 and ₹1,00,000');
  const reason = str(req.body.reason, 300);
  if (reason.length < 5) throw new HttpError(400, 'Write a reason (at least 5 characters)');
  const ref = db.collection('users').doc(req.params.id);
  const out = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw new HttpError(404, 'User not found');
    const bal = num(s.data().walletBalance);
    if (type === 'debit' && amount > bal) throw new HttpError(400, `Balance is only ₹${bal}. A debit cannot exceed it.`);
    const newBal = type === 'credit' ? bal + amount : bal - amount;
    tx.update(ref, { walletBalance: newBal, updatedAt: FieldValue.serverTimestamp() });
    const led = ref.collection('transactions').doc();
    tx.set(led, { ledgerId: led.id, userId: ref.id, amount, direction: type, type: type === 'credit' ? 'admin_credit' : 'admin_deduct', note: reason, balanceAfter: newBal, adminUid: req.admin.uid, createdAt: FieldValue.serverTimestamp() });
    return { before: bal, after: newBal, ledgerId: led.id };
  });
  await audit(req, 'wallet.adjust', { type: 'user', id: ref.id }, { balance: out.before }, { balance: out.after, type, amount, ledgerId: out.ledgerId }, reason);
  res.json({ ok: true, ...out });
}));

module.exports = router;
