const { db, FieldValue } = require('../config/firebase');

/**
 * Write an audit-log entry. `before`/`after` should be SMALL plain objects (never screenshots).
 * target: { type: 'task'|'user'|..., id }
 */
async function audit(req, action, target = {}, before = null, after = null, note = '') {
  try {
    const a = req.admin || {};
    await db.collection('auditLogs').add({
      adminUid: a.uid || '',
      adminEmail: a.email || '',
      role: a.role || '',
      action,
      targetType: target.type || '',
      targetId: target.id || '',
      before: before ?? null,
      after: after ?? null,
      note: String(note || '').slice(0, 500),
      ip: req.ip || '',
      at: FieldValue.serverTimestamp(),
      atMs: Date.now(),
    });
  } catch (e) {
    console.error('[audit] failed to write log:', e.message);
  }
}

module.exports = { audit };
