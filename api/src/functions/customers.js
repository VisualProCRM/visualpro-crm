const { app } = require('@azure/functions');
const { getPool, sql } = require('../db');

// First-pass, read-only endpoint. Purpose right now is to prove the deploy pipeline and the
// Function App's managed-identity connection to SQL actually work end-to-end before building
// out the rest of CRUD on top of it. Auth (who's allowed to call this) is not enforced yet —
// see roadmap: Static Web Apps Entra ID auth wiring.
app.http('customersList', {
  methods: ['GET'],
  route: 'customers',
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      const pool = await getPool();
      const result = await pool
        .request()
        .query('SELECT * FROM dbo.Customers WHERE TenantId = 1 ORDER BY CreatedAt DESC');
      return { jsonBody: result.recordset };
    } catch (err) {
      context.error('customersList failed', err);
      return { status: 500, jsonBody: { error: err.message } };
    }
  },
});
