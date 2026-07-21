const { app } = require('@azure/functions');
const { getPool, sql } = require('../db');

// Single row per tenant (TenantId = 1 for now). GET returns null if no row exists yet (the
// frontend merges that over its own local defaults); PUT upserts the whole object.

app.http('settingsGet', {
  methods: ['GET'],
  route: 'settings',
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      const pool = await getPool();
      const result = await pool.request().query('SELECT * FROM dbo.Settings WHERE TenantId = 1');
      if (!result.recordset.length) return { jsonBody: null };
      return { jsonBody: JSON.parse(result.recordset[0].DataJson) };
    } catch (err) {
      context.error('settingsGet failed', err);
      return { status: 500, jsonBody: { error: err.message } };
    }
  },
});

app.http('settingsPut', {
  methods: ['PUT'],
  route: 'settings',
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
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
      return { status: 500, jsonBody: { error: err.message } };
    }
  },
});
