import { api, downloadFile } from '../api.js';
import { $, esc, icon, money, num, fmtDate, qs, on, toast, formDialog, skeleton, errorBox, lineChart, saveBlob, thisMonth } from '../ui.js';

const S = { month: thisMonth(), from: '', to: '', custom: false };

export async function render(view, { ctx }) {
  view.innerHTML = `<div class="stack">
    <div class="toolbar">
      <label class="field"><span>Month</span><input id="mo" type="month" value="${esc(S.month)}" max="${thisMonth()}"/></label>
      <label class="check" style="min-height:42px"><input type="checkbox" id="cu" ${S.custom ? 'checked' : ''}/> Custom range</label>
      <label class="field ${S.custom ? '' : 'hidden'}" id="wf"><span>From</span><input id="f" type="date" value="${esc(S.from)}"/></label>
      <label class="field ${S.custom ? '' : 'hidden'}" id="wt"><span>To</span><input id="t" type="date" value="${esc(S.to)}"/></label>
      <button class="btn" id="csv">${icon('download')} Download CSV</button>
    </div><div id="rep">${skeleton(3)}</div></div>`;

  const params = () => (S.custom ? { from: S.from, to: S.to } : { month: S.month });
  async function load() {
    const box = $('#rep');
    if (S.custom && !S.from && !S.to) { box.innerHTML = '<div class="note">Pick a start and end date.</div>'; return; }
    box.innerHTML = skeleton(3);
    try {
      const r = await api(`/reports/monthly${qs(params())}`); const m = r.metrics;
      const tile = (l, v, tone = '') => `<div class="card"><div class="small muted">${l}</div><div class="bold" style="font-size:1.25rem;${tone ? `color:var(--${tone})` : ''}">${v}</div></div>`;
      box.innerHTML = `<div class="stack">
        <div class="note">Period: ${fmtDate(r.period.fromMs)} – ${fmtDate(r.period.toMs - 1)} (${esc(r.period.timezone)}). Submissions are counted by submitted date; task cost by approval date; paid payouts by payment date.</div>
        <div class="grid kpis">${tile('Task submissions', num(m.submissions))}${tile('Approved', num(m.approved), 'ok')}${tile('Rejected', num(m.rejected), 'bad')}${tile('Pending', num(m.pending), 'warn')}${tile('Active users', num(m.activeUsers))}${tile('New registrations', num(m.newUsers))}</div>
        <div class="grid kpis">${tile('Task cost (rewards)', money(m.taskCost))}${tile('Withdrawal requested', money(m.withdrawalRequested))}${tile('Paid payouts', money(m.paidAmount), 'ok')}${tile('Pending payout (now)', money(m.pendingPayout), 'warn')}${tile('Platform revenue', money(m.revenue))}${tile('Operational expenses', money(m.expenses))}${tile('Net profit', money(m.netProfit), m.netProfit >= 0 ? 'ok' : 'bad')}</div>
        ${r.finance && ctx.can('*') ? `<div class="card soft row between"><span class="small">Revenue ${money(r.finance.revenue)} · Expenses ${money(r.finance.expenses)}${r.finance.notes ? ` · ${esc(r.finance.notes)}` : ''}</span><button class="btn sm" id="fin">${icon('edit')} Edit revenue &amp; expenses</button></div>` : (!S.custom ? '<div class="note">Revenue and expenses are entered by a Super Admin for each month.</div>' : '')}
        ${r.daily.labels.length ? `<div class="card"><h3>Daily activity</h3>${lineChart(r.daily.labels, [{ name: 'Submitted', values: r.daily.submissions, color: '#EE8A33' }, { name: 'Approved', values: r.daily.approved, color: '#1F9D63' }, { name: 'Rejected', values: r.daily.rejected, color: '#D1453B' }])}</div>` : ''}
        <div class="card"><h3 style="margin-bottom:8px">Task-wise breakdown</h3>${r.tasks.length ? `<div class="rows">${r.tasks.map((t) => `<div class="r"><div class="trunc"><b>${esc(t.title)}</b><div class="tiny muted mono">${esc(t.taskId.slice(0, 10))}</div></div><div class="right small"><b>${num(t.submissions)}</b> submitted · <span style="color:var(--ok)">${num(t.approved)}</span> / <span style="color:var(--bad)">${num(t.rejected)}</span> / <span style="color:var(--warn)">${num(t.pending)}</span><div class="tiny muted">Cost ${money(t.cost)}</div></div></div>`).join('')}</div><p class="tiny muted">Approved / rejected / pending</p>` : '<p class="muted small">No task activity in this period.</p>'}</div></div>`;
      $('#fin')?.addEventListener('click', async () => {
        const v = await formDialog({ title: `Revenue & expenses · ${S.month}`, note: 'Net profit = revenue − task cost − expenses.', fields: [{ name: 'revenue', label: 'Platform revenue (₹)', type: 'number', required: true, value: r.finance.revenue, min: 0 }, { name: 'expenses', label: 'Operational expenses (₹)', type: 'number', required: true, value: r.finance.expenses, min: 0 }, { name: 'notes', label: 'Notes', type: 'text', value: r.finance.notes }],
          onSubmit: async (vals) => { await api(`/reports/finance/${S.month}`, { method: 'PUT', body: vals }); } });
        if (v) { toast('Saved', 'ok'); load(); }
      });
    } catch (e) { box.innerHTML = errorBox(e.message); }
  }
  $('#mo').addEventListener('change', (e) => { if (e.target.value) { S.month = e.target.value; load(); } });
  $('#cu').addEventListener('change', (e) => { S.custom = e.target.checked; $('#wf').classList.toggle('hidden', !S.custom); $('#wt').classList.toggle('hidden', !S.custom); load(); });
  $('#f').addEventListener('change', (e) => { S.from = e.target.value; load(); });
  $('#t').addEventListener('change', (e) => { S.to = e.target.value; load(); });
  $('#csv').addEventListener('click', async () => {
    try { const { blob, name } = await downloadFile(`/reports/monthly.csv${qs(params())}`, 'report.csv'); saveBlob(blob, name); toast('Report downloaded', 'ok'); } catch (e) { toast(e.message, 'err'); }
  });
  await load();
}
