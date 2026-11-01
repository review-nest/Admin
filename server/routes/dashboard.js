const express = require('express');
const { fetchAll, SUB_LIGHT, USER_LIGHT, WD_FIELDS } = require('../utils/db');
const { requirePerm } = require('../middleware/auth');
const { asyncHandler, toMillis, DAY } = require('../utils/helpers');
const S = require('../services/stats');

const router = express.Router();
router.use(requirePerm('dashboard.read'));

async function loadAll() {
  const [users, tasks, subs, wds, fin] = await Promise.all([
    fetchAll('users', { select: USER_LIGHT }),
    fetchAll('tasks', { select: ['title', 'appName', 'status', 'active', 'rewardInr', 'rewardAmount'] }),
    fetchAll('submissions', { select: SUB_LIGHT }),
    fetchAll('withdrawals', { select: WD_FIELDS }),
    fetchAll('monthlyFinance'),
  ]);
  const { monthRange } = require('../utils/helpers');
  const finance = fin.map((f) => ({ ...f, _fromMs: /^\d{4}-\d{2}$/.test(f.id) ? monthRange(f.id).fromMs : 0 }));
  return { users, tasks, subs, wds, finance };
}


router.get('/summary', asyncHandler(async (req, res) => {
  const data = await loadAll();
  const now = Date.now();
  const all = S.computeMetrics(data);
  const d30 = S.computeMetrics(data, now - 30 * DAY, now + 1);
  const p30 = S.computeMetrics(data, now - 60 * DAY, now - 30 * DAY);
  const activeTasks = data.tasks.filter((t) => (t.status ? t.status === 'active' : t.active !== false)).length;
  const online = data.users.filter((u) => S.isOnline(u, now)).length;
  const active7 = data.users.filter((u) => S.lastActive(u) > now - 7 * DAY).length;
  res.json({
    users: { total: data.users.length, active7d: Math.max(active7, S.computeMetrics(data, now - 7 * DAY, now + 1).activeUsers), online, growthPct: S.pctChange(d30.newUsers, p30.newUsers) },
    tasks: { total: data.tasks.length, active: activeTasks },
    submissions: { total: all.submissions, pending: all.pending, approved: all.approved, rejected: all.rejected, growthPct: S.pctChange(d30.submissions, p30.submissions) },
    finance: {
      withdrawalRequested: all.withdrawalRequested, pendingPayout: all.pendingPayout, pendingPayoutCount: all.pendingPayoutCount,
      paidAmount: all.paidAmount, taskCost: all.taskCost, revenue: all.revenue, expenses: all.expenses, netProfit: all.netProfit,
      walletLiability: data.users.reduce((a, u) => a + Number(u.walletBalance || 0), 0),
      payoutGrowthPct: S.pctChange(d30.paidAmount, p30.paidAmount),
    },
    presenceReliable: data.users.some((u) => toMillis(u.lastHeartbeat) > 0),
  });
}));

router.get('/charts', asyncHandler(async (req, res) => {
  const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 7;
  const { users, subs, wds } = await loadAll();
  res.json(S.dailySeries({ users, subs, wds }, days));
}));

router.get('/recent', asyncHandler(async (req, res) => {
  const { users, subs, wds } = await loadAll();
  const items = [];
  users.forEach((u) => items.push({ kind: 'user', at: S.userCreated(u), title: 'New user registered', sub: u.fullName || u.email || u.id, id: u.id }));
  subs.forEach((s) => {
    const status = S.st(s.status);
    if (status === 'pending') items.push({ kind: 'submission', at: S.subTime(s), title: 'New submission', sub: `${s.taskTitle || 'Task'} · ${s.userName || s.userId || ''}`, id: s.id });
    else items.push({ kind: status, at: S.decisionTime(s), title: status === 'approved' ? 'Task approved' : 'Task rejected', sub: `${s.taskTitle || 'Task'} · ${s.userName || ''}`, id: s.id });
  });
  wds.forEach((w) => items.push({ kind: 'withdrawal', at: S.wdTime(w), title: `Withdrawal ${S.st(w.status)}`, sub: `₹${Number(w.amount || 0)} · ${w.userName || w.userId || ''}`, id: w.id }));
  res.json({ items: items.filter((i) => i.at).sort((a, b) => b.at - a.at).slice(0, 12) });
}));

module.exports = router;
module.exports.loadAll = loadAll;
