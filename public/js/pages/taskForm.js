import { api } from '../api.js';
import { $, esc, icon, money, toast, debounce, confirmDialog, skeleton, errorBox } from '../ui.js';

const DEFAULT_INSTRUCTIONS = [
  'Open the app using the provided Google Play Store link and install it, if you choose to test it.',
  'Explore the app and share your honest experience or feedback.',
  'Submit your own genuine feedback; do not copy a scripted review or promise a particular star rating.',
  'Upload the requested proof/screenshot before the task deadline, where applicable.',
].join('\n');

const v = (id) => $(`#${id}`).value.trim();

export async function render(view, { params, ctx, query }) {
  const editing = Boolean(params.id);
  let t = { title: '', appName: '', storeUrl: '', iconUrl: '', developer: '', rating: '', downloads: '', reward: 10, durationMinutes: 15, taskCap: 0, status: 'active', category: 'App', instructions: DEFAULT_INSTRUCTIONS.split('\n'), description: '', deadlineAt: null };
  if (editing) {
    view.innerHTML = skeleton(2);
    try { t = await api(`/tasks/${encodeURIComponent(params.id)}`); } catch (e) { view.innerHTML = errorBox(e.message); return; }
  }
  const touched = new Set(); // fields the admin edited by hand are never overwritten by auto-fetch

  view.innerHTML = `
    <div class="row" style="margin-bottom:12px"><a class="btn sm" href="#/tasks">${icon('left')} Back to tasks</a>${editing ? `<span class="small muted mono">ID ${esc(t.id)}</span>` : '<span class="small muted">A Task ID is created automatically when you save.</span>'}</div>
    <div class="grid cols-2" style="align-items:start">
      <form id="tf" class="card stack" novalidate>
        <h2>${editing ? 'Edit task' : 'New task'}</h2>
        <div class="field"><span>1. Google Play Store link</span>
          <div class="row" style="flex-wrap:nowrap"><input id="storeUrl" type="url" inputmode="url" placeholder="https://play.google.com/store/apps/details?id=…" value="${esc(t.storeUrl)}"/><button type="button" class="btn" id="fetch">${icon('refresh')} Fetch</button></div>
          <span class="hint" id="fetch-msg">Paste the link and the app name, icon and details are filled in for you. You can always edit them.</span></div>
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
          <label class="field"><span>App name *</span><input id="appName" value="${esc(t.appName)}" maxlength="120"/></label>
          <label class="field"><span>Developer</span><input id="developer" value="${esc(t.developer)}" maxlength="120"/></label>
          <label class="field"><span>App icon link (https)</span><input id="iconUrl" type="url" value="${esc(t.iconUrl)}" placeholder="https://…"/></label>
          <label class="field"><span>Store rating</span><input id="rating" value="${esc(t.rating)}" placeholder="4.4" maxlength="10"/></label>
          <label class="field"><span>Downloads</span><input id="downloads" value="${esc(t.downloads)}" placeholder="10M+" maxlength="20"/></label>
          <label class="field"><span>Category</span><input id="category" value="${esc(t.category)}" maxlength="40"/></label>
        </div>
        <label class="field"><span>Task title *</span><input id="title" value="${esc(t.title)}" maxlength="120" placeholder="Shown to users, e.g. Try Game Master"/></label>
        <label class="field"><span>Task instructions (one step per line)</span><textarea id="instructions" rows="6">${esc((t.instructions || []).join('\n'))}</textarea>
          <span class="hint">Keep steps about honest testing and feedback. Do not make rewards depend on a star rating, a positive review or pre-written review text.</span></label>
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
          <label class="field"><span>Reward (₹) *</span><input id="reward" type="number" min="1" step="1" inputmode="numeric" value="${esc(t.reward)}"/></label>
          <label class="field"><span>Timer (minutes) *</span><input id="durationMinutes" type="number" min="1" inputmode="numeric" value="${esc(t.durationMinutes)}"/></label>
          <label class="field"><span>Deadline (date)</span><input id="deadline" type="date" value="${t.deadlineAt ? new Date(t.deadlineAt).toISOString().slice(0, 10) : ''}"/></label>
          <label class="field"><span>Max users (0 = no limit)</span><input id="taskCap" type="number" min="0" inputmode="numeric" value="${esc(t.taskCap)}"/></label>
          <label class="field"><span>Status</span><select id="status">${['draft', 'active', 'paused', 'archived'].map((s) => `<option value="${s}" ${s === t.status ? 'selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select></label>
        </div>
        ${editing ? `<dl class="kv small"><dt>Created</dt><dd>${t.createdAt ? new Date(t.createdAt).toLocaleString('en-IN') : '—'} ${t.createdBy ? `by ${esc(t.createdBy)}` : ''}</dd><dt>Last updated</dt><dd>${t.updatedAt ? new Date(t.updatedAt).toLocaleString('en-IN') : '—'} ${t.updatedBy ? `by ${esc(t.updatedBy)}` : ''}</dd></dl>` : ''}
        <p class="login-msg" id="tf-err" role="alert"></p>
        <div class="row"><button class="btn primary" id="save" type="submit">${editing ? 'Save changes' : 'Create task'}</button><a class="btn ghost" href="#/tasks">Cancel</a></div>
      </form>

      <aside class="card soft stack" style="position:sticky;top:76px" aria-label="Preview">
        <h3>How users will see it</h3>
        <div class="card" id="preview"></div>
        <p class="tiny muted">Preview only. The user app shows the same title, reward, timer and steps.</p>
      </aside>
    </div>`;

  const preview = () => {
    const steps = v('instructions').split('\n').map((x) => x.trim()).filter(Boolean);
    const icn = v('iconUrl');
    $('#preview').innerHTML = `<div class="row" style="flex-wrap:nowrap">${icn ? `<img class="avatar lg" src="${esc(icn)}" alt="" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'avatar lg',textContent:'?'}))"/>` : `<div class="avatar lg">${esc((v('appName') || '?').slice(0, 1))}</div>`}
      <div class="grow"><h3 class="trunc">${esc(v('title') || v('appName') || 'Task title')}</h3><div class="small muted trunc">${esc(v('developer') || 'Developer')}${v('rating') ? ` · ★ ${esc(v('rating'))}` : ''}${v('downloads') ? ` · ${esc(v('downloads'))}` : ''}</div></div></div>
      <div class="row" style="margin:10px 0"><span class="badge ok">Earn ${money(Number(v('reward')) || 0)}</span><span class="badge info">${esc(v('durationMinutes') || 0)} min</span>${v('deadline') ? `<span class="badge warn">Until ${esc(v('deadline'))}</span>` : ''}</div>
      <ol class="small" style="padding-left:18px;margin:0;display:grid;gap:6px">${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      <button class="btn primary block" type="button" style="margin-top:12px" disabled>Open on Google Play</button>`;
  };
  ['appName', 'developer', 'iconUrl', 'rating', 'downloads', 'category', 'title', 'instructions', 'reward', 'durationMinutes', 'deadline'].forEach((id) => {
    $(`#${id}`).addEventListener('input', () => { touched.add(id); preview(); });
  });
  preview();

  /* ---- auto-fetch with manual fallback ---- */
  const setMsg = (text, tone = '') => { const m = $('#fetch-msg'); m.textContent = text; m.style.color = tone === 'bad' ? 'var(--bad)' : tone === 'ok' ? 'var(--ok)' : ''; };
  let fetching = 0;
  async function fetchMeta() {
    const url = v('storeUrl');
    if (!/play\.google\.com/.test(url)) return;
    const n = ++fetching; setMsg('Fetching app details…');
    try {
      const r = await api('/tasks/fetch-meta', { method: 'POST', body: { url } });
      if (n !== fetching) return;
      if (!r.ok) { setMsg(`${r.reason || 'Could not fetch details.'} Please fill in the app name and icon yourself.`, 'bad'); return; }
      const fill = (id, val) => { if (val && !touched.has(id)) $(`#${id}`).value = val; };
      fill('appName', r.appName); fill('developer', r.developer); fill('iconUrl', r.iconUrl); fill('rating', r.rating); fill('downloads', r.downloads);
      if (!touched.has('title') && !$('#title').value) $('#title').value = r.appName;
      setMsg(`Fetched: ${r.appName}`, 'ok'); preview();
    } catch (e) { if (n === fetching) setMsg(e.message, 'bad'); }
  }
  $('#fetch').addEventListener('click', fetchMeta);
  $('#storeUrl').addEventListener('input', debounce(fetchMeta, 600));

  /* ---- save ---- */
  $('#tf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#tf-err'); err.textContent = '';
    const body = {
      storeUrl: v('storeUrl'), appName: v('appName'), title: v('title') || v('appName'), developer: v('developer'), iconUrl: v('iconUrl'), rating: v('rating'), downloads: v('downloads'),
      category: v('category'), instructions: v('instructions'), reward: Number(v('reward')), durationMinutes: Number(v('durationMinutes')), deadline: v('deadline') || null,
      taskCap: Number(v('taskCap') || 0), status: v('status'),
    };
    if (!body.title) { err.textContent = 'Enter the app name or task title.'; return; }
    if (!(body.reward > 0)) { err.textContent = 'Reward must be at least ₹1.'; return; }
    const btn = $('#save'); btn.disabled = true;
    const send = (extra = {}) => (editing ? api(`/tasks/${encodeURIComponent(params.id)}`, { method: 'PUT', body: { ...body, ...extra } }) : api('/tasks', { method: 'POST', body: { ...body, ...extra } }));
    try {
      try { await send(); } catch (ex) {
        if (ex.code !== 'DUPLICATE_TASK') throw ex;
        if (!(await confirmDialog({ title: 'Task already exists for this app', message: ex.message, confirmText: 'Create another' }))) { btn.disabled = false; return; }
        await send({ allowDuplicate: true });
      }
      toast(editing ? 'Task saved' : 'Task created', 'ok');
      ctx.go('#/tasks');
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
  });
}
