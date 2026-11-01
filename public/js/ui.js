/* Shared UI helpers: escaping, formatting, icons, dialogs, toasts, charts. No framework. */

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const debounce = (fn, ms = 350) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const qs = (o) => { const p = new URLSearchParams(); Object.entries(o || {}).forEach(([k, v]) => { if (v !== '' && v != null && v !== 'all') p.set(k, v); }); const s = p.toString(); return s ? `?${s}` : ''; };

/** Delegated event helper:  on(root, 'click', '[data-act]', (e, el) => ...) */
export function on(root, type, selector, handler) {
  root.addEventListener(type, (e) => { const el = e.target.closest(selector); if (el && root.contains(el)) handler(e, el); });
}

/* ---------- formatting (all times shown in IST, same as the backend's report boundaries) ---------- */
const TZ = 'Asia/Kolkata';
export const money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
export const num = (n) => Number(n || 0).toLocaleString('en-IN');
export const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const fmtDateTime = (ms) => (ms ? new Date(ms).toLocaleString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
export function timeAgo(ms) {
  if (!ms) return '—';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`; if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(ms);
}
export const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
export const thisMonth = () => today().slice(0, 7);

/* ---------- icons ---------- */
const ICONS = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
  tasks: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9z"/><path d="M9 14l2 2 4-4"/>',
  message: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>', xcircle: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17" cy="9" r="2.5"/><path d="M17.5 14c2.5.3 4 2 4 4.5"/>',
  wallet: '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10h18"/><circle cx="16.5" cy="15" r="1"/>',
  chart: '<path d="M4 20V4"/><path d="M4 20h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 21h4"/>',
  settings: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>', search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', download: '<path d="M12 4v11"/><path d="M7 11l5 5 5-5"/><path d="M5 20h14"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  edit: '<path d="M4 20l4-1 11-11-3-3L5 16z"/>', trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
  right: '<path d="M9 6l6 6-6 6"/>', left: '<path d="M15 6l-6 6 6 6"/>', refresh: '<path d="M20 11a8 8 0 1 0-2 5.5"/><path d="M20 5v6h-6"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  wrench: '<path d="M14 6a4 4 0 0 0 5 5l-9 9a2.1 2.1 0 0 1-3-3l9-9z"/>', file: '<path d="M6 3h8l4 4v14H6z"/><path d="M9 12h6M9 16h6"/>',
  logout: '<path d="M9 4H5v16h4"/><path d="M16 8l4 4-4 4"/><path d="M20 12H9"/>', send: '<path d="M21 3L3 11l7 3 3 7z"/><path d="M10 14l11-11"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>', copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/>',
  rocket: '<path d="M5 15c-1 1-1.5 4-1.5 4s3-.5 4-1.5"/><path d="M12 15l-3-3a15 15 0 0 1 11-9 15 15 0 0 1-9 11z"/><circle cx="15" cy="9" r="1.2"/>',
};
export const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;

/* ---------- small html builders ---------- */
const TONES = { pending: 'warn', processing: 'info', approved: 'ok', paid: 'ok', rejected: 'bad', active: 'ok', blocked: 'bad', suspended: 'warn', draft: '', paused: 'warn', archived: '', sent: 'ok', scheduled: 'info', failed: 'bad', cancelled: '', queued: 'info', sending: 'info' };
export const badge = (text, tone = '') => `<span class="badge ${tone}">${esc(text)}</span>`;
export const statusBadge = (s) => badge(String(s).replace(/^./, (c) => c.toUpperCase()), TONES[s] || '');
export const empty = (title, sub = '') => `<div class="empty"><b>${esc(title)}</b>${esc(sub)}</div>`;
export const errorBox = (msg) => `<div class="error-box" role="alert">${esc(msg)}</div>`;
export const skeleton = (n = 3) => `<div class="stack">${Array.from({ length: n }, () => '<div class="sk block"></div>').join('')}</div>`;

export function pager(p) {
  if (!p || p.pages <= 1) return '';
  const b = (label, page, dis, cur) => `<button class="btn sm ${cur ? 'primary' : ''}" data-page="${page}" ${dis ? 'disabled' : ''}>${label}</button>`;
  const nums = [];
  for (let i = Math.max(1, p.page - 1); i <= Math.min(p.pages, p.page + 1); i += 1) nums.push(b(i, i, false, i === p.page));
  return `<div class="pager">${b('‹ Prev', p.page - 1, p.page <= 1)}${p.page > 2 ? b(1, 1) + (p.page > 3 ? '<span class="muted">…</span>' : '') : ''}${nums.join('')}${p.page < p.pages - 1 ? (p.page < p.pages - 2 ? '<span class="muted">…</span>' : '') + b(p.pages, p.pages) : ''}${b('Next ›', p.page + 1, p.page >= p.pages)}<span class="small muted" style="width:100%;text-align:center">${num(p.total)} total</span></div>`;
}

/* ---------- toast ---------- */
export function toast(msg, type = '') {
  const root = $('#toast-root'); const t = document.createElement('div');
  t.className = `toast ${type}`; t.textContent = msg; root.appendChild(t);
  setTimeout(() => t.remove(), type === 'err' ? 6000 : 3500);
}

/* ---------- dialogs ---------- */
export function modal({ title, body = '', actions = [], wide = false, onMount }) {
  const root = $('#modal-root');
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="row between"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div><div class="modal-body">${body}</div>${actions.length ? `<div class="modal-foot">${actions.map((a, i) => `<button class="btn ${a.cls || ''}" data-act="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}</div>`;
  root.appendChild(back);
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  $('[data-close]', back).addEventListener('click', close);
  actions.forEach((a, i) => $(`[data-act="${i}"]`, back).addEventListener('click', (e) => a.onClick?.(e, { close, el: back })));
  onMount?.(back, close);
  setTimeout(() => $('input, select, textarea, .btn.primary', back)?.focus(), 30);
  return { close, el: back };
}

export const confirmDialog = ({ title, message, confirmText = 'Confirm', danger = false, html = '' }) => new Promise((resolve) => {
  let done = false; const fin = (v, close) => { if (done) return; done = true; close?.(); resolve(v); };
  const m = modal({
    title, body: `<p style="margin:0">${esc(message)}</p>${html}`,
    actions: [{ label: 'Cancel', onClick: (e, c) => fin(false, c.close) }, { label: confirmText, cls: danger ? 'danger solid' : 'primary', onClick: (e, c) => fin(true, c.close) }],
  });
  m.el.addEventListener('mousedown', (e) => { if (e.target === m.el) fin(false); });
  $('[data-close]', m.el).addEventListener('click', () => fin(false));
});

/**
 * formDialog({title, fields:[{name,label,type,required,value,options,placeholder,hint,rows,min,max}], submitText, note})
 * resolves with an object of values or null (cancelled). `onSubmit(values)` may be async and throw to show an inline error.
 */
export function formDialog({ title, fields, submitText = 'Save', note = '', danger = false, wide = false, onSubmit }) {
  return new Promise((resolve) => {
    const input = (f) => {
      const id = `f_${f.name}`; const req = f.required ? 'required' : '';
      if (f.type === 'textarea') return `<textarea id="${id}" name="${f.name}" rows="${f.rows || 4}" placeholder="${esc(f.placeholder || '')}" ${req}>${esc(f.value || '')}</textarea>`;
      if (f.type === 'select') return `<select id="${id}" name="${f.name}" ${req}>${f.options.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(f.value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
      if (f.type === 'checkbox') return `<label class="check"><input id="${id}" type="checkbox" name="${f.name}" ${f.value ? 'checked' : ''}/> ${esc(f.label)}</label>`;
      return `<input id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder || '')}" ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''} ${f.type === 'number' ? 'inputmode="decimal" step="any"' : ''} ${req} autocomplete="off"/>`;
    };
    const body = `${note ? `<div class="note warn">${note}</div>` : ''}<form id="dlg-form" class="stack" novalidate>${fields.map((f) => (f.type === 'checkbox' ? `<div class="field">${input(f)}</div>` : `<label class="field"><span>${esc(f.label)}${f.required ? ' *' : ''}</span>${input(f)}${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ''}</label>`)).join('')}<p class="login-msg" id="dlg-err"></p></form>`;
    let settled = false; const fin = (v, close) => { if (settled) return; settled = true; close?.(); resolve(v); };
    const m = modal({
      title, body, wide,
      actions: [{ label: 'Cancel', onClick: (e, c) => fin(null, c.close) }, { label: submitText, cls: danger ? 'danger solid' : 'primary', onClick: (e, c) => submit(c, e.currentTarget) }],
    });
    const form = $('#dlg-form', m.el); const err = $('#dlg-err', m.el);
    const submit = async (c, btn) => {
      err.textContent = '';
      const values = {};
      for (const f of fields) {
        const el = form.elements[f.name];
        const v = f.type === 'checkbox' ? el.checked : el.value.trim();
        if (f.required && (v === '' || v === false)) { err.textContent = `${f.label} is required`; el.focus(); return; }
        values[f.name] = f.type === 'number' && v !== '' ? Number(v) : v;
      }
      btn.disabled = true;
      try { if (onSubmit) await onSubmit(values); fin(values, c.close); } catch (e) { err.textContent = e.message || 'Something went wrong'; btn.disabled = false; }
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); $('[data-act="1"]', m.el).click(); });
    $('[data-close]', m.el).addEventListener('click', () => fin(null));
    m.el.addEventListener('mousedown', (e) => { if (e.target === m.el) fin(null); });
  });
}

/* ---------- authenticated images (screenshots need the Bearer token) ---------- */
const blobCache = new Map();
export async function loadImg(img, path, api) {
  try {
    if (!blobCache.has(path)) {
      const r = await api(path, { raw: true });
      const type = r.headers.get('content-type') || '';
      blobCache.set(path, type.includes('json') ? (await r.json()).url : URL.createObjectURL(await r.blob()));
      if (blobCache.size > 150) { const k = blobCache.keys().next().value; const v = blobCache.get(k); if (v.startsWith('blob:')) URL.revokeObjectURL(v); blobCache.delete(k); }
    }
    img.src = blobCache.get(path);
    return true;
  } catch { return false; }
}

export function lazyImages(root, api) {
  const io = new IntersectionObserver((entries) => entries.forEach(async (en) => {
    if (!en.isIntersecting) return; io.unobserve(en.target);
    const holder = en.target; const ok = await loadImg(Object.assign(document.createElement('img'), { alt: 'Proof screenshot' }), holder.dataset.src, api).then(async (good) => {
      if (!good) return false; const im = document.createElement('img'); im.className = 'thumb'; im.alt = 'Proof screenshot'; im.dataset.full = holder.dataset.src; im.src = blobCache.get(holder.dataset.src); holder.replaceWith(im); return true;
    });
    if (!ok) holder.textContent = 'No image';
  }), { rootMargin: '200px' });
  $$('[data-src]', root).forEach((n) => io.observe(n));
  return () => io.disconnect();
}

export function lightbox(path, caption, api) {
  const root = $('#modal-root'); const back = document.createElement('div');
  back.className = 'modal-back lightbox';
  back.innerHTML = `<div class="bar"><div class="small bold">${esc(caption)}</div><div class="row"><button class="btn sm" data-dl>${icon('download')} Download</button><button class="btn sm" data-x>${icon('x')} Close</button></div></div><div class="stage"><img alt="Full size proof" /></div>`;
  root.appendChild(back);
  const img = $('img', back); const close = () => { back.remove(); document.removeEventListener('keydown', k); };
  const k = (e) => { if (e.key === 'Escape') close(); }; document.addEventListener('keydown', k);
  loadImg(img, path, api).then((ok) => { if (!ok) img.alt = 'Image could not be loaded'; });
  img.addEventListener('click', () => img.classList.toggle('zoom'));
  $('[data-x]', back).addEventListener('click', close);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  $('[data-dl]', back).addEventListener('click', () => { const a = document.createElement('a'); a.href = img.src; a.download = `${caption.replace(/\W+/g, '_')}.jpg`; a.click(); });
}

export function saveBlob(blob, filename) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

/* ---------- tiny SVG line chart ---------- */
export function lineChart(labels, series, { height = 190, money: isMoney = false } = {}) {
  const W = 600; const H = height; const pl = 38; const pr = 10; const pt = 10; const pb = 24;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const nice = (() => { const m = 10 ** Math.floor(Math.log10(max)); const f = max / m; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * m; })();
  const x = (i) => pl + (labels.length <= 1 ? 0 : (i * (W - pl - pr)) / (labels.length - 1));
  const y = (v) => pt + (H - pt - pb) * (1 - v / nice);
  const fmt = (v) => (v >= 1e5 ? `${(v / 1e5).toFixed(1)}L` : v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k` : v);
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => `<line x1="${pl}" x2="${W - pr}" y1="${y(nice * f)}" y2="${y(nice * f)}" stroke="#E9E3DC" stroke-width="1"/><text x="${pl - 6}" y="${y(nice * f) + 4}" text-anchor="end" font-size="10" fill="#6C7280">${isMoney ? '₹' : ''}${fmt(Math.round(nice * f))}</text>`).join('');
  const ticks = [0, Math.floor((labels.length - 1) / 2), labels.length - 1].filter((v, i, a) => a.indexOf(v) === i)
    .map((i) => `<text x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'}" font-size="10" fill="#6C7280">${esc(labels[i]?.slice(5).replace('-', '/') || '')}</text>`).join('');
  const lines = series.map((s, si) => {
    const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
    const area = si === 0 ? `<polygon points="${x(0)},${y(0)} ${pts} ${x(s.values.length - 1)},${y(0)}" fill="${s.color}" opacity=".12"/>` : '';
    const dots = s.values.length <= 14 ? s.values.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="${s.color}"/>`).join('') : '';
    return `${area}<polyline fill="none" stroke="${s.color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" points="${pts}"/>${dots}`;
  }).join('');
  const legend = series.length > 1 ? `<div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>` : '';
  const total = series.map((s) => `${s.name}: ${s.values.reduce((a, b) => a + b, 0)}`).join(', ');
  return `${legend}<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(total)}">${grid}${ticks}${lines}</svg>`;
}
