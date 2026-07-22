const crypto = require('crypto');

// Lightweight, self-contained signed session tokens (HMAC-SHA256, not a full JWT library —
// no extra dependency needed for this small a need). Issued by functions/login.js after the
// frontend has confirmed a real login (Entra ID for office via /.auth/me, or a verified
// fitter password), and required by every other endpoint via requireAuth() below. This is
// what actually closes the "anyone with the API URL can call it directly" gap — previously
// nothing checked who (or whether anyone) was calling.

const SECRET = process.env.SESSION_TOKEN_SECRET;
const DEFAULT_TTL_SECONDS = 12 * 60 * 60; // a working day

function base64url(str) {
  return Buffer.from(str, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(str.length + ((4 - (str.length % 4)) % 4), '=');
  return Buffer.from(padded, 'base64').toString('utf8');
}

function sign(payload, ttlSeconds = DEFAULT_TTL_SECONDS) {
  const encoded = base64url(JSON.stringify({ ...payload, exp: Date.now() + ttlSeconds * 1000 }));
  const signature = crypto.createHmac('sha256', SECRET).update(encoded).digest('hex');
  return `${encoded}.${signature}`;
}

function verify(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [encoded, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(encoded).digest('hex');
  const a = Buffer.from(signature || '', 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(base64urlDecode(encoded));
  } catch {
    return null;
  }
  if (!payload.exp || payload.exp < Date.now()) return null;
  return payload;
}

// Call at the top of every protected handler's try block. Throws an Error with a `.status`
// of 401 on failure — let it propagate to the handler's existing catch block, which should
// respond with `status: err.status || 500`.
function requireAuth(request) {
  const header = request.headers.get('authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '');
  const payload = verify(token);
  if (!payload) {
    const err = new Error('Unauthorized — missing or invalid session token');
    err.status = 401;
    throw err;
  }
  return payload;
}

// Like requireAuth, but returns null instead of throwing — for endpoints that serve some
// data pre-login (e.g. settingsGet, which the login screen itself depends on) but still
// need to redact specific fields for unauthenticated callers.
function tryAuth(request) {
  try {
    return requireAuth(request);
  } catch {
    return null;
  }
}

module.exports = { sign, verify, requireAuth, tryAuth };
