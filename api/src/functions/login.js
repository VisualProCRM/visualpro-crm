const { app } = require('@azure/functions');
const { getPool } = require('../db');
const { sign, requireAuth } = require('../auth');
const { getPrincipal, isOfficeUser } = require('../principal');

// Issues a signed session token, required by every other endpoint (see auth.js). Two paths:
//
// - Fitter: verified server-side against the real, currently-saved password in
//   dbo.Settings.fitterPasswords — matches the existing "no password set = login allowed"
//   behavior the app already has.
// - Office: the frontend only calls this after /.auth/me (a same-origin, cookie-gated
//   Static Web Apps endpoint) has already confirmed a real Entra ID session. This endpoint
//   trusts that claim rather than independently re-verifying the Entra token itself, which
//   would need the Function App formally linked as the Static Web App's backend — a bigger
//   change, deliberately deferred. Accepted trade-off: closes off anonymous/casual API
//   access entirely, but doesn't defend against someone reading the frontend's source and
//   replaying the office login call directly.
app.http('login', {
  methods: ['POST'],
  route: 'login',
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      const { role, password } = await request.json();
      if (!role) return { status: 400, jsonBody: { error: 'role is required' } };

      if (role === 'office') {
        // Verified by the Static Web App, not claimed by the browser. Until 2026-09-21 this
        // issued an office token to anyone who asked — no sign-in needed — which exposed every
        // customer's contact details and every fitter's password to anyone who tried.
        const principal = getPrincipal(request);
        if (!isOfficeUser(principal)) {
          return { status: 401, jsonBody: { error: 'Office sign-in required' } };
        }
        return { jsonBody: { token: sign({ role: 'office', email: principal.email }) } };
      }

      const pool = await getPool();
      const result = await pool.request().query('SELECT * FROM dbo.Settings WHERE TenantId = 1');
      const settings = result.recordset.length ? JSON.parse(result.recordset[0].DataJson) : {};
      // Only a real fitter, with a password, may sign in as one. This used to accept any name
      // at all, and let a name with no stored password straight in — so a made-up name was
      // enough to get a token that could read every customer (confirmed live 2026-09-21).
      const isKnownFitter = Array.isArray(settings.fitters) && settings.fitters.includes(role);
      if (!isKnownFitter) {
        return { status: 401, jsonBody: { error: 'Unknown fitter' } };
      }
      const storedPassword = settings.fitterPasswords?.[role] || '';
      if (!storedPassword) {
        return { status: 401, jsonBody: { error: 'No password has been set for this fitter — ask the office to set one in Settings.' } };
      }
      if (storedPassword !== password) {
        return { status: 401, jsonBody: { error: 'Invalid password' } };
      }

      return { jsonBody: { token: sign({ role, type: 'fitter' }) } };
    } catch (err) {
      context.error('login failed', err);
      return { status: 500, jsonBody: { error: err.message } };
    }
  },
});

// Silently renews a still-valid session token before it expires (default TTL is 12h) — the
// frontend calls this periodically in the background while the app is open, for both office
// and fitter sessions, so an active user never actually hits an expired-session error. Only
// works on a token that's still valid (requireAuth throws 401 on an already-expired one) —
// there's deliberately no separate "refresh token" concept, since re-signing the same
// identity payload is enough for this app's needs and avoids a second secret to manage.
app.http('loginRefresh', {
  methods: ['POST'],
  route: 'login/refresh',
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      const payload = requireAuth(request);
      const { exp, v, ...identity } = payload;
      // An office session is only renewed while the same Microsoft sign-in is still present,
      // so signing out of Microsoft ends the CRM session at the next refresh rather than never.
      if (identity.role === 'office') {
        const principal = getPrincipal(request);
        if (!isOfficeUser(principal) || principal.email !== identity.email) {
          return { status: 401, jsonBody: { error: 'Office sign-in required' } };
        }
      }
      return { jsonBody: { token: sign(identity) } };
    } catch (err) {
      context.error('loginRefresh failed', err);
      return { status: err.status || 500, jsonBody: { error: err.message } };
    }
  },
});
