const express = require('express');
const { db, FieldValue } = require('../config/firebase');
const { requirePerm, requireRecentAuth } = require('../middleware/auth');
const { asyncHandler, HttpError, parseRange, monthRange, dayKey, num, str, escapeCsv, YM } = require('../utils/helpers');
const { audit } = require('../utils/audit');
const S = require('../services/stats');
const env = require('../config/env');
const { loadAll } = require('./dashboard');

const router = express.Router();

async function build(req) {
  const month = YM.test(req.query.month || '') ? req.query.month : '';
  const range = parseRange(month ? { month } : req.query);
  const fromMs = Number.isFinite(range.fromMs) ? range.fromMs : monthRange(dayKey(Date.now()).slice(0, 7)).fromMs;
  const toMs = Number.isFinite(range.toMs) ? range.toMs : monthRange(dayKey(Date.now()).slice(0, 7)).toMs;
  const data = await loadAll();
  const metrics = S.computeMetrics(data, fromMs, toMs);
  const tasks = S.taskBreakdown(data, fromMs, toMs);
  const days = Math.min(62, Math.max(1, Math.round((Math.min(toMs, Date.now() + 1) - fromMs) / 86400000)));
  const series = S.dailySeries(data, 62);
  return { fromMs, toMs, month, metrics, tasks, series, days };
}

router.get('/monthly', requirePerm('reports.read'), asyncHandler(async (req, res) => {
  const r = await build(req);
  const sinceKey = dayKey(r.fromMs);
  const untilKey = dayKey(r.toMs - 1);
  const keep = r.series.labels.map((l, i) => (l >= sinceKey && l <= untilKey ? i : -1)).filter((i) => i >= 0);
  const pickIdx = (a) => keep.map((i) => a[i]);
  const finDoc = r.month ? (await db.collection('monthlyFinance').doc(r.month).get()).data() || {} : null;
  res.json({
    period: { fromMs: r.fromMs, toMs: r.toMs, month: r.month, timezone: `UTC${env.tzOffsetMinutes >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(env.tzOffsetMinutes) / 60)).padStart(2, '0')}:${String(Math.abs(env.tzOffsetMinutes) % 60).padStart(2, '0')}` },
    metrics: r.metrics, tasks: r.tasks,
    daily: { labels: pickIdx(r.series.labels), submissions: pickIdx(r.series.submissions), approved: pickIdx(r.series.approved), rejected: pickIdx(r.series.rejected), payoutAmount: pickIdx(r.series.payoutAmount) },
    finance: finDoc ? { revenue: num(finDoc.revenue), expenses: num(finDoc.expenses), notes: finDoc.notes || '' } : null,
  });
}));

// Revenue / expenses are entered by a Super Admin per month; profit = revenue - task cost - expenses.
router.put('/finance/:month', requirePerm('*'), requireRecentAuth, asyncHandler(async (req, res) => {
  if (!YM.test(req.params.month)) throw new HttpError(400, 'Month must be YYYY-MM');
  const revenue = num(req.body?.revenue); const expenses = num(req.body?.expenses);
  if (revenue < 0 || expenses < 0) throw new HttpError(400, 'Amounts cannot be negative');
  const ref = db.collection('monthlyFinance').doc(req.params.month);
  const before = (await ref.get()).data() || {};
  await ref.set({ revenue, expenses, notes: str(req.body.notes, 300), updatedAt: FieldValue.serverTimestamp(), updatedBy: req.admin.email }, { merge: true });
  await audit(req, 'report.finance_update', { type: 'monthlyFinance', id: req.params.month }, { revenue: num(before.revenue), expenses: num(before.expenses) }, { revenue, expenses });
  res.json({ ok: true });
}));

router.get('/monthly.csv', requirePerm('reports.read'), asyncHandler(async (req, res) => {
  const r = await build(req);
  const m = r.metrics;
  const rows = [
    ['Report period', `${dayKey(r.fromMs)} to ${dayKey(r.toMs - 1)} (UTC${env.tzOffsetMinutes >= 0 ? '+' : ''}${env.tzOffsetMinutes / 60}h)`],
    ['Submissions', m.submissions], ['Approved', m.approved], ['Rejected', m.rejected], ['Pending', m.pending],
    ['Active users', m.activeUsers], ['New registrations', m.newUsers],
    ['Task cost (approved rewards)', m.taskCost], ['Withdrawal requested', m.withdrawalRequested],
    ['Paid payouts', m.paidAmount], ['Pending payout liability (now)', m.pendingPayout],
    ['Revenue', m.revenue], ['Expenses', m.expenses], ['Net profit', m.netProfit], [],
    ['Task', 'Task ID', 'Submissions', 'Pending', 'Approved', 'Rejected', 'Reward cost'],
    ...r.tasks.map((t) => [t.title, t.taskId, t.submissions, t.pending, t.approved, t.rejected, t.cost]),
  ];
  await audit(req, 'report.export_csv', { type: 'report', id: r.month || 'custom' }, null, { rows: rows.length });
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="report_${r.month || 'custom'}.csv"` });
  res.send('\ufeff' + rows.map((row) => row.map(escapeCsv).join(',')).join('\n'));
}));

module.exports = router;
