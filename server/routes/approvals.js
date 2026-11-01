const express = require('express');
const crypto = require('crypto');
const archiver = require('archiver');
const { db, FieldValue } = require('../config/firebase');
const { fetchAll, SUB_LIGHT, TASK_LIGHT } = require('../utils/db');
const { requirePerm, requireRecentAuth } = require('../middleware/auth');
const { asyncHandler, HttpError, paginate, parseRange, toMillis, num, str, lc, escapeCsv } = require('../utils/helpers');
const { audit } = require('../utils/audit');
const { subTime, decisionTime, st } = require('../services/stats');

const router = express.Router();
const taskKey = (s) => (s.taskId || 'general');
const icon = (t) => (t && (t.iconUrl || t.appIcon || '')) || '';

/* ------------------------------------------------------------------ groups */
router.get('/groups', requirePerm('approvals.read'), asyncHandler(async (req, res) => {
  const { fromMs, toMs } = parseRange(req.query);
  const status = ['pending', 'approved', 'rejected', 'all'].includes(req.query.status) ? req.query.status : 'pending';
  const [subs, tasks] = await Promise.all([fetchAll('submissions', { select: SUB_LIGHT }), fetchAll('tasks', { select: TASK_LIGHT })]);
  const tmap = Object.fromEntries(tasks.map((t) => [t.id, t]));
  const groups = new Map();
  subs.forEach((s) => {
    const at = subTime(s);
    if (at < fromMs || at >= toMs) return;
    const k = taskKey(s);
    if (!groups.has(k)) {
      const t = tmap[k];
      groups.set(k, {
        taskId: k, title: s.taskTitle || t?.title || 'Untitled task', appName: t?.appName || s.taskTitle || '', iconUrl: icon(t),
        reward: num(t?.rewardInr ?? t?.rewardAmount ?? s.rewardAmount), counts: { pending: 0, approved: 0, rejected: 0, total: 0 },
        firstAt: at, lastAt: at,
      });
    }
    const g = groups.get(k);
    const x = st(s.status);
    g.counts[x === 'approved' ? 'approved' : x === 'rejected' ? 'rejected' : 'pending'] += 1;
    g.counts.total += 1;
    g.firstAt = Math.min(g.firstAt, at); g.lastAt = Math.max(g.lastAt, at);
  });
  let list = [...groups.values()];
  if (status !== 'all') list = list.filter((g) => g.counts[status] > 0);
  list.forEach((g) => { g.proofCount = status === 'all' ? g.counts.total : g.counts[status]; });
  list.sort((a, b) => b.lastAt - a.lastAt);
  const totals = { pending: 0, approved: 0, rejected: 0 };
  [...groups.values()].forEach((g) => { totals.pending += g.counts.pending; totals.approved += g.counts.approved; totals.rejected += g.counts.rejected; });
  res.json({ groups: list, totals });
}));

/* ------------------------------------------------- submissions inside a group */
async function groupSubs(req) {
  const { fromMs, toMs } = parseRange(req.query);
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'all';
  const q = lc(req.query.q);
  const key = req.params.taskId;
  const all = (await fetchAll('submissions', { select: SUB_LIGHT })).filter((s) => taskKey(s) === key);
  const inRange = all.filter((s) => { const a = subTime(s); return a >= fromMs && a < toMs; });
  let list = inRange.filter((s) => status === 'all' || st(s.status) === status);
  if (q) list = list.filter((s) => `${s.id} ${s.userId || ''} ${s.userName || ''} ${s.userEmail || ''} ${s.proofText || ''}`.toLowerCase().includes(q));
  list.sort((a, b) => subTime(b) - subTime(a));
  return { all, inRange, list };
}

const sha = (b64) => crypto.createHash('sha256').update(b64.includes(',') ? b64.split(',')[1] : b64).digest('hex');

/** Make sure every item on the page has an imageHash saved (computed once, then cached on the doc). */
async function ensureHashes(items) {
  const missing = items.filter((s) => !s.imageHash);
  if (!missing.length) return;
  const refs = missing.map((s) => db.collection('submissions').doc(s.id));
  const snaps = await db.getAll(...refs, { fieldMask: ['screenshotBase64'] });
  const batch = db.batch();
  let n = 0;
  snaps.forEach((snap, i) => {
    const b64 = snap.exists ? snap.get('screenshotBase64') : '';
    if (b64) { missing[i].imageHash = sha(b64); batch.update(snap.ref, { imageHash: missing[i].imageHash }); n += 1; }
  });
  if (n) await batch.commit().catch(() => {});
}

function flagsFor(s, all) {
  const flags = [];
  if (s.imageHash && all.filter((x) => x.imageHash === s.imageHash && x.id !== s.id).length) flags.push('Same image used again');
  if (s.userId && all.filter((x) => x.userId === s.userId && x.id !== s.id).length) flags.push('Same user submitted again');
  const t = lc(s.proofText).replace(/\s+/g, ' ').trim();
  if (t.length >= 15 && all.some((x) => x.id !== s.id && x.userId !== s.userId && lc(x.proofText).replace(/\s+/g, ' ').trim() === t)) flags.push('Same text from other users');
  return flags;
}

router.get('/groups/:taskId/submissions', requirePerm('approvals.read'), asyncHandler(async (req, res) => {
  const { all, inRange, list } = await groupSubs(req);
  const page = paginate(list, req.query, 24);
  await ensureHashes(page.items);
  const tsnap = req.params.taskId === 'general' ? null : await db.collection('tasks').doc(req.params.taskId).get();
  const t = tsnap?.exists ? { id: tsnap.id, ...tsnap.data() } : null;
  const counts = { pending: 0, approved: 0, rejected: 0, total: inRange.length };
  inRange.forEach((s) => { const x = st(s.status); counts[x === 'approved' ? 'approved' : x === 'rejected' ? 'rejected' : 'pending'] += 1; });
  res.json({
    task: { id: req.params.taskId, title: t?.title || all[0]?.taskTitle || 'Task', appName: t?.appName || '', iconUrl: icon(t), reward: num(t?.rewardInr ?? t?.rewardAmount) },
    counts,
    ...page,
    items: page.items.map((s) => ({
      id: s.id, userId: s.userId || '', userName: s.userName || 'User', userEmail: s.userEmail || '', status: st(s.status),
      reward: num(s.rewardAmount), at: subTime(s), proofText: s.proofText || '', adminNote: s.adminNote || '', rejectionReason: s.rejectionReason || '',
      reviewedAt: toMillis(s.reviewedAt) || null, flags: flagsFor(s, all),
    })),
  });
}));

/* ------------------------------------------------------------------ images */
router.get('/submissions/:id/image', requirePerm('approvals.read'), asyncHandler(async (req, res) => {
  const snap = await db.collection('submissions').doc(req.params.id).get();
  if (!snap.exists) throw new HttpError(404, 'Submission not found');
  const d = snap.data();
  const b64 = d.screenshotBase64 || '';
  if (!b64) {
    const url = d.screenshotUrl || d.imageUrl || d.proofUrl || '';
    if (/^https:\/\//i.test(url)) return res.json({ url });
    throw new HttpError(404, 'No screenshot attached');
  }
  const m = b64.match(/^data:(image\/[a-z0-9.+-]+);base64,/i);
  const buf = Buffer.from(b64.includes(',') ? b64.split(',')[1] : b64, 'base64');
  res.set({ 'Content-Type': m ? m[1] : 'image/jpeg', 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' });
  res.send(buf);
}));

router.get('/submissions/:id', requirePerm('approvals.read'), asyncHandler(async (req, res) => {
  const snap = await db.collection('submissions').doc(req.params.id).select(...SUB_LIGHT).get();
  if (!snap.exists) throw new HttpError(404, 'Submission not found');
  const hist = (await fetchAll('approvalDecisions', { where: [['submissionId', '==', snap.id]] })).sort((a, b) => b.atMs - a.atMs);
  res.json({ id: snap.id, ...snap.data(), createdAt: toMillis(snap.data().createdAt), history: hist });
}));

/* --------------------------------------------------------------------- ZIP */
router.get('/groups/:taskId/zip', requirePerm('approvals.read'), asyncHandler(async (req, res) => {
  let { list } = await groupSubs(req);
  const only = String(req.query.ids || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (only.length) list = list.filter((s) => only.includes(s.id));
  if (!list.length) throw new HttpError(404, 'No proofs to download for this selection');
  if (list.length > 400) throw new HttpError(400, 'Too many proofs for one ZIP (limit 400). Narrow the date range or status.');
  await audit(req, 'approval.zip_download', { type: 'task', id: req.params.taskId }, null, { files: list.length });

  const safe = (v) => String(v || 'x').replace(/[^\w.-]+/g, '_').slice(0, 40);
  res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="proofs_${safe(req.params.taskId)}_${Date.now()}.zip"` });
  const archive = archiver('zip', { zlib: { level: 1 } });
  archive.on('error', (e) => { console.error('[zip]', e); res.destroy(e); });
  archive.pipe(res);

  const rows = ['submission_id,user_id,user_name,status,reward,submitted_at,file'];
  for (let i = 0; i < list.length; i += 20) {
    const chunk = list.slice(i, i + 20);
    const snaps = await db.getAll(...chunk.map((s) => db.collection('submissions').doc(s.id)), { fieldMask: ['screenshotBase64'] });
    snaps.forEach((snap, j) => {
      const s = chunk[j];
      const b64 = snap.exists ? snap.get('screenshotBase64') : '';
      let file = '(no screenshot)';
      if (b64) {
        const ext = (b64.match(/^data:image\/([a-z0-9+]+);/i) || [])[1] || 'jpg';
        file = `${st(s.status)}/${i + j + 1}_${safe(s.userName)}_${s.id.slice(0, 6)}.${ext === 'jpeg' ? 'jpg' : ext}`;
        archive.append(Buffer.from(b64.includes(',') ? b64.split(',')[1] : b64, 'base64'), { name: file });
      }
      rows.push([s.id, s.userId, s.userName, st(s.status), num(s.rewardAmount), new Date(subTime(s)).toISOString(), file].map(escapeCsv).join(','));
    });
  }
  archive.append(rows.join('\n'), { name: 'manifest.csv' });
  await archive.finalize();
}));

/* ------------------------------------------------------- decisions (single + bulk) */
function logDecision(tx, sub, id, decision, reason, reward, admin) {
  const ref = db.collection('approvalDecisions').doc();
  tx.set(ref, {
    id: ref.id, submissionId: id, taskId: sub.taskId || 'general', taskTitle: sub.taskTitle || '', userId: sub.userId || '',
    decision, reason: reason || '', reward, adminUid: admin.uid, adminEmail: admin.email, at: FieldValue.serverTimestamp(), atMs: Date.now(),
  });
}

async function approveOne(id, admin) {
  const subRef = db.collection('submissions').doc(id);
  return db.runTransaction(async (tx) => {
    const sSnap = await tx.get(subRef);
    if (!sSnap.exists) return { id, ok: false, error: 'Submission not found' };
    const s = sSnap.data();
    if (st(s.status) === 'approved') return { id, ok: false, error: 'Already approved' };
    if (!s.userId) return { id, ok: false, error: 'Submission has no user' };
    const userRef = db.collection('users').doc(s.userId);
    const uSnap = await tx.get(userRef);
    if (!uSnap.exists) return { id, ok: false, error: 'User not found - nothing to credit' };
    const reward = Math.max(0, num(s.rewardAmount));
    const bal = num(uSnap.data().walletBalance);
    tx.update(subRef, { status: 'approved', adminNote: 'Approved & credited', rejectionReason: FieldValue.delete(), reviewedBy: { uid: admin.uid, email: admin.email }, reviewedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    tx.update(userRef, { walletBalance: bal + reward, completedTasksCount: num(uSnap.data().completedTasksCount) + 1, updatedAt: FieldValue.serverTimestamp() });
    const led = userRef.collection('transactions').doc();
    tx.set(led, { ledgerId: led.id, userId: s.userId, amount: reward, direction: 'credit', type: 'task_reward', note: `Approved: ${s.taskTitle || 'Task'}`, submissionId: id, taskId: s.taskId || '', balanceAfter: bal + reward, adminUid: admin.uid, createdAt: FieldValue.serverTimestamp() });
    logDecision(tx, s, id, 'approved', '', reward, admin);
    return { id, ok: true };
  });
}

async function rejectOne(id, reason, admin, allowReverse) {
  const subRef = db.collection('submissions').doc(id);
  return db.runTransaction(async (tx) => {
    const sSnap = await tx.get(subRef);
    if (!sSnap.exists) return { id, ok: false, error: 'Submission not found' };
    const s = sSnap.data();
    const was = st(s.status);
    if (was === 'rejected') return { id, ok: false, error: 'Already rejected' };
    if (was === 'approved' && !allowReverse) return { id, ok: false, error: 'Already approved (needs a Super Admin reversal)' };
    let userRef = null; let uSnap = null;
    if (was === 'approved' && s.userId) { userRef = db.collection('users').doc(s.userId); uSnap = await tx.get(userRef); }
    const reward = Math.max(0, num(s.rewardAmount));
    tx.update(subRef, { status: 'rejected', adminNote: reason, rejectionReason: reason, reviewedBy: { uid: admin.uid, email: admin.email }, reviewedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    if (uSnap && uSnap.exists) {
      const bal = num(uSnap.data().walletBalance);
      const newBal = Math.max(0, bal - reward);
      tx.update(userRef, { walletBalance: newBal, completedTasksCount: Math.max(0, num(uSnap.data().completedTasksCount) - 1), updatedAt: FieldValue.serverTimestamp() });
      const led = userRef.collection('transactions').doc();
      tx.set(led, { ledgerId: led.id, userId: s.userId, amount: bal - newBal, direction: 'debit', type: 'task_reward_reversal', note: `Reward reversed: ${s.taskTitle || 'Task'} - ${reason}`, submissionId: id, taskId: s.taskId || '', balanceAfter: newBal, adminUid: admin.uid, createdAt: FieldValue.serverTimestamp() });
    }
    logDecision(tx, s, id, was === 'approved' ? 'reversed_to_rejected' : 'rejected', reason, reward, admin);
    return { id, ok: true };
  });
}

/**
 * Body: { action:'approve'|'reject', ids:[...], confirmCount, reason?, allowReverse? }
 * ONLY the listed ids are touched. Everything not listed stays exactly as it was (pending stays pending).
 */
router.post('/decide', requirePerm('approvals.write'), asyncHandler(async (req, res) => {
  const { action } = req.body || {};
  if (!['approve', 'reject'].includes(action)) throw new HttpError(400, 'Action must be approve or reject');
  const ids = [...new Set((req.body.ids || []).map((x) => str(x, 80)).filter(Boolean))];
  if (!ids.length) throw new HttpError(400, 'Select at least one submission');
  if (ids.length > 200) throw new HttpError(400, 'Up to 200 submissions at a time');
  if (Number(req.body.confirmCount) !== ids.length) throw new HttpError(400, 'Confirm the number of selected submissions', 'CONFIRM_MISMATCH');
  const reason = str(req.body.reason, 300);
  if (action === 'reject' && reason.length < 3) throw new HttpError(400, 'A rejection reason is required (the user will see it)');
  const allowReverse = req.body.allowReverse === true && req.admin.role === 'super_admin';
  if (allowReverse) await new Promise((ok, no) => requireRecentAuth(req, res, (e) => (e ? no(e) : ok())));

  const results = [];
  for (const id of ids) {
    // sequential on purpose: each decision is its own transaction, one failure never blocks the rest
    results.push(action === 'approve' ? await approveOne(id, req.admin) : await rejectOne(id, reason, req.admin, allowReverse));
  }
  const done = results.filter((r) => r.ok).length;
  await audit(req, `approval.${action}`, { type: 'submission', id: ids.length === 1 ? ids[0] : `${ids.length} items` }, null,
    { requested: ids.length, done, failed: ids.length - done, reason: reason || undefined, ids: ids.slice(0, 50) });
  res.json({ requested: ids.length, done, failed: ids.length - done, results });
}));

router.get('/history', requirePerm('approvals.read'), asyncHandler(async (req, res) => {
  let list = await fetchAll('approvalDecisions');
  if (req.query.submissionId) list = list.filter((d) => d.submissionId === req.query.submissionId);
  if (req.query.taskId) list = list.filter((d) => d.taskId === req.query.taskId);
  list.sort((a, b) => toMillis(b.atMs) - toMillis(a.atMs));
  res.json(paginate(list.map((d) => ({ id: d.id, submissionId: d.submissionId, taskTitle: d.taskTitle, userId: d.userId, decision: d.decision, reason: d.reason, reward: d.reward, adminEmail: d.adminEmail, at: toMillis(d.atMs) })), req.query, 20));
}));

module.exports = router;
