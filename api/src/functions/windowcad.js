const { app } = require('@azure/functions');
const { getPool, sql } = require('../db');
const { requireAuth } = require('../auth');

// Discovery-phase receiver for WindowCAD7's own CRM webhook (configured inside WindowCAD7
// itself, Settings > CRM > API url) — no formal docs exist from ICAAL, so this just captures
// whatever JSON actually arrives so we can see the real payload shape before deciding what
// to build against it. Not the app's normal Bearer-token auth: WindowCAD7's settings only
// offer a plain URL field, no way to add a custom header, so the shared secret has to live
// in the path itself.
app.http('windowcadWebhook', {
  methods: ['POST'],
  route: 'windowcad/webhook/{secret}',
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const expected = process.env.WINDOWCAD_WEBHOOK_SECRET;
    if (!expected || request.params.secret !== expected) {
      // 404 rather than 401/403 - doesn't confirm to a guesser that this route exists at all.
      return { status: 404 };
    }

    let payload;
    try {
      payload = await request.json();
    } catch (err) {
      return { status: 400, jsonBody: { error: 'Invalid JSON' } };
    }

    // Always logged (visible in the Function App's log stream / Application Insights) - this
    // is the guaranteed capture path, independent of the database.
    context.log('WindowCAD7 webhook payload received:', JSON.stringify(payload));

    // Best-effort persistence so the payload can be viewed from within the app too, without
    // needing Azure Portal access. A DB failure here must never break the response back to
    // WindowCAD7 (it isn't going to retry intelligently), hence the separate try/catch.
    try {
      const pool = await getPool();
      const result = await pool.request().query('SELECT DataJson FROM dbo.WindowcadEvents WHERE TenantId = 1');
      const events = result.recordset.length ? JSON.parse(result.recordset[0].DataJson) : [];
      events.unshift({ receivedAt: new Date().toISOString(), payload });
      const trimmed = events.slice(0, 50); // keep this small - discovery only, not a real event log
      await pool
        .request()
        .input('DataJson', sql.NVarChar, JSON.stringify(trimmed))
        .query(
          `MERGE dbo.WindowcadEvents AS target
           USING (SELECT 1 AS TenantId) AS src ON target.TenantId = src.TenantId
           WHEN MATCHED THEN UPDATE SET DataJson = @DataJson, UpdatedAt = SYSUTCDATETIME()
           WHEN NOT MATCHED THEN INSERT (TenantId, DataJson) VALUES (1, @DataJson);`
        );
    } catch (err) {
      context.error('windowcadWebhook: failed to persist event (payload was still logged)', err);
    }

    return { status: 200, jsonBody: { received: true } };
  },
});

// Lets the office view captured webhook payloads from within the app (Settings > CRM, once
// wired up on the frontend) instead of needing Azure Portal log access.
app.http('windowcadEventsGet', {
  methods: ['GET'],
  route: 'windowcad/events',
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      requireAuth(request);
      const pool = await getPool();
      const result = await pool.request().query('SELECT DataJson FROM dbo.WindowcadEvents WHERE TenantId = 1');
      if (!result.recordset.length) return { jsonBody: [] };
      return { jsonBody: JSON.parse(result.recordset[0].DataJson) };
    } catch (err) {
      context.error('windowcadEventsGet failed', err);
      return { status: err.status || 500, jsonBody: { error: err.message } };
    }
  },
});
