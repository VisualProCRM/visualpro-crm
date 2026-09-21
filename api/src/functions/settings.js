const { app } = require('@azure/functions');
const { getPool, sql } = require('../db');
const { requireAuth, tryAuth } = require('../auth');
const { hashPlaintextPasswords, isHashed } = require('../passwords');

const saveSettingsRow = (pool, data) =>
  pool
    .request()
    .input('DataJson', sql.NVarChar, JSON.stringify(data))
    .query(
      `MERGE dbo.Settings AS target
       USING (SELECT 1 AS TenantId) AS src ON target.TenantId = src.TenantId
       WHEN MATCHED THEN UPDATE SET DataJson = @DataJson, UpdatedAt = SYSUTCDATETIME()
       WHEN NOT MATCHED THEN INSERT (TenantId, DataJson) VALUES (1, @DataJson);`
    );

// Single row per tenant (TenantId = 1 for now). GET returns null if no row exists yet (the
// frontend merges that over its own local defaults); PUT upserts the whole object.
//
// settingsGet deliberately allows unauthenticated calls (the login screen itself needs the
// fitter list and company details before anyone's logged in, and login.js reads the row
// directly from the DB itself to verify a fitter's password, bypassing this redaction).
// But real password values must only ever reach an office session — a fitter's own valid
// token (or no token at all) gets each password masked to a boolean (true/""), preserving
// the "has a password been set for this fitter" check the login screen's UI relies on,
// without ever exposing the actual value to anyone but office.
app.http('settingsGet', {
  methods: ['GET'],
  route: 'settings',
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      const authed = tryAuth(request);
      const pool = await getPool();
      const result = await pool.request().query('SELECT * FROM dbo.Settings WHERE TenantId = 1');
      if (!result.recordset.length) return { jsonBody: null };
      const data = JSON.parse(result.recordset[0].DataJson);
      // Any password still held in plain text (from before hashing existed) is hashed and
      // saved the first time the row is read — the login screen reads it on every load, so
      // this completes within moments of deployment without needing anyone to act.
      if (hashPlaintextPasswords(data)) await saveSettingsRow(pool, data);
      // Office receives the hashes rather than a placeholder, so renaming a fitter in
      // Settings carries their password across. A hash can't be turned back into the password.
      if ((!authed || authed.role !== 'office') && data.fitterPasswords) {
        data.fitterPasswords = Object.fromEntries(
          Object.entries(data.fitterPasswords).map(([name, pw]) => [name, pw ? true : ''])
        );
      }
      return { jsonBody: data };
    } catch (err) {
      context.error('settingsGet failed', err);
      return { status: err.status || 500, jsonBody: { error: err.message } };
    }
  },
});

app.http('settingsPut', {
  methods: ['PUT'],
  route: 'settings',
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      // Office only. This used to accept any logged-in session, so a fitter's login could
      // overwrite the whole of Settings — every email template, every fitter's password.
      const caller = requireAuth(request);
      if (caller.role !== 'office') {
        return { status: 403, jsonBody: { error: 'Only the office can change Settings' } };
      }
      const body = await request.json();
      const pool = await getPool();
      // A password value that isn't a string — the masked `true` a pre-login copy of Settings
      // carries — must never overwrite a real one. Keep whatever is stored for that fitter.
      if (body.fitterPasswords && typeof body.fitterPasswords === 'object') {
        const existing = await pool.request().query('SELECT DataJson FROM dbo.Settings WHERE TenantId = 1');
        const stored = existing.recordset.length ? (JSON.parse(existing.recordset[0].DataJson).fitterPasswords || {}) : {};
        for (const [name, value] of Object.entries(body.fitterPasswords)) {
          if (typeof value !== 'string') body.fitterPasswords[name] = isHashed(stored[name]) ? stored[name] : '';
        }
      }
      // Whatever the office typed as a new password is hashed before it's stored.
      hashPlaintextPasswords(body);
      await saveSettingsRow(pool, body);
      return { jsonBody: body };
    } catch (err) {
      context.error('settingsPut failed', err);
      return { status: err.status || 500, jsonBody: { error: err.message } };
    }
  },
});
