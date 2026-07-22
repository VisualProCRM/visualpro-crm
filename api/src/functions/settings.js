const { app } = require('@azure/functions');
const { getPool, sql } = require('../db');
const { requireAuth, tryAuth } = require('../auth');

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
      requireAuth(request);
      const body = await request.json();
      const pool = await getPool();
      await pool
        .request()
        .input('DataJson', sql.NVarChar, JSON.stringify(body))
        .query(
          `MERGE dbo.Settings AS target
           USING (SELECT 1 AS TenantId) AS src ON target.TenantId = src.TenantId
           WHEN MATCHED THEN UPDATE SET DataJson = @DataJson, UpdatedAt = SYSUTCDATETIME()
           WHEN NOT MATCHED THEN INSERT (TenantId, DataJson) VALUES (1, @DataJson);`
        );
      return { jsonBody: body };
    } catch (err) {
      context.error('settingsPut failed', err);
      return { status: err.status || 500, jsonBody: { error: err.message } };
    }
  },
});
