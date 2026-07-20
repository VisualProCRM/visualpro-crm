const { app } = require('@azure/functions');
const { getPool, sql } = require('../db');
const { mapCustomerRow } = require('../mapRow');

// Auth (who's allowed to call these) is not enforced yet — see roadmap: Static Web Apps
// Entra ID auth wiring. TenantId is hardcoded to 1 until real multi-tenancy exists.

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
        .input('Name', sql.NVarChar, body.name)
        .input('Email', sql.NVarChar, body.email || null)
        .input('Phone', sql.NVarChar, body.phone || null)
        .input('Address', sql.NVarChar, body.address || null)
        .input('Source', sql.NVarChar, body.source || null)
        .input('Stage', sql.NVarChar, body.stage || 'New Enquiry')
        .input('Notes', sql.NVarChar, body.notes || null)
        .input('WindowCad', sql.NVarChar, body.windowcad || null)
        .input('QuoteValue', sql.Decimal(10, 2), body.quoteValue || null)
        .input('QuoteCost', sql.Decimal(10, 2), body.quoteCost || null)
        .input('TabsJson', sql.NVarChar, JSON.stringify(body.tabs || {}))
        .query(
          `INSERT INTO dbo.Customers (Name, Email, Phone, Address, Source, Stage, Notes, WindowCad, QuoteValue, QuoteCost, TabsJson)
           OUTPUT INSERTED.*
           VALUES (@Name, @Email, @Phone, @Address, @Source, @Stage, @Notes, @WindowCad, @QuoteValue, @QuoteCost, @TabsJson)`
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
        .input('Name', sql.NVarChar, body.name)
        .input('Email', sql.NVarChar, body.email || null)
        .input('Phone', sql.NVarChar, body.phone || null)
        .input('Address', sql.NVarChar, body.address || null)
        .input('Source', sql.NVarChar, body.source || null)
        .input('Stage', sql.NVarChar, body.stage)
        .input('Notes', sql.NVarChar, body.notes || null)
        .input('WindowCad', sql.NVarChar, body.windowcad || null)
        .input('QuoteValue', sql.Decimal(10, 2), body.quoteValue || null)
        .input('QuoteCost', sql.Decimal(10, 2), body.quoteCost || null)
        .input('TabsJson', sql.NVarChar, JSON.stringify(body.tabs || {}))
        .query(
          `UPDATE dbo.Customers SET
             Name=@Name, Email=@Email, Phone=@Phone, Address=@Address, Source=@Source,
             Stage=@Stage, Notes=@Notes, WindowCad=@WindowCad, QuoteValue=@QuoteValue,
             QuoteCost=@QuoteCost, TabsJson=@TabsJson, UpdatedAt=SYSUTCDATETIME()
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
