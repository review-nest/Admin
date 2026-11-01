import { getToken, forceReauth } from '/auth.js';

/**
 * api('/tasks?page=1')                         -> JSON
 * api('/tasks', {method:'POST', body:{...}})   -> JSON
 * api(path, {raw:true})                        -> fetch Response (for images / ZIP / CSV)
 * Automatically re-prompts for login when the server says REAUTH_REQUIRED and retries once.
 */
export async function api(path, { method = 'GET', body, raw = false, _retry = 0 } = {}) {
  const token = await getToken();
  const res = await fetch(`/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.ok) return raw ? res : res.json();

  let data = {};
  try { data = await res.json(); } catch { /* not json */ }
  if (res.status === 401 && data.code === 'REAUTH_REQUIRED' && _retry < 1) {
    await forceReauth();
    return api(path, { method, body, raw, _retry: _retry + 1 });
  }
  if (res.status === 401 && data.code === 'BAD_TOKEN' && _retry < 1) {
    await getToken(true);
    return api(path, { method, body, raw, _retry: _retry + 1 });
  }
  const err = new Error(data.error || `Request failed (${res.status})`);
  err.status = res.status; err.code = data.code; err.data = data;
  throw err;
}

export async function downloadFile(path, fallbackName) {
  const res = await api(path, { raw: true });
  const cd = res.headers.get('content-disposition') || '';
  const name = (cd.match(/filename="([^"]+)"/) || [])[1] || fallbackName;
  return { blob: await res.blob(), name };
}
