import { api } from '../api.js';
import { $, $$, esc, icon, money, num, fmtDate, qs, on, toast, confirmDialog, statusBadge, pager, empty, skeleton, errorBox, debounce } from '../ui.js';

const state = { q: '', status: 'all', page: 1 };
const STATUSES = ['all', 'active', 'draft', 'paused', 'archived'];

function card(t, ctx) {
  const s = t.stats;
  const canW = ctx.can('tasks.write');
  const next = t.status === 'active' ? ['paused', 'Pause'] : ['active', 'Activate'];
  return `<article class="card">
    <div class="row" style="align-items:flex-start;flex-wrap:nowrap">
      ${t.iconUrl ? `<img class="avatar lg" src="${esc(t.iconUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer"/>` : `<div class="avatar lg">${esc(t.title.slice(0, 1))}</div>`}
      <div class="grow">
        <div class="row between" style="flex-wrap:nowrap"><h3 class="trunc">${esc(t.title)}</h3>${statusBadge(t.status)}</div>
        <div class="small muted">${money(t.reward)} · ${t.durationMinutes} min${t.taskCap ? ` · cap ${num(t.taskCap)}` : ''}${t.rating ? ` · ★ ${esc(t.rating)}` : ''}</div>
        <div class="tiny muted mono trunc">ID ${esc(t.id)}</div>
      </div>
    </div>
    <div class="divider"></div>
    <div class="grid" style="grid-template-columns:repeat(4,1fr);text-align:center;gap:6px">
      <div><div class="bold">${num(s.total)}</div><div class="tiny muted">Submitted</div></div>
      <div><div class="bold" style="color:var(--warn)">${num(s.pending)}</div><div class="tiny muted">Pending</div></div>
      <div><div class="bold" style="color:var(--ok)">${num(s.approved)}</div><div class="tiny muted">Approved</div></div>
      <div><div class="bold" style="color:var(--bad)">${num(s.rejected)}</div><div class="tiny muted">Rejected</div></div>
    </div>
    <div class="small muted" style="margin-top:10px">Reward liability: <b style="color:var(--ink)">${money(s.liability)}</b> approved · ${money(s.pendingExposure)} pending</div>
    <div class="tiny muted">Created ${fmtDate(t.createdAt)}${t.createdBy ? ` by ${esc(t.createdBy)}` : ''}</div>
    <div class="row" style="margin-top:12px">
      <a class="btn sm" href="#/approvals/${esc(t.id)}">${icon('folder')} Proofs</a>
      ${canW ? `<a class="btn sm" href="#/tasks/${esc(t.id)}/edit">${icon('edit')} Edit</a>
      ${t.status !== 'archived' ? `<button class="btn sm" data-status="${next[0]}" data-id="${esc(t.id)}">${next[1]}</button><button class="btn sm danger" data-status="archived" data-id="${esc(t.id)}">Archive</button>` : `<button class="btn sm" data-status="paused" data-id="${esc(t.id)}">Restore</button>`}` : ''}
      ${ctx.can('*') ? `<button class="btn sm danger" data-del="${esc(t.id)}" data-title="${esc(t.title)}" title="Delete forever">${icon('trash')}</button>` : ''}
    </div>
  </article>`;
}

export async function render(view, { ctx }) {
  view.innerHTML = `<div class="toolbar">
      <div class="grow field"><span>Search</span><div class="search">${icon('search')}<input id="q" type="search" placeholder="App name, task ID or package" value="${esc(state.q)}"/></div></div>
      <label class="field"><span>Status</span><select id="status">${STATUSES.map((s) => `<option value="${s}" ${s === state.status ? 'selected' : ''}>${s === 'all' ? 'All (not archived)' : s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select></label>
      ${ctx.can('tasks.write') ? `<a class="btn primary" href="#/tasks/new">${icon('plus')} Add task</a>` : ''}
    </div><div id="list">${skeleton(2)}</div>`;

  async function load() {
    const box = $('#list', view);
    try {
      const r = await api(`/tasks${qs({ q: state.q, status: state.status, page: state.page, limit: 12 })}`);
      box.innerHTML = r.items.length ? `<div class="grid cards">${r.items.map((t) => card(t, ctx)).join('')}</div>${pager(r)}`
        : `<div class="card">${empty('No tasks found', state.q ? 'Try a different search.' : 'Add your first task to get started.')}</div>`;
    } catch (e) { box.innerHTML = errorBox(e.message); }
  }

  $('#q', view).addEventListener('input', debounce((e) => { state.q = e.target.value.trim(); state.page = 1; load(); }));
  $('#status', view).addEventListener('change', (e) => { state.status = e.target.value; state.page = 1; load(); });
  on(view, 'click', '[data-page]', (e, el) => { state.page = Number(el.dataset.page); load(); });
  on(view, 'click', '[data-status]', async (e, el) => {
    const status = el.dataset.status;
    if (status === 'archived' && !(await confirmDialog({ title: 'Archive this task?', message: 'Users will no longer see it. Submissions and history are kept.', confirmText: 'Archive', danger: true }))) return;
    try { await api(`/tasks/${el.dataset.id}/status`, { method: 'POST', body: { status } }); toast('Task updated', 'ok'); load(); } catch (err) { toast(err.message, 'err'); }
  });
  on(view, 'click', '[data-del]', async (e, el) => {
    if (!(await confirmDialog({ title: 'Delete forever?', message: `"${el.dataset.title}" and its feedback prompts will be removed. Submissions stay in the database. This cannot be undone.`, confirmText: 'Delete forever', danger: true }))) return;
    try { await api(`/tasks/${el.dataset.del}`, { method: 'DELETE' }); toast('Task deleted', 'ok'); load(); } catch (err) { if (!err.cancelled) toast(err.message, 'err'); }
  });
  await load();
}
