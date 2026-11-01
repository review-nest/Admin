const { db, FieldValue } = require('../config/firebase');
const { fetchAll, USER_LIGHT } = require('../utils/db');
const { toMillis, DAY, HttpError } = require('../utils/helpers');
const { lastActive, userCreated } = require('./stats');

const SEGMENTS = {
  active_7d: { label: 'Active in last 7 days', test: (u, now) => now - lastActive(u) <= 7 * DAY && lastActive(u) > 0 },
  new_7d: { label: 'Registered in last 7 days', test: (u, now) => now - userCreated(u) <= 7 * DAY && userCreated(u) > 0 },
  inactive_30d: { label: 'Inactive for 30+ days', test: (u, now) => !lastActive(u) || now - lastActive(u) > 30 * DAY },
  no_tasks: { label: 'No completed tasks yet', test: (u) => Number(u.completedTasksCount || 0) === 0 },
  has_balance: { label: 'Wallet balance above ₹0', test: (u) => Number(u.walletBalance || 0) > 0 },
};

async function segmentUserIds(name) {
  const seg = SEGMENTS[name];
  if (!seg) throw new HttpError(400, 'Unknown user segment');
  const users = await fetchAll('users', { select: USER_LIGHT });
  const now = Date.now();
  return users.filter((u) => !u.isBanned && seg.test(u, now)).map((u) => u.id);
}

async function segmentCounts() {
  const users = await fetchAll('users', { select: USER_LIGHT });
  const now = Date.now();
  return Object.entries(SEGMENTS).map(([id, s]) => ({ id, label: s.label, count: users.filter((u) => !u.isBanned && s.test(u, now)).length }));
}

async function resolveRecipients(target) {
  if (target.mode === 'all') return { all: true, ids: [] };
  if (target.mode === 'user') return { all: false, ids: target.userId ? [String(target.userId)] : [] };
  if (target.mode === 'users') return { all: false, ids: [...new Set((target.userIds || []).map(String))].slice(0, 5000) };
  if (target.mode === 'segment') return { all: false, ids: (await segmentUserIds(target.segment)).slice(0, 5000) };
  throw new HttpError(400, 'Choose who should receive this notification');
}

function deliveryDoc(ref, log, logId, userId) {
  const now = Date.now();
  return {
    id: ref.id, logId, title: log.title, message: log.message, body: log.message, description: log.message,
    type: log.type || 'broadcast', deepLink: log.deepLink || '', targetUserId: userId, userId,
    active: true, isActive: true, read: false, isRead: false, timestamp: now,
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  };
}

/** Send a notificationLog entry (status queued|scheduled). Safe against double-send. */
async function dispatch(logId) {
  const logRef = db.collection('notificationLog').doc(logId);
  const claimed = await db.runTransaction(async (tx) => {
    const s = await tx.get(logRef);
    if (!s.exists) return null;
    const d = s.data();
    if (!['queued', 'scheduled'].includes(d.status)) return null;
    tx.update(logRef, { status: 'sending' });
    return d;
  });
  if (!claimed) return null;

  try {
    const rec = await resolveRecipients(claimed.target);
    let count = 0;
    if (rec.all) {
      const ref = db.collection('broadcasts').doc();
      const doc = deliveryDoc(ref, claimed, logId, 'all');
      await ref.set(doc);
      await db.collection('notifications').doc(ref.id).set(doc);
      count = 1;
    } else {
      for (let i = 0; i < rec.ids.length; i += 200) {
        const batch = db.batch();
        rec.ids.slice(i, i + 200).forEach((uid) => {
          const ref = db.collection('broadcasts').doc();
          const doc = deliveryDoc(ref, claimed, logId, uid);
          batch.set(ref, doc);
          batch.set(db.collection('notifications').doc(ref.id), doc);
        });
        await batch.commit();
      }
      count = rec.ids.length;
    }
    await logRef.update({ status: 'sent', recipientCount: rec.all ? null : count, deliveredDocs: count, sentAt: FieldValue.serverTimestamp(), sentAtMs: Date.now() });
    return { count };
  } catch (e) {
    await logRef.update({ status: 'failed', error: String(e.message || e).slice(0, 300) });
    throw e;
  }
}

let timer = null;
function startScheduler() {
  if (timer) return;
  timer = setInterval(async () => {
    try {
      const snap = await db.collection('notificationLog').where('status', '==', 'scheduled').get();
      const due = snap.docs.filter((d) => toMillis(d.data().scheduleAtMs) <= Date.now());
      for (const d of due) await dispatch(d.id);
    } catch (e) { console.error('[scheduler]', e.message); }
  }, 30 * 1000);
  timer.unref?.();
}

module.exports = { SEGMENTS, segmentCounts, segmentUserIds, dispatch, startScheduler };
