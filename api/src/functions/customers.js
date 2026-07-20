const { app } = require('@azure/functions');
const { getPool, sql } = require('../db');
const { mapCustomerRow } = require('../mapRow');

// Auth (who's allowed to call these) is not enforced yet — see roadmap: locking down the
// API itself, deferred when Entra ID auth was wired up for the frontend. TenantId is
// hardcoded to 1 until real multi-tenancy exists.
//
// DataJson stores the entire record the frontend sends, as-is — see schema.sql for why
// (avoids silently dropping any field the app has that we haven't explicitly modeled).

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
      return { jsonBody: result.recordset.map(mapCustomerRow) };
    } catch (err) {
      context.error('customersList failed', err);
      return { status: 500, jsonBody: { error: err.message } };
    }
  },
});

app.http('customersGet', {
  methods: ['GET'],
  route: 'customers/{id}',
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      const id = Number(request.params.id);
      const pool = await getPool();
      const result = await pool
        .request()
        .input('Id', sql.Int, id)
        .query('SELECT * FROM dbo.Customers WHERE Id = @Id AND TenantId = 1');
      if (!result.recordset.length) return { status: 404, jsonBody: { error: 'Not found' } };
      return { jsonBody: mapCustomerRow(result.recordset[0]) };
    } catch (err) {
      context.error('customersGet failed', err);
      return { status: 500, jsonBody: { error: err.message } };
    }
  },
});

app.http('customersCreate', {
  methods: ['POST'],
  route: 'customers',
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      const body = await request.json();
      const pool = await getPool();
      const result = await pool
        .request()
        .input('Name', sql.NVarChar, body.name || '')
        .input('Stage', sql.NVarChar, body.stage || 'New Enquiry')
        .input('DataJson', sql.NVarChar, JSON.stringify(body))
        .query(
          `INSERT INTO dbo.Customers (Name, Stage, DataJson)
           OUTPUT INSERTED.*
           VALUES (@Name, @Stage, @DataJson)`
        );
      return { status: 201, jsonBody: mapCustomerRow(result.recordset[0]) };
    } catch (err) {
      context.error('customersCreate failed', err);
      return { status: 500, jsonBody: { error: err.message } };
    }
  },
});

app.http('customersUpdate', {
  methods: ['PUT'],
  route: 'customers/{id}',
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      const id = Number(request.params.id);
      const body = await request.json();
      const pool = await getPool();
      const result = await pool
        .request()
        .input('Id', sql.Int, id)
        .input('Name', sql.NVarChar, body.name || '')
        .input('Stage', sql.NVarChar, body.stage || 'New Enquiry')
        .input('DataJson', sql.NVarChar, JSON.stringify(body))
        .query(
          `UPDATE dbo.Customers SET Name=@Name, Stage=@Stage, DataJson=@DataJson, UpdatedAt=SYSUTCDATETIME()
           OUTPUT INSERTED.*
           WHERE Id=@Id AND TenantId = 1`
        );
      if (!result.recordset.length) return { status: 404, jsonBody: { error: 'Not found' } };
      return { jsonBody: mapCustomerRow(result.recordset[0]) };
    } catch (err) {
      context.error('customersUpdate failed', err);
      return { status: 500, jsonBody: { error: err.message } };
    }
  },
});

app.http('customersDelete', {
  methods: ['DELETE'],
  route: 'customers/{id}',
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      const id = Number(request.params.id);
      const pool = await getPool();
      await pool
        .request()
        .input('Id', sql.Int, id)
        .query('DELETE FROM dbo.Customers WHERE Id=@Id AND TenantId = 1');
      return { status: 204 };
    } catch (err) {
      // Most likely cause: this customer still has Jobs referencing it (FK constraint).
      context.error('customersDelete failed', err);
      return { status: 409, jsonBody: { error: err.message } };
    }
  },
});
