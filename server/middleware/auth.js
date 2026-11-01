const { admin, db } = require('../config/firebase');
const env = require('../config/env');
const { HttpError, asyncHandler } = require('../utils/helpers');

const ROLE_PERMS = {
  super_admin: ['*'],
  moderator: [
    'dashboard.read', 'tasks.read', 'tasks.write', 'comments.read', 'comments.write',
    'approvals.read', 'approvals.write', 'users.read', 'users.write',
    'notifications.read', 'notifications.send', 'reports.read',
  ],
  payout_admin: [
    'dashboard.read', 'withdrawals.read', 'withdrawals.write', 'withdrawals.sensitive',
    'users.read', 'reports.read',
  ],
  viewer: [
    'dashboard.read', 'tasks.read', 'comments.read', 'approvals.read', 'users.read',
    'withdrawals.read', 'notifications.read', 'reports.read',
  ],
};
const ROLES = Object.keys(ROLE_PERMS);

function can(role, perm) {
  const p = ROLE_PERMS[role] || [];
  return p.includes('*') || p.includes(perm);
}

const roleCache = new Map(); // email -> {role, at}
const CACHE_MS = 60 * 1000;

function normaliseRole(r) {
  if (ROLES.includes(r)) return r;
  if (r === 'admin') return 'moderator'; // legacy docs written by the old hello.html
  return null;
}

async function resolveRole(email) {
  if (env.superAdminEmails.includes(email)) return 'super_admin';
  const hit = roleCache.get(email);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.role;
  const snap = await db.collection('admins').where('email', '==', email).limit(1).get();
  let role = null;
  if (!snap.empty) {
    const d = snap.docs[0].data();
    if (!d.disabled) role = normaliseRole(d.role);
  }
  roleCache.set(email, { role, at: Date.now() });
  return role;
}
const clearRoleCache = () => roleCache.clear();

const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw new HttpError(401, 'Login required', 'NO_TOKEN');
  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(token);
  } catch (e) {
    throw new HttpError(401, 'Session expired. Please log in again.', 'BAD_TOKEN');
  }
  const email = (decoded.email || '').toLowerCase();
  if (!email) throw new HttpError(403, 'Account has no email', 'NO_EMAIL');
  // An unverified e-mail could be claimed by anyone, so it never counts as admin identity.
  if (decoded.email_verified !== true) {
    throw new HttpError(403, 'Verify your email address first, then log in again.', 'EMAIL_NOT_VERIFIED');
  }
  const role = await resolveRole(email);
  if (!role) throw new HttpError(403, `${email} is not an authorised admin.`, 'NOT_ADMIN');
  req.admin = { uid: decoded.uid, email, name: decoded.name || email, role, authTime: decoded.auth_time || 0 };
  next();
});

const requirePerm = (perm) => (req, res, next) => {
  if (!req.admin || !can(req.admin.role, perm)) {
    return next(new HttpError(403, 'Your role does not allow this action.', 'FORBIDDEN'));
  }
  next();
};

/** Sensitive actions need a login newer than REAUTH_WINDOW_SEC. Frontend catches REAUTH_REQUIRED and re-prompts. */
const requireRecentAuth = (req, res, next) => {
  const age = Date.now() / 1000 - (req.admin?.authTime || 0);
  if (age > env.reauthWindowSec) {
    return next(new HttpError(401, 'Please confirm your login again to continue.', 'REAUTH_REQUIRED'));
  }
  next();
};

const permsFor = (role) => (ROLE_PERMS[role]?.includes('*') ? ['*'] : ROLE_PERMS[role] || []);

module.exports = { authenticate, requirePerm, requireRecentAuth, can, permsFor, ROLES, ROLE_PERMS, clearRoleCache };
