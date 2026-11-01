const express = require('express');
const { db, FieldValue } = require('../config/firebase');
const { fetchAll, SUB_LIGHT } = require('../utils/db');
const { requirePerm, requireRecentAuth } = require('../middleware/auth');
const { asyncHandler, HttpError, paginate, toMillis, num, str, lc, pick } = require('../utils/helpers');
const { audit } = require('../utils/audit');
const { parsePlayUrl, fetchMeta } = require('../services/playstore');

const router = express.Router();
const STATUSES = ['draft', 'active', 'paused', 'archived'];

// Compliance-friendly default (genuine feedback, no scripted review, no star-rating condition)
const DEFAULT_INSTRUCTIONS = [
  'Open the app using the provided Google Play Store link and install it, if you choose to test it.',
  'Explore the app and share your honest experience or feedback.',
  'Submit your own genuine feedback; do not copy a scripted review or promise a particular star rating.',
  'Upload the requested proof/screenshot before the task deadline, where applicable.',
];

const taskStatus = (t) => t.status || (t.active === false ? 'paused' : 'active');
const icon = (t) => t.iconUrl || t.appIcon || t.taskPfpBase64 || '';

function shape(t, stats) {
  return {
    id: t.id, title: t.title || t.appName || 'Untitled', appName: t.appName || t.title || '', iconUrl: icon(t),
    developer: t.developer || '', rating: t.appRating || t.rating || '', downloads: t.appDownloads || t.downloads || '',
    storeUrl: t.storeUrl || t.actionUrl || t.appLink || '', appId: t.appId || t.packageName || '',
    reward: num(t.rewardInr ?? t.rewardAmount ?? t.reward), durationMinutes: num(t.durationMinutes ?? t.timerMinutes, 15),
    deadlineAt: toMillis(t.deadlineAt) || null, taskCap: num(t.taskCap, 0), category: t.category || 'App',
    status: taskStatus(t), instructions: Array.isArray(t.instructions) ? t.instructions : [], description: t.description || '',
    blockedCount: (t.blockedUserIds || []).length,
    createdAt: toMillis(t.createdAt), updatedAt: toMillis(t.updatedAt),
    createdBy: t.createdBy?.email || '', updatedBy: t.updatedBy?.email || '',
    stats: stats || undefined,
  };
}

async function statsByTask() {
  const subs = await fetchAll('submissions', { select: ['taskId', 'status', 'rewardAmount'] });
  const m = new Map();
  subs.forEach((s) => {
    const k = s.taskId || 'general';
    if (!m.has(k)) m.set(k, { total: 0, pending: 0, approved: 0, rejected: 0, liability: 0, pendingExposure: 0 });
    const r = m.get(k);
    const st = lc(s.status || 'pending');
    r.total += 1;
    if (st === 'approved') { r.approved += 1; r.liability += num(s.rewardAmount); }
    else if (st === 'rejected') r.rejected += 1;
    else { r.pending += 1; r.pendingExposure += num(s.rewardAmount); }
  });
  return m;
}
const emptyStats = { total: 0, pending: 0, approved: 0, rejected: 0, liability: 0, pendingExposure: 0 };

router.get('/', requirePerm('tasks.read'), asyncHandler(async (req, res) => {
  const [tasks, stats] = await Promise.all([fetchAll('tasks'), statsByTask()]);
  const q = lc(req.query.q);
  const status = req.query.status || 'all';
  let list = tasks.map((t) => shape(t, stats.get(t.id) || emptyStats));
  if (status !== 'all') list = list.filter((t) => t.status === status);
  else list = list.filter((t) => t.status !== 'archived');
  if (q) list = list.filter((t) => `${t.title} ${t.appName} ${t.id} ${t.appId}`.toLowerCase().includes(q));
  list.sort((a, b) => b.createdAt - a.createdAt);
  res.json(paginate(list, req.query, 12));
}));

router.post('/fetch-meta', requirePerm('tasks.write'), asyncHandler(async (req, res) => {
  res.json(await fetchMeta(req.body?.url));
}));

router.get('/:id', requirePerm('tasks.read'), asyncHandler(async (req, res) => {
  const snap = await db.collection('tasks').doc(req.params.id).get();
  if (!snap.exists) throw new HttpError(404, 'Task not found');
  const stats = (await statsByTask()).get(snap.id) || emptyStats;
  res.json(shape({ id: snap.id, ...snap.data() }, stats));
}));

function buildFields(body, existing = {}) {
  const url = str(body.storeUrl, 400);
  let appId = existing.appId || '';
  if (url) appId = parsePlayUrl(url); // validates link
  const title = str(body.title || body.appName, 120);
  if (!title) throw new HttpError(400, 'Task title / app name is required');
  const reward = num(body.reward);
  if (!(reward > 0) || reward > 100000) throw new HttpError(400, 'Reward must be between ₹1 and ₹1,00,000');
  const duration = Math.round(num(body.durationMinutes, 15));
  if (duration < 1 || duration > 10080) throw new HttpError(400, 'Timer must be 1 to 10080 minutes');
  const status = STATUSES.includes(body.status) ? body.status : 'draft';
  const cap = Math.max(0, Math.round(num(body.taskCap, 0)));
  let deadlineAt = null;
  if (body.deadline) {
    const t = new Date(body.deadline).getTime();
    if (Number.isNaN(t)) throw new HttpError(400, 'Deadline date is not valid');
    deadlineAt = t;
  }
  let instructions = Array.isArray(body.instructions) ? body.instructions : String(body.instructions || '').split('\n');
  instructions = instructions.map((x) => str(x, 300)).filter(Boolean).slice(0, 20);
  if (!instructions.length) instructions = DEFAULT_INSTRUCTIONS;
  const iconUrl = str(body.iconUrl, 600);
  if (iconUrl && !/^https:\/\//i.test(iconUrl)) throw new HttpError(400, 'Icon must be an https:// image link');
  const active = status === 'active';
  return {
    title, appName: str(body.appName || title, 120), subtitle: url || `Earn reward · ${title}`,
    storeUrl: url, actionUrl: url, appLink: url, appId, packageName: appId,
    developer: str(body.developer, 120), appRating: str(body.rating, 10), rating: parseFloat(body.rating) || 0,
    appDownloads: str(body.downloads, 20), downloads: str(body.downloads, 20), installs: str(body.downloads, 20),
    iconUrl, appIcon: iconUrl, taskPfpBase64: iconUrl,
    category: str(body.category, 40) || 'App',
    rewardInr: reward, rewardAmount: reward, reward,
    durationMinutes: duration, timerMinutes: duration, deadlineAt, taskCap: cap,
    instructions, description: str(body.description, 1500) || instructions.join('\n'),
    proofRequirement: 'Upload the requested proof/screenshot',
    status, active, isActive: active, pausedByMaintenance: false,
  };
}

router.post('/', requirePerm('tasks.write'), asyncHandler(async (req, res) => {
  const f = buildFields(req.body || {});
  if (f.appId && !req.body.allowDuplicate) {
    const dups = (await fetchAll('tasks', { select: ['title', 'appId', 'packageName', 'status'] }))
      .filter((t) => (t.appId || t.packageName) === f.appId && t.status !== 'archived');
    if (dups.length) {
      throw new HttpError(409, `A task for this app already exists (${dups.map((d) => d.title).join(', ')}). Create another anyway?`, 'DUPLICATE_TASK');
    }
  }
  const ref = db.collection('tasks').doc(); // auto-generated Task ID
  const who = { uid: req.admin.uid, email: req.admin.email };
  const doc = {
    ...f, id: ref.id, taskId: ref.id, createdBy: who, updatedBy: who,
    // kept as empty arrays so the existing mobile app schema does not break; no scripted review text is generated
    comments: [], commentPool: [], commentItems: [], blockedUserIds: [],
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  };
  await ref.set(doc);
  await db.collection('offers').doc(ref.id).set(doc, { merge: true }).catch(() => {});
  await audit(req, 'task.create', { type: 'task', id: ref.id }, null, pick(f, ['title', 'rewardInr', 'status', 'appId']));
  res.status(201).json({ id: ref.id });
}));

router.put('/:id', requirePerm('tasks.write'), asyncHandler(async (req, res) => {
  const ref = db.collection('tasks').doc(req.params.id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpError(404, 'Task not found');
  const old = snap.data();
  const f = buildFields(req.body || {}, old);
  const patch = { ...f, updatedBy: { uid: req.admin.uid, email: req.admin.email }, updatedAt: FieldValue.serverTimestamp() };
  await ref.set(patch, { merge: true });
  await db.collection('offers').doc(ref.id).set(patch, { merge: true }).catch(() => {});
  await audit(req, 'task.update', { type: 'task', id: ref.id },
    { title: old.title, rewardInr: old.rewardInr ?? old.rewardAmount, status: taskStatus(old) },
    pick(f, ['title', 'rewardInr', 'status']));
  res.json({ ok: true });
}));

router.post('/:id/status', requirePerm('tasks.write'), asyncHandler(async (req, res) => {
  const status = req.body?.status;
  if (!STATUSES.includes(status)) throw new HttpError(400, 'Invalid status');
  const ref = db.collection('tasks').doc(req.params.id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpError(404, 'Task not found');
  const active = status === 'active';
  const patch = { status, active, isActive: active, updatedAt: FieldValue.serverTimestamp(), updatedBy: { uid: req.admin.uid, email: req.admin.email } };
  await ref.update(patch);
  await db.collection('offers').doc(ref.id).set(patch, { merge: true }).catch(() => {});
  await audit(req, 'task.status', { type: 'task', id: ref.id }, { status: taskStatus(snap.data()) }, { status });
  res.json({ ok: true });
}));

// Hard delete: Super Admin only. Prefer "archive" (status) in normal use.
router.delete('/:id', requirePerm('*'), requireRecentAuth, asyncHandler(async (req, res) => {
  const ref = db.collection('tasks').doc(req.params.id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpError(404, 'Task not found');
  const prompts = await db.collection('feedbackPrompts').where('taskId', '==', ref.id).get();
  const batch = db.batch();
  prompts.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(ref);
  batch.delete(db.collection('offers').doc(ref.id));
  await batch.commit();
  await audit(req, 'task.delete', { type: 'task', id: ref.id }, { title: snap.data().title, feedbackPromptsRemoved: prompts.size }, null);
  res.json({ ok: true, removedPrompts: prompts.size });
}));

module.exports = router;
