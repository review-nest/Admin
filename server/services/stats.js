/**
 * Single source of truth for every number shown on Dashboard AND Reports,
 * so both always agree (Acceptance checklist: "Dashboard totals aur detailed records consistent").
 */
const env = require('../config/env');
const { toMillis, dayKey, DAY } = require('../utils/helpers');

const st = (s) => String(s || 'pending').toLowerCase();
const isPaid = (w) => ['approved', 'paid', 'completed'].includes(st(w.status));
const isOpenWd = (w) => ['pending', 'processing'].includes(st(w.status));
const subTime = (s) => toMillis(s.createdAt) || toMillis(s.timestamp);
const decisionTime = (s) => toMillis(s.reviewedAt) || toMillis(s.updatedAt) || subTime(s);
const wdTime = (w) => toMillis(w.createdAt);
const paidTime = (w) => toMillis(w.paidAt) || toMillis(w.processedAt) || toMillis(w.updatedAt);
const userCreated = (u) => toMillis(u.createdAt);
const lastActive = (u) => Math.max(toMillis(u.lastHeartbeat), toMillis(u.lastActiveAt), toMillis(u.lastSeen));
const inRange = (ms, a, b) => ms >= a && ms < b;

function isOnline(u, now = Date.now()) {
  const hb = toMillis(u.lastHeartbeat);
  return hb > 0 && now - hb <= env.presenceWindowMs;
}

/** Metrics for [fromMs, toMs). Use (0, Infinity) for all-time. */
function computeMetrics({ users, tasks, subs, wds, finance = [] }, fromMs = 0, toMs = Infinity) {
  const subsIn = subs.filter((s) => inRange(subTime(s), fromMs, toMs));
  const pending = subsIn.filter((s) => st(s.status) === 'pending').length;
  const approved = subsIn.filter((s) => st(s.status) === 'approved').length;
  const rejected = subsIn.filter((s) => st(s.status) === 'rejected').length;

  // Task cost = reward of submissions APPROVED inside the period (by approval date)
  const taskCost = subs
    .filter((s) => st(s.status) === 'approved' && inRange(decisionTime(s), fromMs, toMs))
    .reduce((a, s) => a + Number(s.rewardAmount || 0), 0);

  const wdReq = wds.filter((w) => inRange(wdTime(w), fromMs, toMs));
  const paidList = wds.filter((w) => isPaid(w) && inRange(paidTime(w), fromMs, toMs));
  const paidAmount = paidList.reduce((a, w) => a + Number(w.paidAmount ?? w.amount ?? 0), 0);
  const openAmount = wds.filter(isOpenWd).reduce((a, w) => a + Number(w.amount || 0), 0); // liability NOW

  const activeUserIds = new Set(subsIn.map((s) => s.userId).filter(Boolean));
  const newUsers = users.filter((u) => inRange(userCreated(u), fromMs, toMs)).length;

  const fin = finance.filter((f) => f._fromMs >= fromMs && f._fromMs < toMs);
  const revenue = fin.reduce((a, f) => a + Number(f.revenue || 0), 0);
  const expenses = fin.reduce((a, f) => a + Number(f.expenses || 0), 0);

  return {
    submissions: subsIn.length, pending, approved, rejected,
    activeUsers: activeUserIds.size, newUsers,
    taskCost,
    withdrawalRequested: wdReq.reduce((a, w) => a + Number(w.amount || 0), 0),
    withdrawalRequestCount: wdReq.length,
    paidAmount, paidCount: paidList.length,
    pendingPayout: openAmount,
    pendingPayoutCount: wds.filter(isOpenWd).length,
    revenue, expenses,
    netProfit: revenue - taskCost - expenses,
  };
}

/** Task-wise breakdown for a period */
function taskBreakdown({ tasks, subs }, fromMs, toMs) {
  const map = new Map();
  const ensure = (id, title) => {
    if (!map.has(id)) map.set(id, { taskId: id, title: title || id, submissions: 0, pending: 0, approved: 0, rejected: 0, cost: 0 });
    return map.get(id);
  };
  tasks.forEach((t) => ensure(t.id, t.title || t.appName));
  subs.forEach((s) => {
    const t = ensure(s.taskId || 'general', s.taskTitle);
    if (inRange(subTime(s), fromMs, toMs)) {
      t.submissions += 1;
      t[st(s.status) === 'approved' ? 'approved' : st(s.status) === 'rejected' ? 'rejected' : 'pending'] += 1;
    }
    if (st(s.status) === 'approved' && inRange(decisionTime(s), fromMs, toMs)) t.cost += Number(s.rewardAmount || 0);
  });
  return [...map.values()].filter((t) => t.submissions || t.cost).sort((a, b) => b.submissions - a.submissions);
}

/** Day-by-day series for charts. */
function dailySeries({ users, subs, wds }, days) {
  const now = Date.now();
  const keys = [];
  for (let i = days - 1; i >= 0; i -= 1) keys.push(dayKey(now - i * DAY));
  const idx = Object.fromEntries(keys.map((k, i) => [k, i]));
  const z = () => keys.map(() => 0);
  const out = { labels: keys, submissions: z(), approved: z(), rejected: z(), newUsers: z(), payoutAmount: z(), payoutCount: z() };
  const add = (arr, ms, v = 1) => { const i = idx[dayKey(ms)]; if (i != null) arr[i] += v; };
  subs.forEach((s) => {
    add(out.submissions, subTime(s));
    if (st(s.status) === 'approved') add(out.approved, decisionTime(s));
    if (st(s.status) === 'rejected') add(out.rejected, decisionTime(s));
  });
  users.forEach((u) => add(out.newUsers, userCreated(u)));
  wds.filter(isPaid).forEach((w) => { add(out.payoutAmount, paidTime(w), Number(w.paidAmount ?? w.amount ?? 0)); add(out.payoutCount, paidTime(w)); });
  return out;
}

const pctChange = (cur, prev) => (prev === 0 ? (cur > 0 ? 100 : 0) : Math.round(((cur - prev) / prev) * 1000) / 10);

module.exports = {
  st, isPaid, isOpenWd, subTime, decisionTime, wdTime, paidTime, userCreated, lastActive, isOnline,
  computeMetrics, taskBreakdown, dailySeries, pctChange,
};
