const env = require('../config/env');

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Firestore Timestamp | {seconds} | number | ISO string -> epoch ms */
function toMillis(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v.seconds != null || v._seconds != null) {
    return (v.seconds ?? v._seconds) * 1000 + Math.floor((v.nanoseconds ?? v._nanoseconds ?? 0) / 1e6);
  }
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

/** 'YYYY-MM-DD' -> epoch ms of 00:00 in the configured timezone */
function dayStartMs(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d) - env.tzOffsetMinutes * 60000;
}

/** epoch ms -> 'YYYY-MM-DD' in configured timezone */
function dayKey(ms) {
  return new Date(ms + env.tzOffsetMinutes * 60000).toISOString().slice(0, 10);
}

/** 'YYYY-MM' -> { fromMs, toMs } (toMs exclusive) in configured timezone */
function monthRange(ym) {
  if (!YM.test(ym)) throw new HttpError(400, 'Month must be YYYY-MM');
  const [y, m] = ym.split('-').map(Number);
  const fromMs = Date.UTC(y, m - 1, 1) - env.tzOffsetMinutes * 60000;
  const toMs = Date.UTC(y, m, 1) - env.tzOffsetMinutes * 60000;
  return { fromMs, toMs };
}

/**
 * Query -> {fromMs,toMs}. Supports range=24h|7d|30d|custom, date=YYYY-MM-DD, month=YYYY-MM, from/to (YYYY-MM-DD, inclusive)
 */
function parseRange(q = {}) {
  const now = Date.now();
  if (q.date && YMD.test(q.date)) {
    const s = dayStartMs(q.date);
    return { fromMs: s, toMs: s + DAY };
  }
  if (q.month && YM.test(q.month)) return monthRange(q.month);
  switch (q.range) {
    case '24h': return { fromMs: now - 24 * HOUR, toMs: now + 1 };
    case '7d': return { fromMs: now - 7 * DAY, toMs: now + 1 };
    case '30d': return { fromMs: now - 30 * DAY, toMs: now + 1 };
    default: break;
  }
  if ((q.from && YMD.test(q.from)) || (q.to && YMD.test(q.to))) {
    const fromMs = q.from && YMD.test(q.from) ? dayStartMs(q.from) : 0;
    const toMs = q.to && YMD.test(q.to) ? dayStartMs(q.to) + DAY : Infinity;
    return { fromMs, toMs };
  }
  return { fromMs: 0, toMs: Infinity };
}

function pageParams(q, defLimit = 20, maxLimit = 100) {
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(q.limit, 10) || defLimit));
  return { page, limit };
}

function paginate(arr, q, defLimit = 20) {
  const { page, limit } = pageParams(q, defLimit);
  const total = arr.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  const p = Math.min(page, pages);
  return { items: arr.slice((p - 1) * limit, p * limit), page: p, pages, total, limit };
}

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const str = (v, max = 500) => String(v == null ? '' : v).trim().slice(0, max);
const lc = (v) => String(v || '').toLowerCase();

/** Mask helpers - sensitive payment data is masked by default */
function maskAccount(acc) {
  const s = String(acc || '');
  if (!s) return '';
  return 'X'.repeat(Math.max(0, s.length - 4)) + s.slice(-4);
}
function maskUpi(upi) {
  const s = String(upi || '');
  const at = s.indexOf('@');
  if (at < 1) return s ? s.slice(0, 2) + '***' : '';
  return s.slice(0, Math.min(2, at)) + '***' + s.slice(at);
}

function pick(obj, keys) {
  const out = {};
  keys.forEach((k) => { if (obj && obj[k] !== undefined) out[k] = obj[k]; });
  return out;
}

function escapeCsv(v) {
  const s = String(v == null ? '' : v);
  // neutralise spreadsheet formula injection
  const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  return /[",\n\r]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
}

module.exports = {
  HttpError, asyncHandler, toMillis, dayStartMs, dayKey, monthRange, parseRange, pageParams, paginate,
  num, str, lc, maskAccount, maskUpi, pick, escapeCsv, HOUR, DAY, YMD, YM,
};
