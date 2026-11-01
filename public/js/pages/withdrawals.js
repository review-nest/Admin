import { api } from '../api.js';
import { $, $$, esc, icon, money, num, fmtDateTime, qs, on, toast, confirmDialog, formDialog, modal, statusBadge, badge, pager, empty, skeleton, errorBox, debounce, today, thisMonth } from '../ui.js';

const S = { folder: 'pending', q: '', method: 'all', month: '', from: '', to: '', page: 1 };
const FOLDERS = [['pending', 'Pending'], ['processing', 'Processing'], ['paid', 'Paid / Completed'], ['rejected', 'Rejected']];

export async function render(view, { ctx }) {
  const canW = ctx.can('withdrawals.write');
  view.innerHTML = `<div class="stack">
    <div class="tabs" id="ft" role="tablist"></div>
    <div class="toolbar">
      <div class="grow field"><span>Search user ID, name, withdrawal ID or reference</span><div class="search">${icon('search')}<input id="q" type="search" value="${esc(S.q)}"/></div></div>
      <label class="field"><span>Method</span><select id="m"><option value="all">All</option><option value="upi" ${S.method === 'upi' ? 'selected' : ''}>UPI</option><option value="bank" ${S.method === 'bank' ? 'selected' : ''}>Bank</option></select></label>
      <label class="field"><span>Month</span><input id="mo" type="month" value="${esc(S.month)}" max="${thisMonth()}"/></label>
      <label class="field"><span>From</span><input id="f" type="date" value="${esc(S.from)}"/></label>
      <label class="field"><span>To</span><input id="t" type="date" value="${esc(S.to)}"/></label>
    </div><div id="sum"></div><div id="wl">${skeleton(3)}</div></div>`;

  let last = null;
  const drawTabs = (counts) => { $('#ft').innerHTML = FOLDERS.map(([k, l]) => `<button class="tab" role="tab" data-f="${k}" aria-selected="${S.folder === k}">${l}<span class="n">${counts ? num(counts[k]) : ''}</span></button>`).join(''); };
  drawTabs();

  const row = (w) => {
    const dest = w.upi ? `UPI <span class="mono">${esc(w.upi)}</span>` : w.bank ? `${esc(w.bank.bankName || 'Bank')} <span class="mono">${esc(w.bank.account)}</span>${w.bank.ifsc ? ` · <span class="mono">${esc(w.bank.ifsc)}</span>` : ''}${w.bank.holder ? ` · ${esc(w.bank.holder)}` : ''}` : '—';
    return `<article class="card"><div class="row between" style="flex-wrap:nowrap;align-items:flex-start">
        <div style="min-width:0"><div class="row"><b style="font-size:1.15rem">${money(w.amount)}</b>${statusBadge(w.status === 'approved' ? 'paid' : w.status)}${badge(w.method, 'info')}</div>
          <div class="small bold trunc">${esc(w.userName)}</div><div class="tiny muted mono trunc">${esc(w.id)} · user <a href="#/users/${esc(w.userId)}">${esc(w.userId.slice(0, 12))}</a></div></div>
        <div class="right tiny muted nowrap">Requested<br/>${fmtDateTime(w.requestedAt)}</div></div>
      <div class="small" style="margin-top:8px">${dest}</div>
      ${w.folder === 'paid' ? `<div class="note" style="margin-top:8px;background:var(--ok-soft);color:#14663F">Paid ${money(w.paidAmount ?? w.amount)} on ${fmtDateTime(w.paidAt)} · Ref <b class="mono">${esc(w.transactionRef || '—')}</b>${w.processedBy ? ` · by ${esc(w.processedBy)}` : ''}</div>` : ''}
      ${w.folder === 'rejected' && w.reason ? `<div class="note bad" style="margin-top:8px">Reason: ${esc(w.reason)}</div>` : ''}
      ${w.flags.length ? `<div class="row" style="margin-top:8px">${w.flags.map((f) => `<span class="flag">${icon('alert')} ${esc(f)}</span>`).join('')}</div>` : ''}
      <div class="row" style="margin-top:12px">
        ${w.canReveal ? `<button class="btn sm" data-reveal="${esc(w.id)}">${icon('eye')} Show full details</button>` : ''}
        ${canW && w.folder === 'pending' ? `<button class="btn sm" data-proc="${esc(w.id)}">Start processing</button>` : ''}
        ${canW && ['pending', 'processing'].includes(w.folder) ? `<button class="btn sm success" data-paid="${esc(w.id)}" data-amt="${w.amount}">Mark paid</button><button class="btn sm danger" data-rej="${esc(w.id)}">Reject &amp; refund</button>` : ''}
      </div></article>`;
  };

  async function load() {
    const box = $('#wl');
    try {
      const r = await api(`/withdrawals${qs({ folder: S.folder, q: S.q, method: S.method, month: S.month, from: S.from, to: S.to, page: S.page })}`);
      last = r; drawTabs(r.counts);
      $('#sum').innerHTML = `<div class="note">${S.folder === 'pending' ? 'Total pending' : S.folder === 'paid' ? 'Total paid' : 'Total'} in this view: <b>${money(r.amounts[S.folder])}</b> across ${num(r.counts[S.folder])} request${r.counts[S.folder] === 1 ? '' : 's'}.</div>`;
      box.innerHTML = r.items.length ? `<div class="grid cards">${r.items.map(row).join('')}</div>${pager(r)}` : `<div class="card">${empty('Nothing here', 'No withdrawals match this folder and filters.')}</div>`;
    } catch (e) { box.innerHTML = errorBox(e.message); }
  }

  on($('#ft'), 'click', '[data-f]', (e, el) => { S.folder = el.dataset.f; S.page = 1; load(); });
  $('#q').addEventListener('input', debounce((e) => { S.q = e.target.value.trim(); S.page = 1; load(); }));
  $('#m').addEventListener('change', (e) => { S.method = e.target.value; S.page = 1; load(); });
  $('#mo').addEventListener('change', (e) => { S.month = e.target.value; S.from = S.to = ''; $('#f').value = $('#t').value = ''; S.page = 1; load(); });
  $('#f').addEventListener('change', (e) => { S.from = e.target.value; S.month = ''; $('#mo').value = ''; S.page = 1; load(); });
  $('#t').addEventListener('change', (e) => { S.to = e.target.value; S.month = ''; $('#mo').value = ''; S.page = 1; load(); });
  on(view, 'click', '[data-page]', (e, el) => { S.page = Number(el.dataset.page); load(); });

  on(view, 'click', '[data-reveal]', async (e, el) => {
    try {
      const d = await api(`/withdrawals/${el.dataset.reveal}/reveal`);
      const kv = [['UPI ID', d.upiId], ['Account holder', d.accountHolderName], ['Bank', d.bankName], ['Account number', d.accountNumber], ['IFSC', d.ifscCode]].filter(([, v]) => v);
      modal({ title: 'Payment details', body: `<div class="note warn">This view is recorded in the audit log.</div><dl class="kv">${kv.map(([k, v]) => `<dt>${k}</dt><dd class="mono">${esc(v)}</dd>`).join('')}</dl>`,
        actions: [...(d.upiId ? [{ label: 'Copy UPI ID', onClick: () => { navigator.clipboard?.writeText(d.upiId); toast('UPI ID copied', 'ok'); } }] : []), { label: 'Close', cls: 'primary', onClick: (x, c) => c.close() }] });
    } catch (err) { if (!err.cancelled) toast(err.message, 'err'); }
  });
  on(view, 'click', '[data-proc]', async (e, el) => { try { await api(`/withdrawals/${el.dataset.proc}/processing`, { method: 'POST' }); toast('Moved to Processing', 'ok'); load(); } catch (err) { toast(err.message, 'err'); } });
  on(view, 'click', '[data-paid]', async (e, el) => {
    const amount = Number(el.dataset.amt);
    const v = await formDialog({ title: `Mark ${money(amount)} as paid`, submitText: 'Confirm payment', note: 'Only confirm after the money has really been sent. The reference is saved with the payout.',
      fields: [{ name: 'transactionRef', label: 'Transaction / UTR reference', type: 'text', required: true, placeholder: 'e.g. 412345678901' }, { name: 'paidAmount', label: 'Amount paid (₹)', type: 'number', required: true, value: amount, min: 1, max: amount }, { name: 'paidAt', label: 'Payment date & time', type: 'datetime-local', value: new Date(Date.now() + 330 * 60000).toISOString().slice(0, 16) }],
      onSubmit: async (vals) => { await api(`/withdrawals/${el.dataset.paid}/paid`, { method: 'POST', body: { transactionRef: vals.transactionRef, paidAmount: vals.paidAmount, paidAt: vals.paidAt ? `${vals.paidAt}:00+05:30` : undefined } }); } });
    if (v) { toast('Marked as paid', 'ok'); ctx.refreshBadges(); load(); }
  });
  on(view, 'click', '[data-rej]', async (e, el) => {
    const v = await formDialog({ title: 'Reject this withdrawal?', submitText: 'Reject & refund', danger: true, note: 'The amount goes back to the user\'s wallet and they see your reason.',
      fields: [{ name: 'reason', label: 'Reason', type: 'text', required: true, placeholder: 'e.g. UPI ID is not valid' }],
      onSubmit: async (vals) => { await api(`/withdrawals/${el.dataset.rej}/reject`, { method: 'POST', body: { reason: vals.reason } }); } });
    if (v) { toast('Rejected and refunded', 'ok'); ctx.refreshBadges(); load(); }
  });
  await load();
}
