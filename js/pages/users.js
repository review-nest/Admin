import { api } from '../api.js';
import { $, $$, esc, icon, money, num, fmtDate, fmtDateTime, timeAgo, qs, on, toast, confirmDialog, formDialog, statusBadge, badge, pager, empty, skeleton, errorBox, debounce } from '../ui.js';

const S = { q: '', status: 'all', sort: 'recent', minBal: '', maxBal: '', regFrom: '', regTo: '', page: 1, tab: 'submissions' };

const presence = (u) => (u.presence === 'live' ? '<span class="badge ok live">Live</span>' : `<span class="small muted">Last seen ${u.lastActiveAt ? timeAgo(u.lastActiveAt) : 'never'}</span>`);

export async function render(view, { params, ctx }) {
  return params.id ? detail(view, params.id, ctx) : list(view, ctx);
}

async function list(view, ctx) {
  view.innerHTML = `<div class="stack"><div class="toolbar">
      <div class="grow field"><span>Search user ID, name, email${ctx.can('withdrawals.sensitive') ? ' or UPI ID' : ''}</span><div class="search">${icon('search')}<input id="q" type="search" value="${esc(S.q)}" placeholder="Search…"/></div></div>
      <label class="field"><span>Status</span><select id="st">${['all', 'active', 'blocked', 'suspended'].map((s) => `<option value="${s}" ${S.status === s ? 'selected' : ''}>${s === 'all' ? 'All' : s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select></label>
      <label class="field"><span>Sort</span><select id="sort"><option value="recent" ${S.sort === 'recent' ? 'selected' : ''}>Newest</option><option value="balance" ${S.sort === 'balance' ? 'selected' : ''}>Balance</option><option value="active" ${S.sort === 'active' ? 'selected' : ''}>Last active</option></select></label>
      <label class="field"><span>Min balance ₹</span><input id="minb" type="number" inputmode="numeric" value="${esc(S.minBal)}"/></label>
      <label class="field"><span>Max balance ₹</span><input id="maxb" type="number" inputmode="numeric" value="${esc(S.maxBal)}"/></label>
      <label class="field"><span>Registered from</span><input id="rf" type="date" value="${esc(S.regFrom)}"/></label>
      <label class="field"><span>Registered to</span><input id="rt" type="date" value="${esc(S.regTo)}"/></label>
    </div><div id="ul">${skeleton(3)}</div></div>`;
  async function load() {
    const box = $('#ul');
    try {
      const r = await api(`/users${qs({ q: S.q, status: S.status, sort: S.sort, minBal: S.minBal, maxBal: S.maxBal, regFrom: S.regFrom, regTo: S.regTo, page: S.page })}`);
      box.innerHTML = r.items.length ? `<div class="grid cards">${r.items.map((u) => `<a class="item" href="#/users/${esc(u.id)}" style="text-decoration:none;color:inherit">
          <div class="avatar">${esc(u.name.slice(0, 1).toUpperCase())}</div>
          <div class="grow"><div class="row between" style="flex-wrap:nowrap"><b class="trunc">${esc(u.name)}</b>${u.status !== 'active' ? statusBadge(u.status) : ''}</div>
          <div class="small muted trunc">${esc(u.email)}</div><div class="tiny muted mono trunc">${esc(u.id)}</div>
          <div class="row small" style="margin-top:4px">${presence(u)}<span class="muted">· Joined ${fmtDate(u.registeredAt)}</span></div></div>
          <div class="right"><div class="bold">${money(u.balance)}</div><div class="tiny muted">${num(u.tasksDone)} tasks</div></div></a>`).join('')}</div>${pager(r)}` : `<div class="card">${empty('No users found', 'Change the search or filters.')}</div>`;
    } catch (e) { box.innerHTML = errorBox(e.message); }
  }
  const bind = (id, key, ev = 'change') => $(`#${id}`).addEventListener(ev, debounce((e) => { S[key] = e.target.value.trim(); S.page = 1; load(); }, ev === 'input' ? 350 : 0));
  bind('q', 'q', 'input'); bind('st', 'status'); bind('sort', 'sort'); bind('minb', 'minBal'); bind('maxb', 'maxBal'); bind('rf', 'regFrom'); bind('rt', 'regTo');
  on(view, 'click', '[data-page]', (e, el) => { S.page = Number(el.dataset.page); load(); });
  await load();
}

async function detail(view, id, ctx) {
  let d;
  async function load() {
    try { d = await api(`/users/${encodeURIComponent(id)}`); } catch (e) { view.innerHTML = errorBox(e.message); return; }
    const p = d.profile; const canW = ctx.can('users.write'); const canWallet = ctx.can('*');
    view.innerHTML = `<div class="stack">
      <div class="row"><a class="btn sm" href="#/users">${icon('left')} All users</a></div>
      <div class="card"><div class="row" style="flex-wrap:nowrap;align-items:flex-start"><div class="avatar lg">${esc(p.name.slice(0, 1).toUpperCase())}</div>
        <div class="grow"><div class="row"><h2>${esc(p.name)}</h2>${statusBadge(p.status)}${presence(p)}</div>
          <div class="small muted">${esc(p.email)}${p.phone ? ` · ${esc(p.phone)}` : ''}</div><div class="tiny muted mono">${esc(p.id)}</div>
          <div class="small muted">Registered ${fmtDateTime(p.registeredAt)}</div>${p.banReason ? `<div class="small" style="color:var(--bad)">Reason: ${esc(p.banReason)}</div>` : ''}</div>
        <div class="right"><div class="tiny muted">Wallet balance</div><div style="font-size:1.5rem;font-weight:800">${money(p.balance)}</div></div></div>
        <div class="row" style="margin-top:12px">
          ${canW && p.status === 'active' ? `<button class="btn sm danger" data-status="blocked">Block</button><button class="btn sm" data-status="suspended">Suspend</button>` : ''}
          ${canW && p.status !== 'active' ? `<button class="btn sm success" data-status="active">Unblock / Restore</button>` : ''}
          ${canWallet ? `<button class="btn sm" data-wallet="credit">+ Credit</button><button class="btn sm" data-wallet="debit">− Debit</button>` : ''}</div></div>
      <div class="grid kpis">${[['Submissions', d.stats.submissions], ['Approved', d.stats.approved], ['Rejected', d.stats.rejected], ['Pending', d.stats.pending], ['Withdrawals', d.stats.withdrawals], ['Total withdrawn', money(d.stats.withdrawn)]].map(([l, v]) => `<div class="card"><div class="small muted">${l}</div><div class="bold" style="font-size:1.2rem">${typeof v === 'number' ? num(v) : v}</div></div>`).join('')}</div>
      <div class="tabs" id="dt" role="tablist">${[['submissions', 'Submissions'], ['withdrawals', 'Withdrawals'], ['ledger', 'Wallet ledger'], ['activity', 'Account activity']].map(([k, l]) => `<button class="tab" role="tab" data-tab="${k}" aria-selected="${S.tab === k}">${l}</button>`).join('')}</div>
      <div class="card" id="tabbody"></div></div>`;
    on($('#dt'), 'click', '[data-tab]', (e, el) => { S.tab = el.dataset.tab; $$('#dt .tab').forEach((t) => t.setAttribute('aria-selected', String(t === el))); body(); });
    on(view, 'click', '[data-status]', async (e, el) => {
      const status = el.dataset.status;
      const v = await formDialog({ title: status === 'active' ? 'Restore this account?' : `${status === 'blocked' ? 'Block' : 'Suspend'} ${p.name}?`, submitText: status === 'active' ? 'Restore' : status === 'blocked' ? 'Block user' : 'Suspend user', danger: status !== 'active',
        fields: [{ name: 'reason', label: status === 'active' ? 'Note (optional)' : 'Reason', type: 'text', required: status !== 'active', placeholder: 'Visible in the audit log' }],
        onSubmit: async (vals) => { await api(`/users/${encodeURIComponent(id)}/status`, { method: 'POST', body: { status, reason: vals.reason } }); } });
      if (v) { toast('Account updated', 'ok'); load(); }
    });
    on(view, 'click', '[data-wallet]', async (e, el) => {
      const type = el.dataset.wallet;
      const v = await formDialog({ title: `${type === 'credit' ? 'Credit' : 'Debit'} wallet`, submitText: type === 'credit' ? 'Add money' : 'Deduct money', danger: type === 'debit',
        note: `Current balance ${money(p.balance)}. This is recorded in the ledger and audit log.`,
        fields: [{ name: 'amount', label: 'Amount (₹)', type: 'number', required: true, min: 1 }, { name: 'reason', label: 'Reason (required)', type: 'text', required: true, placeholder: 'Why is this adjustment needed?' }],
        onSubmit: async (vals) => { await api(`/users/${encodeURIComponent(id)}/wallet`, { method: 'POST', body: { type, amount: vals.amount, reason: vals.reason } }); } });
      if (v) { toast('Wallet updated', 'ok'); load(); }
    });
    body();
  }
  function body() {
    const b = $('#tabbody');
    if (S.tab === 'submissions') b.innerHTML = d.submissions.length ? `<div class="rows">${d.submissions.map((s) => `<div class="r"><div class="trunc"><b>${esc(s.taskTitle || 'Task')}</b><div class="tiny muted">${fmtDateTime(s.at)}${s.reason && s.status === 'rejected' ? ` · ${esc(s.reason)}` : ''}</div></div><div class="right">${statusBadge(s.status)}<div class="small bold">${money(s.reward)}</div></div></div>`).join('')}</div>` : empty('No submissions yet');
    if (S.tab === 'withdrawals') b.innerHTML = d.withdrawals.length ? `<div class="rows">${d.withdrawals.map((w) => `<div class="r"><div><b>${money(w.amount)}</b> <span class="small muted">${esc(w.method)} ${esc(w.destination)}</span><div class="tiny muted">${fmtDateTime(w.at)}${w.transactionRef ? ` · Ref ${esc(w.transactionRef)}` : ''}</div></div>${statusBadge(w.status)}</div>`).join('')}</div>` : empty('No withdrawals yet');
    if (S.tab === 'ledger') b.innerHTML = d.ledger.length ? `<div class="rows">${d.ledger.map((l) => `<div class="r"><div class="trunc"><b>${esc(l.type.replace(/_/g, ' ') || 'entry')}</b><div class="tiny muted">${fmtDateTime(l.at)} · <span class="mono">${esc(String(l.id).slice(0, 10))}</span>${l.linked ? ` · ${esc(String(l.linked).slice(0, 8))}` : ''}</div>${l.note ? `<div class="tiny">${esc(l.note)}</div>` : ''}</div><div class="right"><b style="color:${l.direction === 'debit' ? 'var(--bad)' : 'var(--ok)'}">${l.direction === 'debit' ? '−' : '+'}${money(l.amount)}</b>${l.balanceAfter != null ? `<div class="tiny muted">Bal ${money(l.balanceAfter)}</div>` : ''}</div></div>`).join('')}</div>` : empty('No ledger entries');
    if (S.tab === 'activity') b.innerHTML = d.activity.length ? `<div class="rows">${d.activity.map((a) => `<div class="r"><div>${esc(a.text)}<div class="tiny muted">${esc(a.by || '')}</div></div><span class="tiny muted">${fmtDateTime(a.at)}</span></div>`).join('')}</div>` : empty('No admin activity on this account');
  }
  await load();
}
