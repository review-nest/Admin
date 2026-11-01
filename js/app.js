import { initAuth, loginGoogle, loginEmail, resetPassword, sendVerification, logout, friendlyAuthError, currentUser } from '/auth.js';
import { api } from '/api.js';
import { $, $$, icon, esc, toast, on, skeleton, errorBox, confirmDialog } from '/ui.js';

const ctx = { me: null, can: () => false, go: (h) => { location.hash = h; }, refreshBadges: () => {} };

/* ------------------------------------------------------------------ routes */
const ROUTES = [
  { re: /^\/$/, nav: 'overview', title: 'Overview', page: 'overview' },
  { re: /^\/tasks$/, nav: 'tasks', title: 'Tasks / Offers', page: 'tasks', perm: 'tasks.read' },
  { re: /^\/tasks\/new$/, nav: 'tasks', title: 'New task', page: 'taskForm', perm: 'tasks.write' },
  { re: /^\/tasks\/([^/]+)\/edit$/, nav: 'tasks', title: 'Edit task', page: 'taskForm', perm: 'tasks.write', keys: ['id'] },
  { re: /^\/feedback$/, nav: 'feedback', title: 'Comments / Feedback', page: 'comments', perm: 'comments.read' },
  { re: /^\/approvals$/, nav: 'approvals', title: 'Approvals', page: 'approvals', perm: 'approvals.read' },
  { re: /^\/approvals\/([^/]+)$/, nav: 'approvals', title: 'Task proofs', page: 'approvals', perm: 'approvals.read', keys: ['taskId'] },
  { re: /^\/users$/, nav: 'users', title: 'Users & Wallet', page: 'users', perm: 'users.read' },
  { re: /^\/users\/([^/]+)$/, nav: 'users', title: 'User details', page: 'users', perm: 'users.read', keys: ['id'] },
  { re: /^\/withdrawals$/, nav: 'withdrawals', title: 'Withdrawals / Payouts', page: 'withdrawals', perm: 'withdrawals.read' },
  { re: /^\/reports$/, nav: 'reports', title: 'Monthly Reports', page: 'reports', perm: 'reports.read' },
  { re: /^\/notifications$/, nav: 'notifications', title: 'Push Notifications', page: 'notifications', perm: 'notifications.read' },
  { re: /^\/settings$/, nav: 'settings', title: 'Settings & Logs', page: 'settings', perm: '*' },
];
const NAV = [
  { key: 'overview', href: '#/', label: 'Overview', ico: 'home' },
  { key: 'tasks', href: '#/tasks', label: 'Tasks / Offers', ico: 'tasks', perm: 'tasks.read' },
  { key: 'feedback', href: '#/feedback', label: 'Comments / Feedback', ico: 'message', perm: 'comments.read' },
  { key: 'approvals', href: '#/approvals', label: 'Approvals', ico: 'check', perm: 'approvals.read', badge: 'pendingApprovals' },
  { key: 'users', href: '#/users', label: 'Users & Wallet', ico: 'users', perm: 'users.read' },
  { key: 'withdrawals', href: '#/withdrawals', label: 'Withdrawals', ico: 'wallet', perm: 'withdrawals.read', badge: 'pendingWithdrawals' },
  { key: 'reports', href: '#/reports', label: 'Monthly Reports', ico: 'chart', perm: 'reports.read' },
  { key: 'notifications', href: '#/notifications', label: 'Push Notifications', ico: 'bell', perm: 'notifications.read' },
  { key: 'settings', href: '#/settings', label: 'Settings & Logs', ico: 'settings', perm: '*' },
];

const badges = {};
let cleanup = null;
let renderToken = 0;

function buildNav() {
  $('#nav').innerHTML = NAV.filter((n) => !n.perm || ctx.can(n.perm)).map((n) => `<a href="${n.href}" data-nav="${n.key}">${icon(n.ico)}<span>${esc(n.label)}</span>${n.badge && badges[n.badge] ? `<span class="count">${badges[n.badge]}</span>` : ''}</a>`).join('');
  $('#btn-menu').innerHTML = icon('menu');
}

function parseHash() {
  const raw = location.hash.slice(1) || '/';
  const [path, query = ''] = raw.split('?');
  return { path, query: Object.fromEntries(new URLSearchParams(query)) };
}

async function route() {
  if (!ctx.me) return;
  const { path, query } = parseHash();
  let match = null; let params = {};
  for (const r of ROUTES) {
    const m = path.match(r.re);
    if (m) { match = r; (r.keys || []).forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); }); break; }
  }
  const view = $('#view');
  if (typeof cleanup === 'function') { try { cleanup(); } catch { /* ignore */ } } cleanup = null;
  closeMenu();
  if (!match) { location.hash = '#/'; return; }
  if (match.perm && !ctx.can(match.perm)) {
    view.innerHTML = `<div class="card"><div class="empty"><b>You do not have access to this page</b>Ask a Super Admin to change your role.</div></div>`;
    $('#page-title').textContent = match.title; return;
  }
  $('#page-title').textContent = match.title;
  $$('#nav a').forEach((a) => (a.dataset.nav === match.nav ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  view.innerHTML = skeleton(3);
  const token = ++renderToken;
  try {
    const mod = await import(`./pages/${match.page}.js`);
    if (token !== renderToken) return;
    view.innerHTML = '';
    cleanup = (await mod.render(view, { params, query, ctx, route: path })) || null;
    window.scrollTo({ top: 0 });
  } catch (e) {
    if (token !== renderToken) return;
    view.innerHTML = errorBox(e.message || 'This page could not be loaded.') + `<p><button class="btn" id="retry">${icon('refresh')} Try again</button></p>`;
    $('#retry')?.addEventListener('click', route);
  }
}

/* ----------------------------------------------------------------- shell */
const openMenu = () => { $('#sidebar').classList.add('open'); $('#scrim').classList.add('show'); };
function closeMenu() { $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('show'); }

async function refreshBadges() {
  try {
    const jobs = [];
    if (ctx.can('approvals.read')) jobs.push(api('/approvals/groups?status=pending').then((r) => { badges.pendingApprovals = r.totals.pending; }));
    if (ctx.can('withdrawals.read')) jobs.push(api('/withdrawals?folder=pending&limit=1').then((r) => { badges.pendingWithdrawals = r.counts.pending; }));
    jobs.push(api('/settings/maintenance').then((m) => $('#maint-pill').classList.toggle('hidden', !m.enabled)));
    await Promise.allSettled(jobs);
    buildNav();
    const { path } = parseHash(); const r = ROUTES.find((x) => x.re.test(path));
    if (r) $$('#nav a').forEach((a) => (a.dataset.nav === r.nav ? a.setAttribute('aria-current', 'page') : null));
  } catch { /* badges are optional */ }
}
ctx.refreshBadges = refreshBadges;

async function enterApp(user) {
  try {
    ctx.me = await api('/settings/me');
  } catch (e) {
    ctx.me = null;
    showLogin(e.code === 'EMAIL_NOT_VERIFIED' ? 'Please verify your email address (we sent a link), then log in again.' : e.message);
    if (e.code === 'EMAIL_NOT_VERIFIED') { try { await sendVerification(); } catch { /* ignore */ } }
    await logout();
    return;
  }
  const perms = ctx.me.perms;
  ctx.can = (p) => perms.includes('*') || perms.includes(p);
  $('#login').classList.add('hidden'); $('#shell').classList.remove('hidden');
  $('#me-role').textContent = `${ctx.me.email} · ${ctx.me.role.replace('_', ' ')}`;
  $('#me-email').textContent = ctx.me.email;
  buildNav();
  refreshBadges();
  route();
}

function showLogin(msg = '') {
  $('#shell').classList.add('hidden'); $('#login').classList.remove('hidden');
  const m = $('#login-msg'); m.textContent = msg; m.classList.remove('ok');
}

function wireLogin() {
  const msg = (t, ok = false) => { const m = $('#login-msg'); m.textContent = t; m.classList.toggle('ok', ok); };
  $('#btn-google').addEventListener('click', async () => { msg(''); try { await loginGoogle(); } catch (e) { msg(friendlyAuthError(e)); } });
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault(); msg(''); const b = $('#btn-login'); b.disabled = true;
    try { await loginEmail($('#login-email').value.trim(), $('#login-pass').value); } catch (err) { msg(friendlyAuthError(err)); } finally { b.disabled = false; }
  });
  $('#btn-forgot').addEventListener('click', async () => {
    const email = $('#login-email').value.trim();
    if (!email) return msg('Type your email above first, then tap "Forgot password".');
    try { await resetPassword(email); msg('If this email has an account, a reset link is on its way.', true); } catch (err) { msg(friendlyAuthError(err)); }
  });
}

async function boot() {
  wireLogin();
  $('#btn-menu').innerHTML = icon('menu');
  $('#btn-menu').addEventListener('click', openMenu);
  $('#scrim').addEventListener('click', closeMenu);
  on($('#nav'), 'click', 'a', closeMenu);
  $('#btn-logout').addEventListener('click', async () => { if (await confirmDialog({ title: 'Log out?', message: 'You will need to log in again to use the panel.', confirmText: 'Log out' })) { await logout(); } });
  window.addEventListener('hashchange', route);
  setInterval(() => { if (ctx.me) refreshBadges(); }, 120000);
  try {
    await initAuth((user) => { if (user) enterApp(user); else { ctx.me = null; showLogin(); } });
  } catch (e) {
    showLogin(e.message);
  }
}
boot();
export { ctx };
