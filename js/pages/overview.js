import { api } from './api.js';
import { $, $$, esc, icon, money, num, timeAgo, skeleton, lineChart, on, toast, confirmDialog, formDialog } from '../ui.js';

const kpi = ({ tone, ico, label, value, sub = '', delta, href }) => `
  <${href ? `a href="${href}"` : 'div'} class="card kpi tone-${tone}" ${href ? 'style="text-decoration:none;color:inherit"' : ''}>
    <span class="ico">${icon(ico)}</span>
    <div class="grow"><div class="lbl">${esc(label)}</div><div class="val">${value}</div>
      ${delta != null ? `<div class="delta ${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}% <span class="muted">vs previous 30 days</span></div>` : sub ? `<div class="tiny muted">${esc(sub)}</div>` : ''}</div>
  </${href ? 'a' : 'div'}>`;

const ACTIVITY_ICON = { user: ['users', 'info'], submission: ['file', 'warn'], approved: ['check', 'ok'], rejected: ['xcircle', 'bad'], withdrawal: ['wallet', 'accent'] };
const ACTIVITY_LINK = { user: (i) => `#/users/${i.id}`, submission: () => '#/approvals', approved: () => '#/approvals?x=1', rejected: () => '#/approvals', withdrawal: () => '#/withdrawals' };

function charts(c) {
  return `<div class="grid cards">
    <div class="card flat"><h4>Task submissions</h4>${lineChart(c.labels, [{ name: 'Submissions', values: c.submissions, color: '#EE8A33' }])}</div>
    <div class="card flat"><h4>Approvals vs rejections</h4>${lineChart(c.labels, [{ name: 'Approved', values: c.approved, color: '#1F9D63' }, { name: 'Rejected', values: c.rejected, color: '#D1453B' }])}</div>
    <div class="card flat"><h4>New users</h4>${lineChart(c.labels, [{ name: 'New users', values: c.newUsers, color: '#3F6FD1' }])}</div>
    <div class="card flat"><h4>Payout trend</h4>${lineChart(c.labels, [{ name: 'Paid out', values: c.payoutAmount, color: '#7A5BD0' }], { money: true })}</div>
  </div>`;
}

export async function render(view, { ctx }) {
  const [s, c, r, m] = await Promise.all([api('/dashboard/summary'), api('/dashboard/charts?days=7'), api('/dashboard/recent'), api('/settings/maintenance')]);
  const f = s.finance;
  const canMaint = ctx.can('*');

  view.innerHTML = `<div class="stack">
    <section class="grid kpis" aria-label="Summary">
      ${kpi({ tone: 'info', ico: 'users', label: 'Total users', value: num(s.users.total), delta: s.users.growthPct })}
      ${kpi({ tone: 'ok', ico: 'check', label: 'Active users (7 days)', value: num(s.users.active7d) })}
      ${kpi({ tone: 'ok', ico: 'eye', label: 'Online now', value: s.presenceReliable ? num(s.users.online) : '—', sub: s.presenceReliable ? 'Live heartbeat' : 'No live heartbeat from the app yet' })}
      ${kpi({ tone: 'violet', ico: 'tasks', label: 'Total tasks', value: num(s.tasks.total), sub: `${s.tasks.active} active`, href: '#/tasks' })}
      ${kpi({ tone: 'accent', ico: 'file', label: 'Total submissions', value: num(s.submissions.total), delta: s.submissions.growthPct })}
      ${kpi({ tone: 'warn', ico: 'clock', label: 'Pending approvals', value: num(s.submissions.pending), href: '#/approvals' })}
      ${kpi({ tone: 'ok', ico: 'check', label: 'Approved', value: num(s.submissions.approved) })}
      ${kpi({ tone: 'bad', ico: 'xcircle', label: 'Rejected', value: num(s.submissions.rejected) })}
    </section>

    <section class="grid kpis" aria-label="Finance">
      ${kpi({ tone: 'info', ico: 'wallet', label: 'Withdrawals requested', value: money(f.withdrawalRequested), href: '#/withdrawals' })}
      ${kpi({ tone: 'warn', ico: 'clock', label: 'Pending payout', value: money(f.pendingPayout), sub: `${f.pendingPayoutCount} requests`, href: '#/withdrawals' })}
      ${kpi({ tone: 'ok', ico: 'check', label: 'Paid out', value: money(f.paidAmount), delta: f.payoutGrowthPct })}
      ${kpi({ tone: 'accent', ico: 'tasks', label: 'Total task cost', value: money(f.taskCost), sub: 'Approved rewards' })}
      ${kpi({ tone: 'violet', ico: 'trend', label: 'Platform revenue', value: money(f.revenue), sub: 'Entered in Reports', href: '#/reports' })}
      ${kpi({ tone: f.netProfit >= 0 ? 'ok' : 'bad', ico: 'chart', label: 'Estimated net profit', value: money(f.netProfit), sub: 'Revenue − task cost − expenses' })}
      ${kpi({ tone: 'info', ico: 'wallet', label: 'Wallet liability', value: money(f.walletLiability), sub: 'Total user balances' })}
    </section>

    <section class="card">
      <div class="card-head"><h2>Trends</h2>
        <div class="tabs" role="tablist" style="margin:0" id="range-tabs">
          ${[7, 30, 90].map((d) => `<button class="tab" role="tab" data-days="${d}" aria-selected="${d === 7}">${d} days</button>`).join('')}
        </div></div>
      <div id="charts">${charts(c)}</div>
    </section>

    <section class="grid cols-2">
      <div class="card"><div class="card-head"><h2>Recent activity</h2></div>
        <div class="list">${r.items.length ? r.items.map((i) => { const [ic, tone] = ACTIVITY_ICON[i.kind] || ['file', 'info']; return `<a class="item" href="${(ACTIVITY_LINK[i.kind] || (() => '#/'))(i)}" style="text-decoration:none;color:inherit"><span class="kpi tone-${tone}"><span class="ico">${icon(ic)}</span></span><div class="grow"><div class="bold trunc">${esc(i.title)}</div><div class="small muted trunc">${esc(i.sub)}</div></div><span class="tiny muted nowrap">${timeAgo(i.at)}</span></a>`; }).join('') : '<div class="empty"><b>No activity yet</b>New users, submissions and withdrawals show up here.</div>'}</div>
      </div>
      <div class="stack">
        <div class="card"><div class="card-head"><h2>Quick actions</h2></div>
          <div class="qa">
            ${ctx.can('tasks.write') ? `<a href="#/tasks/new">${icon('plus')}Add task</a>` : ''}
            ${ctx.can('comments.write') ? `<a href="#/feedback">${icon('message')}Add feedback</a>` : ''}
            ${ctx.can('approvals.read') ? `<a href="#/approvals">${icon('check')}Pending approvals</a>` : ''}
            ${ctx.can('withdrawals.read') ? `<a href="#/withdrawals">${icon('wallet')}Withdrawals</a>` : ''}
            ${ctx.can('notifications.send') ? `<a href="#/notifications">${icon('bell')}Send notification</a>` : ''}
          </div></div>
        <div class="card" id="maint">
          <div class="card-head"><h2>Maintenance mode</h2><span id="maint-state" class="badge ${m.enabled ? 'warn' : 'ok'}">${m.enabled ? 'ON' : 'OFF'}</span></div>
          <div class="row" style="margin-bottom:12px"><label class="switch" title="Turn maintenance mode on or off"><input type="checkbox" id="maint-toggle" ${m.enabled ? 'checked' : ''} ${canMaint ? '' : 'disabled'} aria-label="Maintenance mode"/><i></i></label>
            <span class="small muted grow">${m.enabled ? 'Users currently see the message below.' : 'The app is running normally.'}</span></div>
          <label class="field"><span>Message shown to users</span><textarea id="maint-msg" rows="3" ${canMaint ? '' : 'disabled'}>${esc(m.message)}</textarea></label>
          ${canMaint ? `<div class="row" style="margin-top:10px"><button class="btn sm" id="maint-save">${icon('edit')} Update message</button></div>` : '<p class="tiny muted">Only a Super Admin can change this.</p>'}
        </div>
      </div>
    </section>
  </div>`;

  // charts range
  on($('#range-tabs'), 'click', '[data-days]', async (e, el) => {
    $$('#range-tabs .tab').forEach((t) => t.setAttribute('aria-selected', String(t === el)));
    $('#charts').innerHTML = skeleton(1);
    try { $('#charts').innerHTML = charts(await api(`/dashboard/charts?days=${el.dataset.days}`)); } catch (err) { toast(err.message, 'err'); }
  });

  // maintenance
  const save = async (enabled, message) => {
    await api('/settings/maintenance', { method: 'PUT', body: { enabled, message, title: 'Maintenance Mode' } });
    ctx.refreshBadges();
  };
  $('#maint-toggle')?.addEventListener('change', async (e) => {
    const want = e.target.checked;
    const ok = await confirmDialog({
      title: want ? 'Turn maintenance mode ON?' : 'Turn maintenance mode OFF?',
      message: want ? 'Users will see the maintenance message and cannot use the app until you turn it off.' : 'The app will open for all users again.',
      confirmText: want ? 'Turn ON' : 'Turn OFF', danger: want,
    });
    if (!ok) { e.target.checked = !want; return; }
    try {
      await save(want, $('#maint-msg').value);
      $('#maint-state').textContent = want ? 'ON' : 'OFF'; $('#maint-state').className = `badge ${want ? 'warn' : 'ok'}`;
      toast(want ? 'Maintenance mode is ON' : 'Maintenance mode is OFF', 'ok');
    } catch (err) { e.target.checked = !want; if (!err.cancelled) toast(err.message, 'err'); }
  });
  $('#maint-save')?.addEventListener('click', async () => {
    try { await save($('#maint-toggle').checked, $('#maint-msg').value); toast('Message updated', 'ok'); } catch (err) { if (!err.cancelled) toast(err.message, 'err'); }
  });
}
