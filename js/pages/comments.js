import { api } from './api.js';
import { $, $$, esc, icon, fmtDate, qs, on, toast, confirmDialog, formDialog, modal, statusBadge, badge, pager, empty, skeleton, errorBox, debounce, timeAgo } from '../ui.js';

const S = { tab: 'prompts', q: '', status: 'all', taskId: '', page: 1, rTask: '' };
const CAT = { feedback_prompt: 'Feedback prompt', test_scenario: 'Test scenario', private_feedback: 'Private feedback' };
let tasks = [];

const taskOptions = (sel = '', any = 'All tasks') => `<option value="">${any}</option>${tasks.map((t) => `<option value="${esc(t.id)}" ${t.id === sel ? 'selected' : ''}>${esc(t.title)}</option>`).join('')}`;

export async function render(view, { ctx }) {
  tasks = (await api('/tasks?limit=100&status=all')).items;
  const canW = ctx.can('comments.write');
  view.innerHTML = `<div class="stack">
    <div class="note">Use this section for <b>internal feedback prompts, test scenarios and private feedback categories</b>. Public Play Store reviews must stay genuine and voluntary, so scripted review text is not assigned to users.</div>
    <div class="tabs" role="tablist" id="tabs"><button class="tab" role="tab" data-tab="prompts">Prompts &amp; scenarios</button><button class="tab" role="tab" data-tab="restrictions">User restrictions</button></div>
    <div id="body"></div></div>`;
  const setTab = () => $$('#tabs .tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === S.tab)));
  on($('#tabs'), 'click', '[data-tab]', (e, el) => { S.tab = el.dataset.tab; setTab(); draw(); });
  setTab();

  async function draw() { return S.tab === 'prompts' ? drawPrompts(ctx, canW) : drawRestrictions(ctx, canW); }
  await draw();
}

/* ---------------------------------------------------------------- prompts */
async function drawPrompts(ctx, canW) {
  const body = $('#body');
  body.innerHTML = `<div class="toolbar">
    <div class="grow field"><span>Search</span><div class="search">${icon('search')}<input id="q" type="search" placeholder="Text, ID, app or status" value="${esc(S.q)}"/></div></div>
    <label class="field"><span>Status</span><select id="st">${['all', 'active', 'archived'].map((s) => `<option value="${s}" ${S.status === s ? 'selected' : ''}>${s === 'all' ? 'All' : s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select></label>
    <label class="field"><span>Task / app</span><select id="tk">${taskOptions(S.taskId)}</select></label>
    ${canW ? `<button class="btn" id="bulk">${icon('copy')} Bulk add</button><button class="btn primary" id="add">${icon('plus')} Add one</button>` : ''}
  </div><div id="plist">${skeleton(3)}</div>`;

  async function load() {
    const box = $('#plist');
    try {
      const r = await api(`/comments${qs({ q: S.q, status: S.status, taskId: S.taskId, page: S.page })}`);
      box.innerHTML = r.items.length ? `<div class="list">${r.items.map((c) => `<div class="item col">
          <div>${esc(c.text)}</div>
          <div class="row small muted">${badge(CAT[c.category] || c.category, 'info')}${statusBadge(c.status)}<span>${esc(c.appName || 'All tasks')}</span><span class="mono">#${esc(c.id.slice(0, 8))}</span><span>${fmtDate(c.createdAt)}</span></div>
          <div class="row"><button class="btn sm" data-usage="${esc(c.id)}">Usage</button>${canW ? `<button class="btn sm" data-edit="${esc(c.id)}" data-text="${esc(c.text)}">${icon('edit')} Edit</button><button class="btn sm" data-toggle="${esc(c.id)}" data-to="${c.status === 'active' ? 'archived' : 'active'}">${c.status === 'active' ? 'Archive' : 'Restore'}</button><button class="btn sm danger" data-del="${esc(c.id)}">${icon('trash')}</button>` : ''}</div>
        </div>`).join('')}</div>${pager(r)}` : `<div class="card">${empty('No entries yet', 'Add one, or paste many lines with Bulk add.')}</div>`;
    } catch (e) { box.innerHTML = errorBox(e.message); }
  }

  $('#q').addEventListener('input', debounce((e) => { S.q = e.target.value.trim(); S.page = 1; load(); }));
  $('#st').addEventListener('change', (e) => { S.status = e.target.value; S.page = 1; load(); });
  $('#tk').addEventListener('change', (e) => { S.taskId = e.target.value; S.page = 1; load(); });
  const catField = { name: 'category', label: 'Type', type: 'select', options: Object.entries(CAT).map(([value, label]) => ({ value, label })) };
  const taskField = { name: 'taskId', label: 'Related task / app (optional)', type: 'select', options: [{ value: '', label: 'All tasks' }, ...tasks.map((t) => ({ value: t.id, label: t.title }))] };

  $('#add')?.addEventListener('click', async () => {
    await formDialog({ title: 'Add entry', submitText: 'Add', fields: [{ name: 'text', label: 'Text', type: 'textarea', required: true, rows: 3, placeholder: 'e.g. How easy was it to find the main feature?' }, catField, taskField],
      onSubmit: async (v) => { await api('/comments', { method: 'POST', body: v }); toast('Added', 'ok'); } });
    load();
  });
  $('#bulk')?.addEventListener('click', async () => {
    await formDialog({ title: 'Bulk add', submitText: 'Import', wide: true, fields: [{ name: 'text', label: 'One entry per line', type: 'textarea', required: true, rows: 9, hint: 'Paste up to 500 lines. Duplicates are skipped automatically.' }, catField, taskField],
      onSubmit: async (v) => { const r = await api('/comments/bulk', { method: 'POST', body: v }); toast(`${r.created} added${r.skipped ? `, ${r.skipped} duplicates skipped` : ''}`, 'ok'); } });
    load();
  });
  on(body, 'click', '[data-page]', (e, el) => { S.page = Number(el.dataset.page); load(); });
  on(body, 'click', '[data-edit]', async (e, el) => {
    await formDialog({ title: 'Edit entry', fields: [{ name: 'text', label: 'Text', type: 'textarea', required: true, rows: 3, value: el.dataset.text }], onSubmit: async (v) => { await api(`/comments/${el.dataset.edit}`, { method: 'PUT', body: v }); toast('Saved', 'ok'); } });
    load();
  });
  on(body, 'click', '[data-toggle]', async (e, el) => { try { await api(`/comments/${el.dataset.toggle}`, { method: 'PUT', body: { status: el.dataset.to } }); load(); } catch (err) { toast(err.message, 'err'); } });
  on(body, 'click', '[data-del]', async (e, el) => {
    if (!(await confirmDialog({ title: 'Delete this entry?', message: 'It will be removed permanently. Archive it instead if you may need it later.', confirmText: 'Delete', danger: true }))) return;
    try { await api(`/comments/${el.dataset.del}`, { method: 'DELETE' }); toast('Deleted', 'ok'); load(); } catch (err) { toast(err.message, 'err'); }
  });
  on(body, 'click', '[data-usage]', async (e, el) => {
    try {
      const r = await api(`/comments/${el.dataset.usage}/usage`);
      modal({ title: 'Where this was used', body: r.items.length ? `<div class="rows">${r.items.map((u) => `<div class="r"><div><div class="bold">${esc(u.userName || u.userId)}</div><div class="small muted">${esc(u.taskTitle)} · ${esc(u.submissionId.slice(0, 8))}</div></div>${statusBadge(u.status)}</div>`).join('')}</div>` : empty('Not used yet', 'No submission refers to this entry.'), actions: [{ label: 'Close', onClick: (x, c) => c.close() }] });
    } catch (err) { toast(err.message, 'err'); }
  });
  await load();
}

/* ------------------------------------------------------------ restrictions */
async function drawRestrictions(ctx, canW) {
  const body = $('#body');
  body.innerHTML = `<div class="stack">
    <label class="field" style="max-width:420px"><span>Choose a task</span><select id="rt">${taskOptions(S.rTask, 'Select a task…')}</select></label>
    <div id="rbox"></div></div>`;
  $('#rt').addEventListener('change', (e) => { S.rTask = e.target.value; load(); });

  async function bulkChange(kind, ids) {
    if (!ids.length) return toast('Select at least one user', 'err');
    const ok = await confirmDialog({ title: `${kind === 'block' ? 'Block' : 'Unblock'} ${ids.length} user${ids.length > 1 ? 's' : ''}?`, message: kind === 'block' ? 'They will not be able to take this task.' : 'They will be able to take this task again.', confirmText: kind === 'block' ? `Block ${ids.length}` : `Unblock ${ids.length}`, danger: kind === 'block' });
    if (!ok) return;
    try { await api(`/comments/restrictions/${S.rTask}/${kind}`, { method: 'POST', body: { userIds: ids, confirmCount: ids.length } }); toast(`${ids.length} user${ids.length > 1 ? 's' : ''} ${kind === 'block' ? 'blocked' : 'unblocked'}`, 'ok'); load(); } catch (err) { toast(err.message, 'err'); }
  }

  async function load() {
    const box = $('#rbox');
    if (!S.rTask) { box.innerHTML = `<div class="card">${empty('Pick a task', 'You can block or unblock users for that task.')}</div>`; return; }
    box.innerHTML = skeleton(2);
    try {
      const [r, done] = await Promise.all([api(`/comments/restrictions/${S.rTask}`), api(`/comments/restrictions/${S.rTask}/completed`)]);
      const candidates = done.users.filter((u) => !u.blocked);
      box.innerHTML = `<div class="grid cols-2" style="align-items:start">
        <div class="card"><div class="card-head"><h3>Blocked users (${r.users.length})</h3>${canW && r.users.length ? `<label class="check small"><input type="checkbox" id="all-b"/> Select all</label>` : ''}</div>
          ${r.users.length ? `<div class="list">${r.users.map((u) => `<label class="item">${canW ? `<input type="checkbox" class="pick-b" value="${esc(u.id)}"/>` : ''}<div class="grow"><div class="bold trunc">${esc(u.name || 'User')}</div><div class="small muted mono trunc">${esc(u.id)}</div></div>${canW ? `<button class="btn sm" data-one="${esc(u.id)}">Unblock</button>` : ''}</label>`).join('')}</div>${canW ? `<div class="row" style="margin-top:12px"><button class="btn" id="unblock-sel">Unblock selected</button></div>` : ''}` : empty('Nobody is blocked for this task')}</div>
        ${canW ? `<div class="stack"><div class="card"><div class="card-head"><h3>Block by User ID</h3></div><label class="field"><span>User IDs (comma or new line)</span><textarea id="ids" rows="3" placeholder="uid1, uid2"></textarea></label><div class="row" style="margin-top:10px"><button class="btn danger" id="block-ids">Block these users</button></div></div>
          <div class="card"><div class="card-head"><h3>Already completed this app (${candidates.length})</h3>${candidates.length ? `<label class="check small"><input type="checkbox" id="all-c"/> Select all</label>` : ''}</div>
          ${candidates.length ? `<div class="list">${candidates.map((u) => `<label class="item"><input type="checkbox" class="pick-c" value="${esc(u.id)}"/><div class="grow"><div class="bold trunc">${esc(u.name || 'User')}</div><div class="small muted mono trunc">${esc(u.id)}</div></div></label>`).join('')}</div><div class="row" style="margin-top:12px"><button class="btn danger" id="block-sel">Block selected</button></div>` : '<p class="small muted">No other users have completed this app.</p>'}</div></div>` : ''}
      </div>`;
      $('#all-b')?.addEventListener('change', (e) => $$('.pick-b').forEach((c) => { c.checked = e.target.checked; }));
      $('#all-c')?.addEventListener('change', (e) => $$('.pick-c').forEach((c) => { c.checked = e.target.checked; }));
      $('#unblock-sel')?.addEventListener('click', () => bulkChange('unblock', $$('.pick-b:checked').map((c) => c.value)));
      $('#block-sel')?.addEventListener('click', () => bulkChange('block', $$('.pick-c:checked').map((c) => c.value)));
      $('#block-ids')?.addEventListener('click', () => bulkChange('block', [...new Set($('#ids').value.split(/[\s,]+/).filter(Boolean))]));
      on(box, 'click', '[data-one]', (e, el) => { e.preventDefault(); bulkChange('unblock', [el.dataset.one]); });
    } catch (e) { box.innerHTML = errorBox(e.message); }
  }
  await load();
}
