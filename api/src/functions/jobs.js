const { app } = require('@azure/functions');
const { getPool, sql } = require('../db');
const { mapJobRow } = require('../mapRow');

app.http('jobsList', {
  methods: ['GET'],
  route: 'jobs',
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      const pool = await getPool();
      const result = await pool
        .request()
        .query('SELECT * FROM dbo.Jobs WHERE TenantId = 1 ORDER BY CreatedAt DESC');
      return { jsonBody: result.recordset.map(mapJobRow) };
    } catch (err) {
      context.error('jobsList failed', err);
      return { status: 500, jsonBody: { error: err.message } };
    }
  },
});

app.http('jobsGet', {
  methods: ['GET'],
  route: 'jobs/{id}',
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      const id = Number(request.params.id);
      const pool = await getPool();
      const result = await pool
        .request()
        .input('Id', sql.Int, id)
        .query('SELECT * FROM dbo.Jobs WHERE Id = @Id AND TenantId = 1');
      if (!result.recordset.length) return { status: 404, jsonBody: { error: 'Not found' } };
      return { jsonBody: mapJobRow(result.recordset[0]) };
    } catch (err) {
      context.error('jobsGet failed', err);
      return { status: 500, jsonBody: { error: err.message } };
    }
  },
});

app.http('jobsCreate', {
  methods: ['POST'],
  route: 'jobs',
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      const body = await request.json();
      const pool = await getPool();
      const result = await pool
        .request()
        .input('CustomerId', sql.Int, body.customerId)
        .input('Title', sql.NVarChar, body.title)
        .input('ProductsJson', sql.NVarChar, JSON.stringify(body.products || []))
        .input('Status', sql.NVarChar, body.status || 'Book Survey')
        .input('SurveyDate', sql.Date, body.surveyDate || null)
        .input('InstallDate', sql.Date, body.installDate || null)
        .input('Installers', sql.NVarChar, body.installers || null)
        .input('WindowCad', sql.NVarChar, body.windowcad || null)
        .input('Value', sql.Decimal(10, 2), body.value || null)
        .input('Notes', sql.NVarChar, body.notes || null)
        .input('TabsJson', sql.NVarChar, JSON.stringify(body.tabs || {}))
        .query(
          `INSERT INTO dbo.Jobs (CustomerId, Title, ProductsJson, Status, SurveyDate, InstallDate, Installers, WindowCad, Value, Notes, TabsJson)
           OUTPUT INSERTED.*
           VALUES (@CustomerId, @Title, @ProductsJson, @Status, @SurveyDate, @InstallDate, @Installers, @WindowCad, @Value, @Notes, @TabsJson)`
        );
      return { status: 201, jsonBody: mapJobRow(result.recordset[0]) };
    } catch (err) {
      context.error('jobsCreate failed', err);
      return { status: 500, jsonBody: { error: err.message } };
    }
  },
});

app.http('jobsUpdate', {
  methods: ['PUT'],
  route: 'jobs/{id}',
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      const id = Number(request.params.id);
      const body = await request.json();
      const pool = await getPool();
      const result = await pool
        .request()
        .input('Id', sql.Int, id)
        .input('CustomerId', sql.Int, body.customerId)
        .input('Title', sql.NVarChar, body.title)
        .input('ProductsJson', sql.NVarChar, JSON.stringify(body.products || []))
        .input('Status', sql.NVarChar, body.status)
        .input('SurveyDate', sql.Date, body.surveyDate || null)
        .input('InstallDate', sql.Date, body.installDate || null)
        .input('Installers', sql.NVarChar, body.installers || null)
        .input('WindowCad', sql.NVarChar, body.windowcad || null)
        .input('Value', sql.Decimal(10, 2), body.value || null)
        .input('Notes', sql.NVarChar, body.notes || null)
        .input('TabsJson', sql.NVarChar, JSON.stringify(body.tabs || {}))
        .query(
          `UPDATE dbo.Jobs SET
             CustomerId=@CustomerId, Title=@Title, ProductsJson=@ProductsJson, Status=@Status,
             SurveyDate=@SurveyDate, InstallDate=@InstallDate, Installers=@Installers,
             WindowCad=@WindowCad, Value=@Value, Notes=@Notes, TabsJson=@TabsJson,
             UpdatedAt=SYSUTCDATETIME()
           OUTPUT INSERTED.*
           WHERE Id=@Id AND TenantId = 1`
        );
      if (!result.recordset.length) return { status: 404, jsonBody: { error: 'Not found' } };
      return { jsonBody: mapJobRow(result.recordset[0]) };
    } catch (err) {
      context.error('jobsUpdate failed', err);
      return { status: 500, jsonBody: { error: err.message } };
    }
  },
});
