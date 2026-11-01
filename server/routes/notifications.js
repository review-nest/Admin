const express = require('express');
const { db, FieldValue } = require('../config/firebase');
const { fetchAll } = require('../utils/db');
const { requirePerm } = require('../middleware/auth');
const { asyncHandler, HttpError, paginate, toMillis, str } = require('../utils/helpers');
const { audit } = require('../utils/audit');
const { TEMPLATES, findSensitive } = require('../services/templates');
const { SEGMENTS, segmentCounts, segmentUserIds, dispatch } = require('../services/notify');

const router = express.Router();
const TYPES = ['broadcast', 'offer', 'alert'];

router.get('/templates', requirePerm('notifications.read'), (req, res) => res.json({ templates: TEMPLATES }));
router.get('/segments', requirePerm('notifications.read'), asyncHandler(async (req, res) => res.json({ segments: await segmentCounts() })));

function cleanTarget(t = {}) {
  if (t.mode === 'all') return { mode: 'all' };
  if (t.mode === 'user') { const userId = str(t.userId, 80); if (!userId) throw new HttpError(400, 'Enter the User ID'); return { mode: 'user', userId }; }
  if (t.mode === 'users') {
    const userIds = [...new Set(String(Array.isArray(t.userIds) ? t.userIds.join(',') : t.userIds || '').split(/[\s,]+/).map((x) => x.trim()).filter(Boolean))];
    if (!userIds.length) throw new HttpError(400, 'Enter at least one User ID');
    if (userIds.length > 1000) throw new HttpError(400, 'Up to 1000 User IDs at a time');
    return { mode: 'users', userIds };
  }
  if (t.mode === 'segment') { if (!SEGMENTS[t.segment]) throw new HttpError(400, 'Choose a user segment'); return { mode: 'segment', segment: t.segment }; }
  throw new HttpError(400, 'Choose who should receive this notification');
}

function cleanContent(b) {
  const title = str(b.title, 80); const message = str(b.message, 300);
  if (title.length < 3) throw new HttpError(400, 'Title needs at least 3 characters');
  if (message.length < 3) throw new HttpError(400, 'Message needs at least 3 characters');
  if (/\{[a-zA-Z]+\}/.test(title + message)) throw new HttpError(400, 'Fill in every {placeholder} before sending');
  const bad = findSensitive(`${title} ${message}`);
  if (bad.length) throw new HttpError(400, `Notifications show on lock screens. Remove ${bad.join(' and ')}.`, 'SENSITIVE_CONTENT');
  const deepLink = str(b.deepLink, 200);
  if (deepLink && !/^(https:\/\/|anytask:\/\/|\/)/i.test(deepLink)) throw new HttpError(400, 'Deep link must start with https://, anytask:// or /');
  return { title, message, deepLink, type: TYPES.includes(b.type) ? b.type : 'broadcast' };
}

async function recipientCount(target) {
  if (target.mode === 'all') return (await db.collection('users').count().get()).data().count;
  if (target.mode === 'user') return 1;
  if (target.mode === 'users') return target.userIds.length;
  return (await segmentUserIds(target.segment)).length;
}

router.post('/preview', requirePerm('notifications.send'), asyncHandler(async (req, res) => {
  const content = cleanContent(req.body || {});
  const target = cleanTarget(req.body.target);
  res.json({ ...content, recipients: await recipientCount(target) });
}));

router.post('/send', requirePerm('notifications.send'), asyncHandler(async (req, res) => {
  const content = cleanContent(req.body || {});
  const target = cleanTarget(req.body.target);
  let scheduleAtMs = 0;
  if (req.body.scheduleAt) {
    scheduleAtMs = new Date(req.body.scheduleAt).getTime();
    if (Number.isNaN(scheduleAtMs) || scheduleAtMs < Date.now() + 60 * 1000) throw new HttpError(400, 'Schedule time must be at least 1 minute from now');
  }
  const ref = db.collection('notificationLog').doc();
  await ref.set({
    id: ref.id, ...content, target, status: scheduleAtMs ? 'scheduled' : 'queued', scheduleAtMs: scheduleAtMs || null,
    createdBy: { uid: req.admin.uid, email: req.admin.email }, createdAt: FieldValue.serverTimestamp(), createdAtMs: Date.now(),
  });
  let result = null;
  if (!scheduleAtMs) result = await dispatch(ref.id);
  await audit(req, scheduleAtMs ? 'notification.schedule' : 'notification.send', { type: 'notification', id: ref.id }, null, { title: content.title, mode: target.mode, segment: target.segment, scheduleAtMs: scheduleAtMs || undefined });
  res.status(201).json({ id: ref.id, status: scheduleAtMs ? 'scheduled' : 'sent', delivered: result?.count ?? 0 });
}));

router.get('/history', requirePerm('notifications.read'), asyncHandler(async (req, res) => {
  const [logs, legacy] = await Promise.all([fetchAll('notificationLog'), fetchAll('broadcasts')]);
  const items = logs.map((l) => ({
    id: l.id, title: l.title, message: l.message, type: l.type, status: l.status, target: l.target, recipients: l.recipientCount ?? (l.target?.mode === 'all' ? 'All users' : null),
    scheduledFor: l.scheduleAtMs || null, at: toMillis(l.sentAtMs) || toMillis(l.createdAtMs), by: l.createdBy?.email || '', error: l.error || '', legacy: false,
  }));
  legacy.filter((b) => b.id !== 'system_maintenance_banner' && !b.logId).forEach((b) => items.push({
    id: b.id, title: b.title || '', message: b.message || '', type: b.type || 'broadcast', status: 'sent', target: { mode: b.targetUserId === 'all' || !b.targetUserId ? 'all' : 'user', userId: b.targetUserId },
    recipients: b.targetUserId && b.targetUserId !== 'all' ? 1 : 'All users', scheduledFor: null, at: toMillis(b.createdAt) || toMillis(b.timestamp), by: '', error: '', legacy: true,
  }));
  items.sort((a, b) => b.at - a.at);
  res.json(paginate(items, req.query, 15));
}));

router.post('/:id/cancel', requirePerm('notifications.send'), asyncHandler(async (req, res) => {
  const ref = db.collection('notificationLog').doc(req.params.id);
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw new HttpError(404, 'Notification not found');
    if (s.data().status !== 'scheduled') throw new HttpError(409, 'Only scheduled notifications can be cancelled', 'BAD_STATE');
    tx.update(ref, { status: 'cancelled' });
  });
  await audit(req, 'notification.cancel', { type: 'notification', id: ref.id });
  res.json({ ok: true });
}));

router.delete('/:id', requirePerm('notifications.send'), asyncHandler(async (req, res) => {
  const id = req.params.id;
  if (id === 'system_maintenance_banner') throw new HttpError(400, 'Use Maintenance mode to change this banner');
  const log = await db.collection('notificationLog').doc(id).get();
  const docs = await db.collection('broadcasts').where('logId', '==', id).get();
  let removed = 0;
  for (let i = 0; i < docs.docs.length; i += 200) {
    const batch = db.batch();
    docs.docs.slice(i, i + 200).forEach((d) => { batch.delete(d.ref); batch.delete(db.collection('notifications').doc(d.id)); removed += 1; });
    await batch.commit();
  }
  if (log.exists) await log.ref.delete();
  else { await db.collection('broadcasts').doc(id).delete(); await db.collection('notifications').doc(id).delete().catch(() => {}); removed += 1; }
  await audit(req, 'notification.delete', { type: 'notification', id }, { removedDeliveries: removed }, null);
  res.json({ ok: true, removed });
}));

module.exports = router;
