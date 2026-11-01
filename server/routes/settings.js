const express = require('express');
const { db, FieldValue } = require('../config/firebase');
const { fetchAll } = require('../utils/db');
const { requirePerm, requireRecentAuth, permsFor, ROLES, clearRoleCache } = require('../middleware/auth');
const { asyncHandler, HttpError, paginate, parseRange, toMillis, str, lc } = require('../utils/helpers');
const { audit } = require('../utils/audit');
const env = require('../config/env');

const router = express.Router();
const DEFAULT_MESSAGE = "We are currently undergoing scheduled maintenance to bring you a better experience. We'll be back online shortly!";
const BANNER = 'system_maintenance_banner'; // same document the existing mobile app already listens to

router.get('/me', (req, res) => res.json({ email: req.admin.email, name: req.admin.name, role: req.admin.role, perms: permsFor(req.admin.role), reauthWindowSec: env.reauthWindowSec }));

/* ------------------------------------------------------------ maintenance */
router.get('/maintenance', requirePerm('dashboard.read'), asyncHandler(async (req, res) => {
  const d = (await db.collection('broadcasts').doc(BANNER).get()).data() || {};
  res.json({ enabled: d.active === true, title: d.title || 'Maintenance Mode', message: d.message || DEFAULT_MESSAGE, updatedAt: toMillis(d.updatedAt) || null });
}));

router.put('/maintenance', requirePerm('*'), requireRecentAuth, asyncHandler(async (req, res) => {
  const enabled = req.body?.enabled === true;
  const title = str(req.body.title, 80) || 'Maintenance Mode';
  const message = str(req.body.message, 400) || DEFAULT_MESSAGE;
  const ref = db.collection('broadcasts').doc(BANNER);
  const before = (await ref.get()).data() || {};
  await ref.set({ active: enabled, isActive: enabled, title, message, body: message, description: message, type: 'alert', targetUserId: 'all', updatedAt: FieldValue.serverTimestamp(), createdAt: before.createdAt || FieldValue.serverTimestamp() }, { merge: true });
  await audit(req, 'maintenance.toggle', { type: 'maintenance', id: BANNER }, { enabled: before.active === true, message: before.message }, { enabled, message });
  res.json({ ok: true });
}));

/* ------------------------------------------------------------ admins & roles */
router.get('/admins', requirePerm('*'), asyncHandler(async (req, res) => {
  const docs = await fetchAll('admins');
  res.json({
    roles: ROLES,
    bootstrap: env.superAdminEmails,
    admins: docs.filter((a) => a.email).map((a) => ({ id: a.id, email: a.email, role: ROLES.includes(a.role) ? a.role : 'moderator', legacyRole: !ROLES.includes(a.role), disabled: a.disabled === true, updatedAt: toMillis(a.updatedAt) })),
  });
}));

router.post('/admins', requirePerm('*'), requireRecentAuth, asyncHandler(async (req, res) => {
  const email = lc(str(req.body?.email, 120));
  const role = req.body?.role;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address');
  if (!ROLES.includes(role)) throw new HttpError(400, 'Choose a role');
  const existing = await db.collection('admins').where('email', '==', email).limit(1).get();
  const ref = existing.empty ? db.collection('admins').doc() : existing.docs[0].ref;
  await ref.set({ email, role, disabled: false, updatedAt: FieldValue.serverTimestamp(), updatedBy: req.admin.email }, { merge: true });
  clearRoleCache();
  await audit(req, 'admin.upsert', { type: 'admin', id: ref.id }, existing.empty ? null : { role: existing.docs[0].data().role }, { email, role });
  res.status(201).json({ id: ref.id });
}));

router.put('/admins/:id', requirePerm('*'), requireRecentAuth, asyncHandler(async (req, res) => {
  const ref = db.collection('admins').doc(req.params.id);
  const s = await ref.get();
  if (!s.exists) throw new HttpError(404, 'Admin not found');
  if (lc(s.data().email) === req.admin.email) throw new HttpError(400, 'You cannot change your own role or access');
  const patch = { updatedAt: FieldValue.serverTimestamp(), updatedBy: req.admin.email };
  if (req.body.role != null) { if (!ROLES.includes(req.body.role)) throw new HttpError(400, 'Invalid role'); patch.role = req.body.role; }
  if (req.body.disabled != null) patch.disabled = req.body.disabled === true;
  await ref.update(patch);
  clearRoleCache();
  await audit(req, 'admin.update', { type: 'admin', id: ref.id }, { role: s.data().role, disabled: s.data().disabled === true }, { role: patch.role, disabled: patch.disabled });
  res.json({ ok: true });
}));

router.delete('/admins/:id', requirePerm('*'), requireRecentAuth, asyncHandler(async (req, res) => {
  const ref = db.collection('admins').doc(req.params.id);
  const s = await ref.get();
  if (!s.exists) throw new HttpError(404, 'Admin not found');
  if (lc(s.data().email) === req.admin.email) throw new HttpError(400, 'You cannot remove yourself');
  await ref.delete();
  clearRoleCache();
  await audit(req, 'admin.remove', { type: 'admin', id: ref.id }, { email: s.data().email, role: s.data().role }, null);
  res.json({ ok: true });
}));

/* ------------------------------------------------------------ audit log */
router.get('/audit', requirePerm('*'), asyncHandler(async (req, res) => {
  const snap = await db.collection('auditLogs').orderBy('atMs', 'desc').limit(3000).get();
  const { fromMs, toMs } = parseRange(req.query);
  const q = lc(req.query.q);
  let list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  list = list.filter((l) => l.atMs >= fromMs && l.atMs < toMs);
  if (req.query.action) list = list.filter((l) => String(l.action).startsWith(req.query.action));
  if (req.query.admin) list = list.filter((l) => lc(l.adminEmail).includes(lc(req.query.admin)));
  if (q) list = list.filter((l) => `${l.action} ${l.targetId} ${l.targetType} ${l.adminEmail} ${l.note}`.toLowerCase().includes(q));
  res.json(paginate(list.map((l) => ({ id: l.id, at: l.atMs, admin: l.adminEmail, role: l.role, action: l.action, targetType: l.targetType, targetId: l.targetId, before: l.before, after: l.after, note: l.note })), req.query, 25));
}));

module.exports = router;
