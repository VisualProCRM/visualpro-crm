const { app } = require('@azure/functions');
const { getPool, sql } = require('../db');
const { requireAuth } = require('../auth');
const { mapCustomerRow, mapJobRow } = require('../mapRow');

// Matches emptyTabs() in index.html — new records created from a WindowCAD7 event need the
// same tabs shape everything else in the app expects, even though most of it stays empty.
function emptyTabs() {
  return {
    quote: { files: [], notes: '' },
    invoices: { files: [], notes: '' },
    notepad: { text: '' },
    survey: { files: [], images: [], notes: '', date: '', fitter: '' },
    orderConfirmation: { files: [], notes: '' },
    bills: { files: [], costs: '', notes: '' },
    installation: { date: '', fitters: [], fittersNotes: '', startTime: '', emailReminders: { week: { status: 'pending', sentAt: '' }, day: { status: 'pending', sentAt: '' } }, deliveries: [] },
    guarantee: { files: [], notes: '' },
    tasks: [],
    serviceCall: { notes: '', officePhotos: [], bookings: [] },
  };
}

const norm = (s) => (s || '').trim().toLowerCase();

// Pulls the fields we know how to use out of WindowCAD7's project JSON. Everything else in
// the payload is ignored for now — infoProperties/bays carry a lot more (product specs,
// frame details) that isn't mapped to a CRM field yet.
function extractProjectFields(project) {
  const info = {};
  (project.infoProperties || []).forEach((p) => { info[p.name] = p.value; });

  const installFeeMatch = (info['Installation Fee'] || '').match(/£\s*([\d,]+(?:\.\d+)?)/);

  return {
    reference: (info['Reference'] || '').trim(),
    name: (info['Name'] || '').trim(),
    email: (info['Email'] || '').trim(),
    phone: (info['Phone'] || '').trim(),
    address: [info['Address'], info['Postcode']].filter(Boolean).join(', '),
    // Full VAT-inclusive total, per the office's confirmed choice — 0 on a freshly created
    // project before any pricing exists, so only ever applied when > 0.
    quoteValue: typeof project.price === 'number' && project.price > 0 ? String(project.price) : '',
    installationValue: installFeeMatch ? installFeeMatch[1].replace(/,/g, '') : '',
    windowcadStatus: (project.statusName || '').trim(),
  };
}

async function updateCustomerRow(pool, id, data) {
  await pool
    .request()
    .input('Id', sql.Int, id)
    .input('Name', sql.NVarChar, data.name || '')
    .input('Stage', sql.NVarChar, data.stage || 'New Enquiry')
    .input('DataJson', sql.NVarChar, JSON.stringify(data))
    .query(
      `UPDATE dbo.Customers SET Name=@Name, Stage=@Stage, DataJson=@DataJson, UpdatedAt=SYSUTCDATETIME()
       WHERE Id=@Id AND TenantId = 1`
    );
}

async function insertCustomerRow(pool, data) {
  const result = await pool
    .request()
    .input('Name', sql.NVarChar, data.name || '')
    .input('Stage', sql.NVarChar, data.stage || 'New Enquiry')
    .input('DataJson', sql.NVarChar, JSON.stringify(data))
    .query(
      `INSERT INTO dbo.Customers (Name, Stage, DataJson)
       OUTPUT INSERTED.* VALUES (@Name, @Stage, @DataJson)`
    );
  return mapCustomerRow(result.recordset[0]);
}

async function updateJobRow(pool, id, data) {
  await pool
    .request()
    .input('Id', sql.Int, id)
    .input('CustomerId', sql.Int, data.customerId)
    .input('Title', sql.NVarChar, data.title || '')
    .input('Status', sql.NVarChar, data.status || 'Book Survey')
    .input('DataJson', sql.NVarChar, JSON.stringify(data))
    .query(
      `UPDATE dbo.Jobs SET CustomerId=@CustomerId, Title=@Title, Status=@Status, DataJson=@DataJson, UpdatedAt=SYSUTCDATETIME()
       WHERE Id=@Id AND TenantId = 1`
    );
}

async function insertJobRow(pool, data) {
  const result = await pool
    .request()
    .input('CustomerId', sql.Int, data.customerId)
    .input('Title', sql.NVarChar, data.title || '')
    .input('Status', sql.NVarChar, data.status || 'Book Survey')
    .input('DataJson', sql.NVarChar, JSON.stringify(data))
    .query(
      `INSERT INTO dbo.Jobs (CustomerId, Title, Status, DataJson)
       OUTPUT INSERTED.* VALUES (@CustomerId, @Title, @Status, @DataJson)`
    );
  return mapJobRow(result.recordset[0]);
}

// Applies one WindowCAD7 project event to the CRM. Matching order:
//   1. Already linked (windowcad field matches this Reference exactly) -> update in place.
//   2. Existing customer found by email, then phone -> create a new Job under them (repeat/
//      concurrent business - the CRM already supports multiple Jobs per Customer for this).
//   3. No match at all -> brand new Sales Pipeline lead.
// Identity fields (name/email/phone/address) only ever apply to a Customer record - a Job
// has no fields of its own for these, it reads them from its linked Customer. Deal-specific
// fields (quoteValue/installationValue/windowcadStatus/windowcad reference) apply to
// whichever record actually represents this specific WindowCAD7 project.
async function applyWindowcadProject(pool, project, context) {
  const f = extractProjectFields(project);
  if (!f.reference) return { action: 'skipped', reason: 'no Reference on project' };

  const custRows = (await pool.request().query('SELECT * FROM dbo.Customers WHERE TenantId = 1')).recordset;
  const customers = custRows.map(mapCustomerRow);
  const jobRows = (await pool.request().query('SELECT * FROM dbo.Jobs WHERE TenantId = 1')).recordset;
  const jobs = jobRows.map(mapJobRow);

  const linkedJob = jobs.find((j) => j.windowcad && norm(j.windowcad) === norm(f.reference));
  if (linkedJob) {
    const patch = { ...linkedJob };
    if (f.quoteValue) patch.quoteValue = f.quoteValue;
    if (f.installationValue) patch.installationValue = f.installationValue;
    if (f.windowcadStatus) patch.windowcadStatus = f.windowcadStatus;
    await updateJobRow(pool, linkedJob.id, patch);
    // Identity fields still belong on the linked customer, source-of-truth per the office.
    const cust = customers.find((c) => c.id === linkedJob.customerId);
    if (cust) {
      const custPatch = { ...cust };
      if (f.name) custPatch.name = f.name;
      if (f.email) custPatch.email = f.email;
      if (f.phone) custPatch.phone = f.phone;
      if (f.address) custPatch.address = f.address;
      await updateCustomerRow(pool, cust.id, custPatch);
    }
    return { action: 'updated-job', jobId: linkedJob.id };
  }

  const linkedCustomer = customers.find((c) => c.windowcad && norm(c.windowcad) === norm(f.reference));
  if (linkedCustomer) {
    const patch = { ...linkedCustomer };
    if (f.name) patch.name = f.name;
    if (f.email) patch.email = f.email;
    if (f.phone) patch.phone = f.phone;
    if (f.address) patch.address = f.address;
    if (f.quoteValue) patch.quoteValue = f.quoteValue;
    if (f.installationValue) patch.installationValue = f.installationValue;
    if (f.windowcadStatus) patch.windowcadStatus = f.windowcadStatus;
    await updateCustomerRow(pool, linkedCustomer.id, patch);
    return { action: 'updated-customer', customerId: linkedCustomer.id };
  }

  // Not yet linked - look for an existing customer by identity (email, then phone only;
  // name deliberately excluded, too easy to misfire on two customers who share a name).
  let matched = null;
  if (f.email) matched = customers.find((c) => c.email && norm(c.email) === norm(f.email)) || null;
  if (!matched && f.phone) matched = customers.find((c) => c.phone && norm(c.phone) === norm(f.phone)) || null;

  if (matched) {
    const newJob = {
      customerId: matched.id,
      title: matched.name || f.name || f.reference,
      status: 'Book Survey',
      reference: f.reference,
      windowcad: f.reference,
      quoteValue: f.quoteValue,
      installationValue: f.installationValue,
      windowcadStatus: f.windowcadStatus,
      wonAt: new Date().toISOString(),
      tabs: emptyTabs(),
    };
    const created = await insertJobRow(pool, newJob);
    return { action: 'created-job', jobId: created.id, customerId: matched.id };
  }

  const newCustomer = {
    name: f.name || f.reference,
    email: f.email,
    phone: f.phone,
    address: f.address,
    source: 'WindowCAD7',
    stage: f.quoteValue ? 'Quoted' : 'New Enquiry',
    windowcad: f.reference,
    quoteValue: f.quoteValue,
    installationValue: f.installationValue,
    windowcadStatus: f.windowcadStatus,
    tabs: emptyTabs(),
  };
  const created = await insertCustomerRow(pool, newCustomer);
  return { action: 'created-customer', customerId: created.id };
}

// Discovery-phase receiver for WindowCAD7's own CRM webhook (configured inside WindowCAD7
// itself, Settings > CRM > API url) — no formal docs exist from ICAAL, so this captures
// whatever actually arrives (logged always, persisted best-effort) and, once the payload
// shape is recognised (payload.json is a project), applies it to the CRM per the matching
// rules above. Not the app's normal Bearer-token auth: WindowCAD7's settings only offer a
// plain URL field, no way to add a custom header, so the shared secret has to live in the
// path itself.
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

    // Always try to parse as JSON first regardless of the declared Content-Type - WindowCAD7
    // has been observed sending genuinely-JSON bodies labelled "text/plain", so trusting the
    // header alone silently skipped real events. Only falls back to raw-text capture (for
    // untested actions like the "Print to CRM" button, which may send an actual document)
    // when the body truly isn't valid JSON.
    const contentType = request.headers.get('content-type') || '';
    const rawText = await request.text().catch(() => '(unreadable body)');
    let payload;
    try {
      payload = JSON.parse(rawText);
    } catch (err) {
      payload = { _nonJsonBody: true, contentType, rawText: rawText.slice(0, 2000) };
    }

    context.log('WindowCAD7 webhook payload received:', JSON.stringify(payload).slice(0, 5000));

    let applyResult = null;
    try {
      const pool = await getPool();

      // Best-effort raw capture, independent of whether we can process it - a DB failure
      // here must never break the response back to WindowCAD7.
      try {
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
        context.error('windowcadWebhook: failed to persist raw event (payload was still logged)', err);
      }

      // Only try to apply it to the CRM if it looks like a recognised project payload.
      if (payload && payload.json && Array.isArray(payload.json.infoProperties)) {
        try {
          applyResult = await applyWindowcadProject(pool, payload.json, context);
          context.log('windowcadWebhook: applied to CRM ->', JSON.stringify(applyResult));
        } catch (err) {
          context.error('windowcadWebhook: failed to apply project to CRM', err);
        }
      }
    } catch (err) {
      context.error('windowcadWebhook: pool/setup failure', err);
    }

    return { status: 200, jsonBody: { received: true, applied: applyResult } };
  },
});

// Lets the office view captured webhook payloads from within the app (Settings > WindowCAD7)
// instead of needing Azure Portal log access.
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
