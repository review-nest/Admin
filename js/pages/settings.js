import { api } from '../api.js';
import { $, $$, esc, icon, fmtDateTime, qs, on, toast, confirmDialog, formDialog, modal, badge, pager, empty, skeleton, errorBox, debounce } from '../ui.js';
import { resetPassword, currentUser } from '../auth.js';

const S = { tab: 'admins', q: '', action: '', page: 1 };
const ROLE_LABEL = { super_admin: 'Super Admin', moderator: 'Moderator / Approval Admin', payout_admin: 'Payout Admin', viewer: 'Read-only viewer' };

export async function render(view, { ctx }) {
  view.innerHTML = `<div class="stack"><div class="tabs" id="tabs" role="tablist">${[['admins', 'Admins & roles'], ['audit', 'Audit log'], ['security', 'Security']].map(([k, l]) => `<button class="tab" role="tab" data-tab="${k}" aria-selected="${S.tab === k}">${l}</button>`).join('')}</div><div id="sb"></div></div>`;
  on($('#tabs'), 'click', '[data-tab]', (e, el) => { S.tab = el.dataset.tab; $$('#tabs .tab').forEach((t) => t.setAttribute('aria-selected', String(t === el))); draw(); });
  const draw = () => (S.tab === 'admins' ? admins() : S.tab === 'audit' ? audit() : security(ctx));
  await draw();
}

async function admins() {
  const box = $('#sb'); box.innerHTML = skeleton(2);
  async function load() {
    try {
      const r = await api('/settings/admins');
      const roleOpts = r.roles.map((x) => ({ value: x, label: ROLE_LABEL[x] }));
      box.innerHTML = `<div class="stack"><div class="row between"><div class="note grow">Super Admins from the server settings (${r.bootstrap.map(esc).join(', ') || 'none'}) always have full access.</div><button class="btn primary" id="add">${icon('plus')} Add admin</button></div>
        <div class="list">${r.admins.length ? r.admins.map((a) => `<div class="item"><div class="avatar">${esc(a.email[0].toUpperCase())}</div><div class="grow"><b class="trunc">${esc(a.email)}</b><div class="small muted">${esc(ROLE_LABEL[a.role])}${a.legacyRole ? ' · migrated from old panel' : ''}</div></div>${a.disabled ? badge('Disabled', 'bad') : badge('Active', 'ok')}<button class="btn sm" data-edit="${a.id}" data-role="${a.role}" data-dis="${a.disabled}">Edit</button><button class="btn sm danger" data-rm="${a.id}" data-email="${esc(a.email)}">${icon('trash')}</button></div>`).join('') : empty('No extra admins yet', 'Add people and choose what they can do.')}</div>
        <div class="card soft"><h4>What each role can do</h4><ul class="small" style="margin:8px 0 0;padding-left:18px;display:grid;gap:4px"><li><b>Super Admin</b>: everything, including wallet adjustments, maintenance mode, roles and audit log.</li><li><b>Moderator / Approval Admin</b>: tasks, feedback, approvals, users (block/unblock), notifications, reports.</li><li><b>Payout Admin</b>: withdrawals and payment details, reports, user view.</li><li><b>Read-only viewer</b>: can look but cannot change anything; payment details stay masked.</li></ul></div></div>`;
      $('#add').addEventListener('click', async () => {
        const v = await formDialog({ title: 'Add admin', submitText: 'Add', note: 'They log in with this Google account, or with an email account whose address is verified.', fields: [{ name: 'email', label: 'Email', type: 'email', required: true }, { name: 'role', label: 'Role', type: 'select', options: roleOpts, value: 'moderator' }], onSubmit: (vals) => api('/settings/admins', { method: 'POST', body: vals }) });
        if (v) { toast('Admin saved', 'ok'); load(); }
      });
      on(box, 'click', '[data-edit]', async (e, el) => {
        const v = await formDialog({ title: 'Edit admin', fields: [{ name: 'role', label: 'Role', type: 'select', options: roleOpts, value: el.dataset.role }, { name: 'disabled', label: 'Disable access', type: 'checkbox', value: el.dataset.dis === 'true' }], onSubmit: (vals) => api(`/settings/admins/${el.dataset.edit}`, { method: 'PUT', body: vals }) });
        if (v) { toast('Updated', 'ok'); load(); }
      });
      on(box, 'click', '[data-rm]', async (e, el) => {
        if (!(await confirmDialog({ title: `Remove ${el.dataset.email}?`, message: 'They will lose access immediately.', confirmText: 'Remove', danger: true }))) return;
        try { await api(`/settings/admins/${el.dataset.rm}`, { method: 'DELETE' }); toast('Removed', 'ok'); load(); } catch (err) { if (!err.cancelled) toast(err.message, 'err'); }
      });
    } catch (e) { box.innerHTML = errorBox(e.message); }
  }
  await load();
}

async function audit() {
  const box = $('#sb');
  box.innerHTML = `<div class="stack"><div class="toolbar"><div class="grow field"><span>Search</span><div class="search">${icon('search')}<input id="q" type="search" value="${esc(S.q)}" placeholder="Admin, action or target ID"/></div></div>
    <label class="field"><span>Action</span><select id="act">${[['', 'All'], ['task', 'Tasks'], ['comment', 'Feedback'], ['approval', 'Approvals'], ['user', 'Users'], ['wallet', 'Wallet'], ['withdrawal', 'Payouts'], ['notification', 'Notifications'], ['maintenance', 'Maintenance'], ['admin', 'Admins'], ['report', 'Reports']].map(([v, l]) => `<option value="${v}" ${S.action === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div><div id="al">${skeleton(3)}</div></div>`;
  async function load() {
    const out = $('#al');
    try {
      const r = await api(`/settings/audit${qs({ q: S.q, action: S.action, page: S.page })}`);
      out.innerHTML = r.items.length ? `<div class="list">${r.items.map((l) => `<div class="item col"><div class="row between"><b>${esc(l.action)}</b><span class="tiny muted">${fmtDateTime(l.at)}</span></div><div class="small muted">${esc(l.admin)} · ${esc(l.role)} · ${esc(l.targetType)} <span class="mono">${esc(String(l.targetId).slice(0, 24))}</span></div>${l.note ? `<div class="small">${esc(l.note)}</div>` : ''}${l.before || l.after ? `<button class="btn sm" data-diff='${esc(JSON.stringify({ before: l.before, after: l.after }))}'>Before / after</button>` : ''}</div>`).join('')}</div>${pager(r)}` : `<div class="card">${empty('No log entries', 'Important admin actions are recorded here.')}</div>`;
    } catch (e) { out.innerHTML = errorBox(e.message); }
  }
  $('#q').addEventListener('input', debounce((e) => { S.q = e.target.value.trim(); S.page = 1; load(); }));
  $('#act').addEventListener('change', (e) => { S.action = e.target.value; S.page = 1; load(); });
  on(box, 'click', '[data-page]', (e, el) => { S.page = Number(el.dataset.page); load(); });
  on(box, 'click', '[data-diff]', (e, el) => {
    const d = JSON.parse(el.dataset.diff);
    modal({ title: 'Before / after', body: `<div class="stack"><div><div class="small muted bold">Before</div><pre class="card soft mono" style="white-space:pre-wrap;margin:6px 0 0">${esc(JSON.stringify(d.before, null, 2) || '—')}</pre></div><div><div class="small muted bold">After</div><pre class="card soft mono" style="white-space:pre-wrap;margin:6px 0 0">${esc(JSON.stringify(d.after, null, 2) || '—')}</pre></div></div>`, actions: [{ label: 'Close', onClick: (x, c) => c.close() }] });
  });
  await load();
}

function security(ctx) {
  const u = currentUser();
  $('#sb').innerHTML = `<div class="grid cards">
    <div class="card stack"><h3>Your login</h3><dl class="kv"><dt>Email</dt><dd>${esc(ctx.me.email)}</dd><dt>Role</dt><dd>${esc(ROLE_LABEL[ctx.me.role])}</dd><dt>Sign-in</dt><dd>${esc(u?.providerData?.[0]?.providerId === 'google.com' ? 'Google' : 'Email & password')}</dd></dl>
      ${u?.providerData?.[0]?.providerId === 'password' ? `<button class="btn" id="pw">Send password reset email</button>` : '<p class="small muted">Password is managed by your Google account.</p>'}</div>
    <div class="card stack"><h3>Protections in place</h3><ul class="small" style="margin:0;padding-left:18px;display:grid;gap:6px"><li>Every request is checked on the server with your login token and role.</li><li>Sensitive actions (mark paid, wallet changes, maintenance, role changes) ask you to log in again if your login is older than ${Math.round(ctx.me.reauthWindowSec / 60)} minutes.</li><li>UPI and bank details are masked; revealing them is logged.</li><li>Rate limits protect login-protected routes from abuse.</li><li>No secret keys are ever sent to the browser.</li></ul></div>
    <div class="card stack"><h3>Two-factor authentication</h3><p class="small muted" style="margin:0">Turn on multi-factor sign-in in Firebase Console → Authentication → Sign-in method (needs Identity Platform). Google accounts can use 2-Step Verification in the Google account settings.</p></div></div>`;
  $('#pw')?.addEventListener('click', async () => { try { await resetPassword(ctx.me.email); toast('Reset email sent', 'ok'); } catch (e) { toast(e.message, 'err'); } });
}
