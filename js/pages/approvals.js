import { api, downloadFile } from '../api.js';
import { $, $$, esc, icon, money, num, fmtDate, fmtDateTime, qs, on, toast, confirmDialog, formDialog, modal, statusBadge, pager, empty, skeleton, errorBox, debounce, lazyImages, lightbox, saveBlob, today } from '../ui.js';

/* Filters survive navigation between the folder list and a task's proofs */
const F = { status: 'pending', range: '7d', from: '', to: '', date: '', q: '', page: 1 };
const rangeQuery = () => (F.range === 'custom' ? { from: F.from, to: F.to } : F.range === 'date' ? { date: F.date } : { range: F.range });
const REASONS = ['Screenshot is unclear', 'Wrong screenshot', 'Task steps not completed', 'Duplicate submission', 'Proof does not match this app'];

const FOLDERS = [['24h', 'Last 24 Hours'], ['7d', 'Last 7 Days'], ['30d', 'Last 30 Days'], ['custom', 'Custom range'], ['date', 'Single date'], ['all', 'All time']];

export async function render(view, { params, ctx }) {
  return params.taskId ? renderGroup(view, params.taskId, ctx) : renderFolders(view, ctx);
}

/* ====================================================== folders (task groups) */
async function renderFolders(view, ctx) {
  view.innerHTML = `<div class="stack">
    <div class="tabs" role="tablist" id="st-tabs"></div>
    <div class="toolbar">
      <label class="field"><span>Date folder</span><select id="range">${FOLDERS.map(([v, l]) => `<option value="${v}" ${F.range === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field ${F.range === 'custom' ? '' : 'hidden'}" id="f-from"><span>From</span><input type="date" id="from" value="${esc(F.from)}" max="${today()}"/></label>
      <label class="field ${F.range === 'custom' ? '' : 'hidden'}" id="f-to"><span>To</span><input type="date" id="to" value="${esc(F.to)}" max="${today()}"/></label>
      <label class="field ${F.range === 'date' ? '' : 'hidden'}" id="f-date"><span>Date</span><input type="date" id="date" value="${esc(F.date)}" max="${today()}"/></label>
      <button class="btn" id="refresh">${icon('refresh')} Refresh</button>
    </div>
    <div id="groups">${skeleton(2)}</div></div>`;

  const drawTabs = (totals) => {
    $('#st-tabs').innerHTML = ['pending', 'approved', 'rejected'].map((s) => `<button class="tab" role="tab" data-st="${s}" aria-selected="${F.status === s}">${s[0].toUpperCase() + s.slice(1)}<span class="n">${totals ? num(totals[s]) : ''}</span></button>`).join('');
  };
  drawTabs();

  async function load() {
    const box = $('#groups'); box.innerHTML = skeleton(2);
    try {
      const r = await api(`/approvals/groups${qs({ status: F.status, ...rangeQuery() })}`);
      drawTabs(r.totals);
      box.innerHTML = r.groups.length ? `<div class="grid cards three">${r.groups.map((g) => `
        <a class="card group-card" href="#/approvals/${esc(g.taskId)}" style="text-decoration:none;color:inherit">
          <div class="row" style="flex-wrap:nowrap">${g.iconUrl ? `<img class="avatar lg" src="${esc(g.iconUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer"/>` : `<div class="avatar lg">${icon('folder')}</div>`}
            <div class="grow"><h3 class="trunc">${esc(g.title)}</h3><div class="small muted trunc">${money(g.reward)} per task</div><div class="tiny muted mono trunc">Task ${esc(g.taskId.slice(0, 10))}</div></div></div>
          <div class="divider"></div>
          <div class="row between"><span class="bold">${num(g.proofCount)} proof${g.proofCount === 1 ? '' : 's'}</span><span class="tiny muted">${fmtDate(g.firstAt)}${fmtDate(g.firstAt) !== fmtDate(g.lastAt) ? ` – ${fmtDate(g.lastAt)}` : ''}</span></div>
          <div class="row small" style="margin-top:6px"><span class="badge warn">${num(g.counts.pending)} pending</span><span class="badge ok">${num(g.counts.approved)} approved</span><span class="badge bad">${num(g.counts.rejected)} rejected</span></div>
        </a>`).join('')}</div>` : `<div class="card">${empty(`No ${F.status} proofs in this period`, 'Try another date folder.')}</div>`;
    } catch (e) { box.innerHTML = errorBox(e.message); }
  }

  on($('#st-tabs'), 'click', '[data-st]', (e, el) => { F.status = el.dataset.st; load(); });
  $('#range').addEventListener('change', (e) => {
    F.range = e.target.value;
    $('#f-from').classList.toggle('hidden', F.range !== 'custom'); $('#f-to').classList.toggle('hidden', F.range !== 'custom'); $('#f-date').classList.toggle('hidden', F.range !== 'date');
    if (F.range === 'date' && !F.date) { F.date = today(); $('#date').value = F.date; }
    if (F.range !== 'custom' && F.range !== 'date') load(); else if (F.range === 'date') load();
  });
  $('#from').addEventListener('change', (e) => { F.from = e.target.value; load(); });
  $('#to').addEventListener('change', (e) => { F.to = e.target.value; load(); });
  $('#date').addEventListener('change', (e) => { F.date = e.target.value; load(); });
  $('#refresh').addEventListener('click', load);
  await load();
}

/* ============================================= one task's proofs + moderation */
async function renderGroup(view, taskId, ctx) {
  const canW = ctx.can('approvals.write');
  const selected = new Set();
  let data = null; let stopImg = null;
  F.page = F.page || 1;

  view.innerHTML = `<div class="stack">
    <div class="row"><a class="btn sm" href="#/approvals">${icon('left')} All folders</a></div>
    <div class="card" id="head">${skeleton(1)}</div>
    <div class="toolbar">
      <div class="grow field"><span>Search feedback, user ID or submission ID</span><div class="search">${icon('search')}<input id="q" type="search" value="${esc(F.q)}" placeholder="Search…"/></div></div>
      <label class="field"><span>Status</span><select id="gst">${['pending', 'approved', 'rejected', 'all'].map((s) => `<option value="${s}" ${F.status === s ? 'selected' : ''}>${s === 'all' ? 'All statuses' : s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select></label>
      <label class="field"><span>Date folder</span><select id="grange">${FOLDERS.map(([v, l]) => `<option value="${v}" ${F.range === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field ${F.range === 'custom' ? '' : 'hidden'}" id="gf"><span>From</span><input type="date" id="gfrom" value="${esc(F.from)}"/></label>
      <label class="field ${F.range === 'custom' ? '' : 'hidden'}" id="gt"><span>To</span><input type="date" id="gto" value="${esc(F.to)}"/></label>
      <label class="field ${F.range === 'date' ? '' : 'hidden'}" id="gd"><span>Date</span><input type="date" id="gdate" value="${esc(F.date)}"/></label>
    </div>
    <div class="row between"><label class="check"><input type="checkbox" id="sel-all"/> Select all on this page</label>
      <div class="row"><button class="btn" id="zip-all">${icon('download')} Download All (ZIP)</button><button class="btn" id="zip-sel" disabled>${icon('download')} Selected</button></div></div>
    <div id="proofs">${skeleton(3)}</div>
    <div id="bulk"></div>
  </div>`;

  const q = () => ({ status: F.status === 'all' ? '' : F.status, q: F.q, ...rangeQuery() });

  async function load() {
    stopImg?.();
    try {
      data = await api(`/approvals/groups/${encodeURIComponent(taskId)}/submissions${qs({ ...q(), page: F.page, limit: 24 })}`);
    } catch (e) { $('#proofs').innerHTML = errorBox(e.message); return; }
    const t = data.task; const c = data.counts;
    $('#head').innerHTML = `<div class="row" style="flex-wrap:nowrap">${t.iconUrl ? `<img class="avatar lg" src="${esc(t.iconUrl)}" alt="" referrerpolicy="no-referrer"/>` : `<div class="avatar lg">${icon('folder')}</div>`}
      <div class="grow"><h2 class="trunc">${esc(t.title)}</h2><div class="small muted">${money(t.reward)} per task · <span class="mono">Task ID ${esc(t.id)}</span></div>
      <div class="row small" style="margin-top:6px"><span class="badge">${num(c.total)} submitted</span><span class="badge warn">${num(c.pending)} pending</span><span class="badge ok">${num(c.approved)} approved</span><span class="badge bad">${num(c.rejected)} rejected</span></div></div></div>`;
    $('#proofs').innerHTML = data.items.length ? `<div class="proofs">${data.items.map(proofCard).join('')}</div>${pager(data)}` : `<div class="card">${empty('No proofs match', 'Change the status, date folder or search.')}</div>`;
    stopImg = lazyImages($('#proofs'), api);
    syncBulk();
  }

  const proofCard = (s) => `<article class="proof ${selected.has(s.id) ? 'selected' : ''}" data-id="${esc(s.id)}">
    ${canW ? `<label class="pick"><input type="checkbox" class="pick-box" data-id="${esc(s.id)}" ${selected.has(s.id) ? 'checked' : ''} aria-label="Select submission"/></label>` : ''}
    <div class="thumb" data-src="/approvals/submissions/${encodeURIComponent(s.id)}/image">Loading…</div>
    <div style="min-width:0">
      <div class="row between" style="flex-wrap:nowrap"><b class="trunc">${esc(s.userName)}</b>${statusBadge(s.status)}</div>
      <div class="tiny muted trunc">${esc(s.userEmail || s.userId)}</div>
      <div class="small bold" style="margin-top:2px">${money(s.reward)}</div>
      <div class="tiny muted">${fmtDateTime(s.at)}</div>
      <div class="tiny muted mono trunc">ID ${esc(s.id.slice(0, 12))} · user ${esc(s.userId.slice(0, 10))}</div>
      ${s.proofText ? `<div class="small" style="margin-top:6px;background:var(--surface-2);padding:6px 8px;border-radius:8px;overflow-wrap:anywhere">${esc(s.proofText)}</div>` : ''}
      ${s.rejectionReason || (s.status === 'rejected' && s.adminNote) ? `<div class="tiny" style="color:var(--bad);margin-top:4px">Reason: ${esc(s.rejectionReason || s.adminNote)}</div>` : ''}
      ${s.flags.length ? `<div class="row" style="margin-top:6px">${s.flags.map((f) => `<span class="flag">${icon('alert')} ${esc(f)}</span>`).join('')}</div>` : ''}
    </div>
    <div class="proof-actions">
      ${canW && s.status !== 'approved' ? `<button class="btn sm success" data-one="approve" data-id="${esc(s.id)}">Approve</button>` : ''}
      ${canW && s.status !== 'rejected' ? `<button class="btn sm danger" data-one="reject" data-id="${esc(s.id)}">Reject</button>` : ''}
      <button class="btn sm" data-hist="${esc(s.id)}">History</button>
    </div></article>`;

  function syncBulk() {
    const n = selected.size;
    $('#zip-sel').disabled = n === 0; $('#zip-sel').lastChild.textContent = ` Selected${n ? ` (${n})` : ''}`;
    $('#bulk').innerHTML = canW && n ? `<div class="bulkbar" role="region" aria-label="Bulk actions"><b>${n} selected</b><span class="grow"></span>
      <button class="btn sm ghost" style="color:#fff;border-color:#fff4" id="clear">Clear</button>
      <button class="btn success" id="b-approve">Approve All Selected</button><button class="btn danger solid" id="b-reject">Reject All Selected</button></div>` : '';
    $('#clear')?.addEventListener('click', () => { selected.clear(); $$('.pick-box').forEach((c) => { c.checked = false; c.closest('.proof').classList.remove('selected'); }); $('#sel-all').checked = false; syncBulk(); });
    $('#b-approve')?.addEventListener('click', () => decide('approve', [...selected]));
    $('#b-reject')?.addEventListener('click', () => decide('reject', [...selected]));
  }

  async function decide(action, ids) {
    let reason = '';
    if (action === 'reject') {
      const v = await formDialog({ title: `Reject ${ids.length} submission${ids.length > 1 ? 's' : ''}?`, submitText: `Reject ${ids.length}`, danger: true,
        note: `Only the ${ids.length} selected submission${ids.length > 1 ? 's' : ''} will be rejected. Everything else stays pending. The user will see this reason.`,
        fields: [{ name: 'preset', label: 'Quick reason', type: 'select', options: [{ value: '', label: 'Choose…' }, ...REASONS.map((r) => ({ value: r, label: r }))] }, { name: 'custom', label: 'Or write your own reason', type: 'text', placeholder: 'Reason shown to the user' }],
        onSubmit: (vals) => { if (!(vals.custom || vals.preset)) throw new Error('Choose or write a reason'); } });
      if (!v) return; reason = v.custom || v.preset;
    } else {
      const ok = await confirmDialog({ title: `Approve ${ids.length} submission${ids.length > 1 ? 's' : ''}?`, message: `Rewards will be credited to each user's wallet. Only these ${ids.length} selected submission${ids.length > 1 ? 's' : ''} change; the rest stay pending.`, confirmText: `Approve ${ids.length}` });
      if (!ok) return;
    }
    try {
      const r = await api('/approvals/decide', { method: 'POST', body: { action, ids, confirmCount: ids.length, reason } });
      const failed = r.results.filter((x) => !x.ok);
      toast(`${r.done} ${action === 'approve' ? 'approved' : 'rejected'}${r.failed ? `, ${r.failed} skipped` : ''}`, r.failed ? '' : 'ok');
      if (failed.length) modal({ title: 'Some were skipped', body: `<div class="rows">${failed.map((f) => `<div class="r"><span class="mono">${esc(f.id.slice(0, 10))}</span><span class="small" style="color:var(--bad)">${esc(f.error)}</span></div>`).join('')}</div>`, actions: [{ label: 'OK', cls: 'primary', onClick: (e, c) => c.close() }] });
      ids.forEach((id) => selected.delete(id));
      ctx.refreshBadges(); await load();
    } catch (e) { if (!e.cancelled) toast(e.message, 'err'); }
  }

  /* events */
  const reload = () => { F.page = 1; selected.clear(); load(); };
  $('#q').addEventListener('input', debounce((e) => { F.q = e.target.value.trim(); reload(); }));
  $('#gst').addEventListener('change', (e) => { F.status = e.target.value; reload(); });
  $('#grange').addEventListener('change', (e) => {
    F.range = e.target.value;
    ['gf', 'gt'].forEach((id) => $(`#${id}`).classList.toggle('hidden', F.range !== 'custom')); $('#gd').classList.toggle('hidden', F.range !== 'date');
    if (F.range === 'date' && !F.date) { F.date = today(); $('#gdate').value = F.date; }
    if (F.range !== 'custom') reload();
  });
  $('#gfrom').addEventListener('change', (e) => { F.from = e.target.value; reload(); });
  $('#gto').addEventListener('change', (e) => { F.to = e.target.value; reload(); });
  $('#gdate').addEventListener('change', (e) => { F.date = e.target.value; reload(); });
  on(view, 'click', '[data-page]', (e, el) => { F.page = Number(el.dataset.page); load(); });
  on(view, 'change', '.pick-box', (e, el) => { el.checked ? selected.add(el.dataset.id) : selected.delete(el.dataset.id); el.closest('.proof').classList.toggle('selected', el.checked); syncBulk(); });
  $('#sel-all').addEventListener('change', (e) => { $$('.pick-box').forEach((c) => { c.checked = e.target.checked; e.target.checked ? selected.add(c.dataset.id) : selected.delete(c.dataset.id); c.closest('.proof').classList.toggle('selected', e.target.checked); }); syncBulk(); });
  on(view, 'click', '[data-one]', (e, el) => decide(el.dataset.one, [el.dataset.id]));
  on(view, 'click', '.thumb[data-full]', (e, el) => { const card = el.closest('.proof'); lightbox(el.dataset.full, `${card.querySelector('b').textContent} · ${card.dataset.id.slice(0, 8)}`, api); });
  on(view, 'click', '[data-hist]', async (e, el) => {
    try {
      const r = await api(`/approvals/history${qs({ submissionId: el.dataset.hist })}`);
      modal({ title: 'Approval history', body: r.items.length ? `<div class="rows">${r.items.map((h) => `<div class="r"><div><div class="bold">${esc(h.decision.replace(/_/g, ' '))}</div><div class="small muted">${esc(h.adminEmail)} · ${fmtDateTime(h.at)}</div>${h.reason ? `<div class="small">${esc(h.reason)}</div>` : ''}</div><span class="bold">${money(h.reward)}</span></div>`).join('')}</div>` : empty('No decisions yet', 'This submission has not been approved or rejected.'), actions: [{ label: 'Close', onClick: (x, c) => c.close() }] });
    } catch (err) { toast(err.message, 'err'); }
  });

  async function zip(ids) {
    const btn = ids ? $('#zip-sel') : $('#zip-all'); btn.disabled = true; toast('Preparing ZIP…');
    try {
      const { blob, name } = await downloadFile(`/approvals/groups/${encodeURIComponent(taskId)}/zip${qs({ ...q(), ids: ids ? ids.join(',') : '' })}`, 'proofs.zip');
      saveBlob(blob, name); toast('ZIP downloaded', 'ok');
    } catch (e) { toast(e.message, 'err'); } finally { btn.disabled = ids ? selected.size === 0 : false; }
  }
  $('#zip-all').addEventListener('click', () => zip(null));
  $('#zip-sel').addEventListener('click', () => zip([...selected]));

  await load();
  return () => stopImg?.();
}
