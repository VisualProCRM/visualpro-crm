const { app } = require('@azure/functions');
const { getPool } = require('../db');
const { sign } = require('../auth');

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
        return { jsonBody: { token: sign({ role: 'office' }) } };
      }

      const pool = await getPool();
      const result = await pool.request().query('SELECT * FROM dbo.Settings WHERE TenantId = 1');
      const settings = result.recordset.length ? JSON.parse(result.recordset[0].DataJson) : {};
      const storedPassword = settings.fitterPasswords?.[role] || '';

      if (storedPassword && storedPassword !== password) {
        return { status: 401, jsonBody: { error: 'Invalid password' } };
      }

      return { jsonBody: { token: sign({ role, type: 'fitter' }) } };
    } catch (err) {
      context.error('login failed', err);
      return { status: 500, jsonBody: { error: err.message } };
    }
  },
});
