/* Offline self-test for the pure logic (no Firebase, no network).  Run: npm test */
const assert = require('assert');
const Module = require('module');
// dotenv is only needed to read .env; the pure-logic tests do not need it
const realLoad = Module._load;
Module._load = function (req, ...rest) { if (req === 'dotenv') return { config() {} }; return realLoad.call(this, req, ...rest); };
process.env.TZ_OFFSET_MINUTES = '330';
const H = require('../server/utils/helpers');
const S = require('../server/services/stats');
const P = require('../server/services/playstore');
const T = require('../server/services/templates');

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('  ok  ' + name); };

t('month range uses IST boundaries', () => {
  const r = H.monthRange('2026-10');
  assert.strictEqual(new Date(r.fromMs).toISOString(), '2026-09-30T18:30:00.000Z');
  assert.strictEqual(new Date(r.toMs).toISOString(), '2026-10-31T18:30:00.000Z');
});
t('single date filter is exactly 24h', () => {
  const r = H.parseRange({ date: '2026-11-01' });
  assert.strictEqual(r.toMs - r.fromMs, 86400000);
});
t('custom from/to is inclusive of the end day', () => {
  const r = H.parseRange({ from: '2026-10-01', to: '2026-10-03' });
  assert.strictEqual(r.toMs - r.fromMs, 3 * 86400000);
});
t('masking hides payment data', () => {
  assert.strictEqual(H.maskAccount('123456789012'), 'XXXXXXXX9012');
  assert.strictEqual(H.maskUpi('rahul@okaxis'), 'ra***@okaxis');
});
t('csv escaping blocks formula injection', () => {
  assert.strictEqual(H.escapeCsv('=SUM(A1)'), "'=SUM(A1)");
  assert.strictEqual(H.escapeCsv('a,b'), '"a,b"');
});
t('pagination', () => {
  const p = H.paginate(Array.from({ length: 45 }, (_, i) => i), { page: 3, limit: 20 });
  assert.strictEqual(p.items.length, 5); assert.strictEqual(p.pages, 3);
});

const day = 86400000; const now = Date.now();
const data = {
  users: [{ id: 'u1', createdAt: now - day, walletBalance: 50 }, { id: 'u2', createdAt: now - 40 * day }],
  tasks: [{ id: 't1', title: 'Game Master' }],
  subs: [
    { id: 's1', taskId: 't1', userId: 'u1', status: 'approved', rewardAmount: 10, createdAt: now - day, reviewedAt: now - day / 2 },
    { id: 's2', taskId: 't1', userId: 'u1', status: 'pending', rewardAmount: 10, createdAt: now - day },
    { id: 's3', taskId: 't1', userId: 'u2', status: 'rejected', rewardAmount: 10, createdAt: now - 2 * day },
  ],
  wds: [
    { id: 'w1', amount: 500, status: 'approved', createdAt: now - day, paidAt: now - day / 2 },
    { id: 'w2', amount: 250, status: 'pending', createdAt: now - day },
  ],
  finance: [],
};
t('metrics: counts agree with records', () => {
  const m = S.computeMetrics(data);
  assert.deepStrictEqual([m.submissions, m.pending, m.approved, m.rejected], [3, 1, 1, 1]);
  assert.strictEqual(m.taskCost, 10); assert.strictEqual(m.paidAmount, 500);
  assert.strictEqual(m.pendingPayout, 250); assert.strictEqual(m.activeUsers, 2);
});
t('metrics: a 7-day window excludes older rows', () => {
  const m = S.computeMetrics(data, now - 1.5 * day, now + 1);
  assert.strictEqual(m.submissions, 2);
});
t('task breakdown sums to total', () => {
  const b = S.taskBreakdown(data, 0, Infinity);
  assert.strictEqual(b[0].submissions, 3); assert.strictEqual(b[0].cost, 10);
});
t('daily series has the requested length', () => {
  assert.strictEqual(S.dailySeries(data, 7).labels.length, 7);
});

t('play link validation', () => {
  assert.strictEqual(P.parsePlayUrl('https://play.google.com/store/apps/details?id=com.example.app&hl=en'), 'com.example.app');
  assert.throws(() => P.parsePlayUrl('https://evil.com/store/apps/details?id=com.example.app'));
  assert.throws(() => P.parsePlayUrl('https://play.google.com/store/apps/details'));
  assert.throws(() => P.parsePlayUrl('not a url'));
});
t('play page parsing', () => {
  const m = P.parseHtml('<meta property="og:title" content="Candy Crush - Apps on Google Play"><meta property="og:image" content="https://play-lh.googleusercontent.com/abc=w240"><script>"ratingValue":"4.4"</script>');
  assert.strictEqual(m.appName, 'Candy Crush'); assert.strictEqual(m.rating, '4.4'); assert.ok(m.iconUrl.endsWith('=s160'));
});
t('notification content guard', () => {
  assert.ok(T.findSensitive('Paid to 123456789012').length);
  assert.ok(T.findSensitive('send to rahul@okaxis').length);
  assert.strictEqual(T.findSensitive('Your withdrawal has been paid.').length, 0);
});

console.log(`\n${n} checks passed`);
