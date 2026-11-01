import { api } from '../api.js';
import { $, $$, esc, icon, fmtDateTime, qs, on, toast, confirmDialog, statusBadge, badge, pager, empty, skeleton, errorBox } from '../ui.js';

const S = { tab: 'compose', page: 1 };

export async function render(view, { ctx }) {
  const canSend = ctx.can('notifications.send');
  view.innerHTML = `<div class="stack"><div class="tabs" id="tabs" role="tablist">${[['compose', 'Compose'], ['history', 'Delivery history']].map(([k, l]) => `<button class="tab" role="tab" data-tab="${k}" aria-selected="${S.tab === k}">${l}</button>`).join('')}</div><div id="nb"></div></div>`;
  on($('#tabs'), 'click', '[data-tab]', (e, el) => { S.tab = el.dataset.tab; $$('#tabs .tab').forEach((t) => t.setAttribute('aria-selected', String(t === el))); draw(); });
  const draw = () => (S.tab === 'compose' ? compose(canSend) : history(canSend));
  await draw();
}

async function compose(canSend) {
  const box = $('#nb'); box.innerHTML = skeleton(2);
  let tpl; let seg;
  try { [tpl, seg] = await Promise.all([api('/notifications/templates'), api('/notifications/segments')]); } catch (e) { box.innerHTML = errorBox(e.message); return; }
  if (!canSend) { box.innerHTML = '<div class="card">' + empty('View only', 'Your role cannot send notifications.') + '</div>'; return; }
  box.innerHTML = `<div class="grid cols-2" style="align-items:start">
    <form id="nf" class="card stack" novalidate>
      <label class="field"><span>Start from a template</span><select id="tpl"><option value="">Custom message</option>${tpl.templates.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label>
      <div id="vars" class="stack"></div>
      <label class="field"><span>Title *</span><input id="title" maxlength="80"/></label>
      <label class="field"><span>Message *</span><textarea id="msg" rows="3" maxlength="300"></textarea></label>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">
        <label class="field"><span>Type</span><select id="type"><option value="broadcast">Broadcast</option><option value="offer">Offer</option><option value="alert">Alert</option></select></label>
        <label class="field"><span>Deep link (optional)</span><input id="link" placeholder="https://… or /tasks"/></label></div>
      <fieldset class="stack" style="border:0;padding:0;margin:0"><legend class="small muted bold" style="margin-bottom:6px">Send to</legend>
        <label class="field"><select id="mode"><option value="all">All users</option><option value="segment">A user segment</option><option value="users">Selected users (IDs)</option><option value="user">One user</option></select></label>
        <label class="field hidden" id="w-seg"><select id="seg">${seg.segments.map((s) => `<option value="${s.id}">${esc(s.label)} (${s.count})</option>`).join('')}</select></label>
        <label class="field hidden" id="w-ids"><span>User IDs (comma or new line)</span><textarea id="ids" rows="3"></textarea></label>
        <label class="field hidden" id="w-one"><span>User ID</span><input id="one"/></label></fieldset>
      <label class="field"><span>Schedule (optional)</span><input id="when" type="datetime-local"/><span class="hint">Leave empty to send now. Scheduled messages are sent within about a minute of the chosen time.</span></label>
      <div class="note warn">Notifications can appear on lock screens. Do not include payment, bank, UPI or personal details.</div>
      <p class="login-msg" id="nerr" role="alert"></p>
      <div class="row"><button class="btn" type="button" id="prev">Preview</button><button class="btn primary" type="submit" id="send">${icon('send')} Send</button></div>
    </form>
    <aside class="card soft stack" style="position:sticky;top:76px"><h3>Preview</h3><div class="card" id="pv"></div><p class="tiny muted" id="pv-count"></p></aside></div>`;

  const v = (id) => $(`#${id}`).value.trim();
  const vars = {};
  const apply = () => {
    const t = tpl.templates.find((x) => x.id === v('tpl')); if (!t) return;
    const fill = (s) => s.replace(/\{(\w+)\}/g, (m, k) => vars[k] || m);
    $('#title').value = fill(t.title); $('#msg').value = fill(t.message); $('#type').value = t.type; drawPv();
  };
  $('#tpl').addEventListener('change', () => {
    const t = tpl.templates.find((x) => x.id === v('tpl'));
    const keys = t ? [...new Set((t.title + t.message).match(/\{(\w+)\}/g) || [])].map((k) => k.slice(1, -1)) : [];
    keys.forEach((k) => { vars[k] = vars[k] || ''; });
    $('#vars').innerHTML = keys.map((k) => `<label class="field"><span>${esc(k)}</span><input data-var="${k}" value="${esc(vars[k])}"/></label>`).join('');
    apply();
  });
  on($('#vars'), 'input', '[data-var]', (e, el) => { vars[el.dataset.var] = el.value; apply(); });
  const drawPv = () => { $('#pv').innerHTML = `<div class="row" style="flex-wrap:nowrap"><span class="brand-mark" style="width:36px;height:36px;font-size:.8rem">AT</span><div style="min-width:0"><b>${esc(v('title') || 'Title')}</b><div class="small muted" style="overflow-wrap:anywhere">${esc(v('msg') || 'Message')}</div></div></div>`; };
  ['title', 'msg'].forEach((id) => $(`#${id}`).addEventListener('input', drawPv)); drawPv();
  $('#mode').addEventListener('change', () => { const m = v('mode'); $('#w-seg').classList.toggle('hidden', m !== 'segment'); $('#w-ids').classList.toggle('hidden', m !== 'users'); $('#w-one').classList.toggle('hidden', m !== 'user'); });

  const payload = () => {
    const mode = v('mode');
    const target = { mode, segment: v('seg'), userIds: v('ids'), userId: v('one') };
    const w = $('#when').value;
    return { title: v('title'), message: v('msg'), type: v('type'), deepLink: v('link'), target, scheduleAt: w ? new Date(w).toISOString() : undefined };
  };
  $('#prev').addEventListener('click', async () => {
    $('#nerr').textContent = '';
    try { const r = await api('/notifications/preview', { method: 'POST', body: payload() }); $('#pv-count').textContent = `Will reach ${r.recipients.toLocaleString('en-IN')} user${r.recipients === 1 ? '' : 's'}.`; drawPv(); } catch (e) { $('#nerr').textContent = e.message; }
  });
  $('#nf').addEventListener('submit', async (e) => {
    e.preventDefault(); $('#nerr').textContent = '';
    const body = payload(); const btn = $('#send'); btn.disabled = true;
    try {
      const pv = await api('/notifications/preview', { method: 'POST', body });
      const ok = await confirmDialog({ title: body.scheduleAt ? 'Schedule this notification?' : 'Send this notification?', message: `"${body.title}" will go to ${pv.recipients.toLocaleString('en-IN')} user${pv.recipients === 1 ? '' : 's'}${body.scheduleAt ? ` on ${fmtDateTime(new Date(body.scheduleAt).getTime())}` : ' right now'}.`, confirmText: body.scheduleAt ? 'Schedule' : 'Send now' });
      if (!ok) { btn.disabled = false; return; }
      await api('/notifications/send', { method: 'POST', body });
      toast(body.scheduleAt ? 'Notification scheduled' : 'Notification sent', 'ok'); S.tab = 'history'; $$('#tabs .tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === 'history'))); history(true);
    } catch (ex) { $('#nerr').textContent = ex.message; btn.disabled = false; }
  });
}

async function history(canSend) {
  const box = $('#nb'); box.innerHTML = skeleton(3);
  async function load() {
    try {
      const r = await api(`/notifications/history${qs({ page: S.page })}`);
      box.innerHTML = r.items.length ? `<div class="list">${r.items.map((n) => `<div class="item col"><div class="row between" style="flex-wrap:nowrap"><b class="trunc">${esc(n.title)}</b>${statusBadge(n.status)}</div><div class="small" style="overflow-wrap:anywhere">${esc(n.message)}</div>
        <div class="row tiny muted">${badge(n.type, 'info')}<span>To: ${esc(n.target?.mode === 'segment' ? `segment (${n.target.segment})` : n.target?.mode === 'all' ? 'all users' : n.target?.mode === 'users' ? `${n.target.userIds.length} users` : n.target?.userId || '—')}</span>${n.recipients != null ? `<span>Reached: ${esc(n.recipients)}</span>` : ''}<span>${n.scheduledFor && n.status === 'scheduled' ? `Scheduled ${fmtDateTime(n.scheduledFor)}` : fmtDateTime(n.at)}</span>${n.by ? `<span>${esc(n.by)}</span>` : ''}</div>
        ${n.error ? `<div class="tiny" style="color:var(--bad)">${esc(n.error)}</div>` : ''}
        ${canSend ? `<div class="row">${n.status === 'scheduled' ? `<button class="btn sm" data-cancel="${esc(n.id)}">Cancel schedule</button>` : ''}<button class="btn sm danger" data-del="${esc(n.id)}">${icon('trash')} Delete</button></div>` : ''}</div>`).join('')}</div>${pager(r)}` : `<div class="card">${empty('No notifications yet', 'Sent and scheduled notifications appear here.')}</div>`;
    } catch (e) { box.innerHTML = errorBox(e.message); }
  }
  on(box, 'click', '[data-page]', (e, el) => { S.page = Number(el.dataset.page); load(); });
  on(box, 'click', '[data-cancel]', async (e, el) => { try { await api(`/notifications/${el.dataset.cancel}/cancel`, { method: 'POST' }); toast('Schedule cancelled', 'ok'); load(); } catch (err) { toast(err.message, 'err'); } });
  on(box, 'click', '[data-del]', async (e, el) => {
    if (!(await confirmDialog({ title: 'Delete this notification?', message: 'It is also removed from users\' notification lists.', confirmText: 'Delete', danger: true }))) return;
    try { await api(`/notifications/${el.dataset.del}`, { method: 'DELETE' }); toast('Deleted', 'ok'); load(); } catch (err) { toast(err.message, 'err'); }
  });
  await load();
}
