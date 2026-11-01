const { HttpError } = require('../utils/helpers');

const PKG = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/;

/** Validate a Google Play URL and return the package id. Throws 400 if not valid. */
function parsePlayUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { throw new HttpError(400, 'Enter a full Google Play link (https://play.google.com/store/apps/details?id=...)', 'BAD_LINK'); }
  if (u.protocol !== 'https:' || u.hostname !== 'play.google.com' || !u.pathname.startsWith('/store/apps/details')) {
    throw new HttpError(400, 'Only Google Play Store app links are accepted.', 'BAD_LINK');
  }
  const id = u.searchParams.get('id') || '';
  if (!PKG.test(id)) throw new HttpError(400, 'The link has no valid app id (?id=com.example.app).', 'BAD_LINK');
  return id;
}

const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

function parseHtml(html) {
  const title = html.match(/property="og:title"\s+content="([^"]+)"/i) || html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const img = html.match(/property="og:image"\s+content="([^"]+)"/i) || html.match(/https:\/\/play-lh\.googleusercontent\.com\/[a-zA-Z0-9_-]+/);
  const dev = html.match(/\/store\/apps\/dev(?:eloper)?\?id=[^"]*"[^>]*>(?:<[^>]+>)*([^<]+)</i) || html.match(/itemprop="author"[^>]*>[\s\S]{0,200}?itemprop="name"[^>]*content="([^"]+)"/i);
  const rating = html.match(/"ratingValue"\s*:\s*"?([0-9.]+)"?/i);
  const dl = html.match(/>([0-9.,]+[KMBTkmbt]?\+?)<\/div><div[^>]*>Downloads/i);
  const desc = html.match(/property="og:description"\s+content="([^"]+)"/i);
  return {
    appName: title ? decode(title[1]).replace(/\s*-\s*Apps on Google Play.*$/i, '').trim() : '',
    iconUrl: img ? `${(img[1] || img[0]).split('=')[0]}=s160` : '',
    developer: dev ? decode(dev[1]).trim() : '',
    rating: rating ? Number(rating[1]).toFixed(1) : '',
    downloads: dl ? dl[1] : '',
    description: desc ? decode(desc[1]).slice(0, 400) : '',
  };
}

/** Fetch store metadata. NEVER throws for network failure - returns ok:false so the UI falls back to manual entry. */
async function fetchMeta(url) {
  const appId = parsePlayUrl(url); // throws on invalid link
  const target = `https://play.google.com/store/apps/details?id=${encodeURIComponent(appId)}&hl=en&gl=IN`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(target, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AnyTaskAdmin/1.0)', 'Accept-Language': 'en-IN,en;q=0.9' } });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, appId, reason: `Play Store replied ${res.status}` };
    const meta = parseHtml(await res.text());
    if (!meta.appName) return { ok: false, appId, reason: 'Could not read app details from the store page.' };
    return { ok: true, appId, ...meta };
  } catch (e) {
    return { ok: false, appId, reason: 'Play Store could not be reached. Fill the details manually.' };
  }
}

module.exports = { parsePlayUrl, fetchMeta, parseHtml };
