const { app } = require('@azure/functions');
const { getPool, sql } = require('../db');

// Single row per tenant (TenantId = 1), same generic-blob pattern as settings.js — the whole
// manually-added "Track Orders" list is one JSON array. GET returns [] if no row exists yet;
// PUT upserts the whole array.

app.http('ordersGet', {
  methods: ['GET'],
  route: 'orders',
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      const pool = await getPool();
      const result = await pool.request().query('SELECT * FROM dbo.Orders WHERE TenantId = 1');
      if (!result.recordset.length) return { jsonBody: [] };
      return { jsonBody: JSON.parse(result.recordset[0].DataJson) };
    } catch (err) {
      context.error('ordersGet failed', err);
      return { status: 500, jsonBody: { error: err.message } };
    }
  },
});

app.http('ordersPut', {
  methods: ['PUT'],
  route: 'orders',
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      const body = await request.json();
      const pool = await getPool();
      await pool
        .request()
        .input('DataJson', sql.NVarChar, JSON.stringify(body))
        .query(
          `MERGE dbo.Orders AS target
           USING (SELECT 1 AS TenantId) AS src ON target.TenantId = src.TenantId
           WHEN MATCHED THEN UPDATE SET DataJson = @DataJson, UpdatedAt = SYSUTCDATETIME()
           WHEN NOT MATCHED THEN INSERT (TenantId, DataJson) VALUES (1, @DataJson);`
        );
      return { jsonBody: body };
    } catch (err) {
      context.error('ordersPut failed', err);
      return { status: 500, jsonBody: { error: err.message } };
    }
  },
});
