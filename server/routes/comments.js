/**
 * Comments / Feedback module (separate from Task management).
 * Stores INTERNAL feedback prompts, test scenarios and private feedback categories.
 * It does NOT hand out scripted public-review text (platform policy, see requirements doc §5/§6).
 */
const express = require('express');
const { db, FieldValue, admin } = require('../config/firebase');
const { fetchAll, SUB_LIGHT, USER_LIGHT } = require('../utils/db');
const { requirePerm } = require('../middleware/auth');
const { asyncHandler, HttpError, paginate, toMillis, str, lc } = require('../utils/helpers');
const { audit } = require('../utils/audit');

const router = express.Router();
const CATEGORIES = ['feedback_prompt', 'test_scenario', 'private_feedback'];
const STATUSES = ['active', 'archived'];

const shape = (c) => ({
  id: c.id, text: c.text || '', taskId: c.taskId || '', appName: c.appName || '', category: c.category || 'feedback_prompt',
  status: c.status || 'active', usageCount: Number(c.usageCount || 0), createdAt: toMillis(c.createdAt), createdBy: c.createdBy?.email || '',
});

async function taskInfo(taskId) {
  if (!taskId) return { taskId: '', appName: '' };
  const s = await db.collection('tasks').doc(taskId).get();
  if (!s.exists) throw new HttpError(400, 'Selected task does not exist');
  return { taskId, appName: s.data().appName || s.data().title || '' };
}

/* ---------------- Prompts ---------------- */
router.get('/', requirePerm('comments.read'), asyncHandler(async (req, res) => {
  const all = (await fetchAll('feedbackPrompts')).map(shape);
  const q = lc(req.query.q);
  let list = all;
  if (req.query.status && req.query.status !== 'all') list = list.filter((c) => c.status === req.query.status);
  if (req.query.taskId) list = list.filter((c) => c.taskId === req.query.taskId);
  if (req.query.category && req.query.category !== 'all') list = list.filter((c) => c.category === req.query.category);
  if (q) list = list.filter((c) => `${c.text} ${c.id} ${c.appName} ${c.status}`.toLowerCase().includes(q));
  list.sort((a, b) => b.createdAt - a.createdAt);
  res.json({ ...paginate(list, req.query, 20), counts: { all: all.length, active: all.filter((c) => c.status === 'active').length } });
}));

router.post('/', requirePerm('comments.write'), asyncHandler(async (req, res) => {
  const text = str(req.body?.text, 600);
  if (text.length < 3) throw new HttpError(400, 'Write at least 3 characters');
  const category = CATEGORIES.includes(req.body.category) ? req.body.category : 'feedback_prompt';
  const info = await taskInfo(str(req.body.taskId, 60));
  const ref = db.collection('feedbackPrompts').doc();
  const doc = { id: ref.id, text, ...info, category, status: 'active', usageCount: 0, createdBy: { uid: req.admin.uid, email: req.admin.email }, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() };
  await ref.set(doc);
  await audit(req, 'comment.create', { type: 'feedbackPrompt', id: ref.id }, null, { text, taskId: info.taskId });
  res.status(201).json({ id: ref.id });
}));

// Bulk paste / import
router.post('/bulk', requirePerm('comments.write'), asyncHandler(async (req, res) => {
  const lines = (Array.isArray(req.body?.lines) ? req.body.lines : String(req.body?.text || '').split('\n'))
    .map((l) => str(l, 600)).filter((l) => l.length >= 3);
  if (!lines.length) throw new HttpError(400, 'Nothing to import. Put one entry per line.');
  if (lines.length > 500) throw new HttpError(400, 'Import up to 500 lines at a time');
  const category = CATEGORIES.includes(req.body.category) ? req.body.category : 'feedback_prompt';
  const info = await taskInfo(str(req.body.taskId, 60));
  const existing = new Set((await fetchAll('feedbackPrompts', { select: ['text', 'taskId'] }))
    .filter((c) => (c.taskId || '') === info.taskId).map((c) => lc(c.text)));
  const seen = new Set();
  const fresh = [];
  let skipped = 0;
  lines.forEach((l) => {
    const k = lc(l);
    if (existing.has(k) || seen.has(k)) { skipped += 1; return; }
    seen.add(k); fresh.push(l);
  });
  for (let i = 0; i < fresh.length; i += 400) {
    const batch = db.batch();
    fresh.slice(i, i + 400).forEach((text) => {
      const ref = db.collection('feedbackPrompts').doc();
      batch.set(ref, { id: ref.id, text, ...info, category, status: 'active', usageCount: 0, createdBy: { uid: req.admin.uid, email: req.admin.email }, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    });
    await batch.commit();
  }
  await audit(req, 'comment.bulk_import', { type: 'feedbackPrompt', id: info.taskId || 'general' }, null, { created: fresh.length, skipped });
  res.json({ created: fresh.length, skipped });
}));

/* ---------------- User restrictions (per task) ---------------- */
async function loadTask(taskId) {
  const ref = db.collection('tasks').doc(taskId);
  const s = await ref.get();
  if (!s.exists) throw new HttpError(404, 'Task not found');
  return { ref, data: s.data() };
}

router.get('/restrictions/:taskId', requirePerm('comments.read'), asyncHandler(async (req, res) => {
  const { data } = await loadTask(req.params.taskId);
  const ids = data.blockedUserIds || [];
  const users = ids.length ? (await fetchAll('users', { select: USER_LIGHT })).filter((u) => ids.includes(u.id)) : [];
  const byId = Object.fromEntries(users.map((u) => [u.id, u]));
  res.json({ taskId: req.params.taskId, title: data.title || data.appName, users: ids.map((id) => ({ id, name: byId[id]?.fullName || '', email: byId[id]?.email || '' })) });
}));

// Users who already completed this app (same package id) - candidates to exclude from a fresh task
router.get('/restrictions/:taskId/completed', requirePerm('comments.read'), asyncHandler(async (req, res) => {
  const { data } = await loadTask(req.params.taskId);
  const appId = data.appId || data.packageName;
  const tasks = await fetchAll('tasks', { select: ['appId', 'packageName', 'title'] });
  const sameApp = new Set(tasks.filter((t) => (appId && (t.appId || t.packageName) === appId) || t.id === req.params.taskId).map((t) => t.id));
  const subs = (await fetchAll('submissions', { select: SUB_LIGHT })).filter((s) => sameApp.has(s.taskId) && lc(s.status) === 'approved');
  const blocked = new Set(data.blockedUserIds || []);
  const map = new Map();
  subs.forEach((s) => { if (s.userId && !map.has(s.userId)) map.set(s.userId, { id: s.userId, name: s.userName || s.userEmail || '', blocked: blocked.has(s.userId) }); });
  res.json({ users: [...map.values()] });
}));

async function changeBlock(req, res, block) {
  const ids = [...new Set((req.body?.userIds || []).map((x) => str(x, 80)).filter(Boolean))];
  if (!ids.length) throw new HttpError(400, 'Select at least one user');
  if (ids.length > 500) throw new HttpError(400, 'Up to 500 users at a time');
  if (Number(req.body.confirmCount) !== ids.length) throw new HttpError(400, 'Please confirm the number of selected users', 'CONFIRM_MISMATCH');
  const { ref, data } = await loadTask(req.params.taskId);
  const op = block ? FieldValue.arrayUnion(...ids) : FieldValue.arrayRemove(...ids);
  await ref.update({ blockedUserIds: op, updatedAt: FieldValue.serverTimestamp() });
  await db.collection('offers').doc(ref.id).set({ blockedUserIds: op }, { merge: true }).catch(() => {});
  await audit(req, block ? 'comment.restrict_users' : 'comment.unrestrict_users', { type: 'task', id: ref.id }, { blockedBefore: (data.blockedUserIds || []).length }, { changed: ids.length, userIds: ids.slice(0, 50) });
  res.json({ ok: true, changed: ids.length });
}
router.post('/restrictions/:taskId/block', requirePerm('comments.write'), asyncHandler((req, res) => changeBlock(req, res, true)));
router.post('/restrictions/:taskId/unblock', requirePerm('comments.write'), asyncHandler((req, res) => changeBlock(req, res, false)));

/* ---------------- Single prompt ---------------- */
router.put('/:id', requirePerm('comments.write'), asyncHandler(async (req, res) => {
  const ref = db.collection('feedbackPrompts').doc(req.params.id);
  const s = await ref.get();
  if (!s.exists) throw new HttpError(404, 'Entry not found');
  const patch = { updatedAt: FieldValue.serverTimestamp() };
  if (req.body.text != null) { const t = str(req.body.text, 600); if (t.length < 3) throw new HttpError(400, 'Write at least 3 characters'); patch.text = t; }
  if (req.body.status != null) { if (!STATUSES.includes(req.body.status)) throw new HttpError(400, 'Invalid status'); patch.status = req.body.status; }
  if (req.body.category != null && CATEGORIES.includes(req.body.category)) patch.category = req.body.category;
  if (req.body.taskId != null) Object.assign(patch, await taskInfo(str(req.body.taskId, 60)));
  await ref.update(patch);
  await audit(req, 'comment.update', { type: 'feedbackPrompt', id: ref.id }, { text: s.data().text, status: s.data().status }, { text: patch.text, status: patch.status });
  res.json({ ok: true });
}));

router.delete('/:id', requirePerm('comments.write'), asyncHandler(async (req, res) => {
  const ref = db.collection('feedbackPrompts').doc(req.params.id);
  const s = await ref.get();
  if (!s.exists) throw new HttpError(404, 'Entry not found');
  await ref.delete();
  await audit(req, 'comment.delete', { type: 'feedbackPrompt', id: ref.id }, { text: s.data().text }, null);
  res.json({ ok: true });
}));

// Which submissions reference this entry (if any)
router.get('/:id/usage', requirePerm('comments.read'), asyncHandler(async (req, res) => {
  const snap = await db.collection('submissions').where('feedbackPromptId', '==', req.params.id).select(...SUB_LIGHT).limit(100).get();
  res.json({ items: snap.docs.map((d) => { const s = d.data(); return { submissionId: d.id, userId: s.userId || '', userName: s.userName || '', taskTitle: s.taskTitle || '', status: s.status || 'pending', at: toMillis(s.createdAt) }; }) });
}));

module.exports = router;
