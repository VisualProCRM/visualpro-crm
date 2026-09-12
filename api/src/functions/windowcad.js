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

// Mirrors LEAD_STAGES / INSTALL_STAGES in index.html — MUST be kept in sync if those change.
// Combined in pipeline order so stage advancement below has one unambiguous ordering across
// both the Sales and Installation pipelines.
const LEAD_STAGES = ['Prospect List', 'New Enquiry', 'Contacted', 'Quoted', 'Followed Up', 'Deal Won', 'Deal Lost'];
const INSTALL_STAGES = ['Book Survey', 'Survey Booked', 'Order Confirmation Sent', 'Order Confirmation Signed', 'Order Products', 'Book Installation', 'Send Product Balance', 'Install Started', 'Install Completed', 'Send Guarantees', 'Job Completed ✓'];
const ALL_STAGES = [...LEAD_STAGES, ...INSTALL_STAGES];

// Matches DEFAULT_WINDOWCAD_STATUS_MAPPING in index.html — used only if Settings has never
// been saved (no row yet) or doesn't have a mapping saved.
const DEFAULT_STATUS_MAPPING = [
  { windowcadStatus: 'Enquiry', stage: 'New Enquiry' },
  { windowcadStatus: 'Quotation Sent', stage: 'Quoted' },
  { windowcadStatus: 'Awaiting deposit', stage: 'Order Confirmation Sent' },
  { windowcadStatus: 'Requires surveying', stage: 'Book Survey' },
  { windowcadStatus: 'Requires ordering', stage: 'Order Products' },
  { windowcadStatus: 'Awaiting final payment', stage: 'Send Product Balance' },
];

// Looks up which CRM stage (Sales or Installation) a WindowCAD7 status maps to, per the
// office's own Settings → WindowCAD7 → Status Mapping table.
function resolveMappedStage(windowcadStatus, mapping) {
  if (!windowcadStatus) return null;
  const row = (mapping && mapping.length ? mapping : DEFAULT_STATUS_MAPPING).find(
    (m) => norm(m.windowcadStatus) === norm(windowcadStatus)
  );
  return row ? row.stage : null;
}

// Never lets an automated WindowCAD7 sync move a record backward through the combined Sales
// -> Installation pipeline order, or apply a stage it doesn't recognise. The office's own
// manual progress always wins from wherever it's already got to — this only ever advances a
// record, it never regresses or resets one, however far behind the WindowCAD7 status is.
function maybeAdvanceStage(currentStage, mappedStage) {
  if (!mappedStage) return currentStage;
  const newRank = ALL_STAGES.indexOf(mappedStage);
  if (newRank === -1) return currentStage;
  const curRank = ALL_STAGES.indexOf(currentStage);
  if (curRank === -1) return mappedStage; // current value isn't a recognised stage - just take the mapped one
  return newRank > curRank ? mappedStage : currentStage;
}

// Pulls the fields we know how to use out of WindowCAD7's project JSON. Everything else in
// the payload is ignored for now — infoProperties/bays carry a lot more (product specs,
// frame details) that isn't mapped to a CRM field yet.
function extractProjectFields(project) {
  const info = {};
  (project.infoProperties || []).forEach((p) => { info[p.name] = p.value; });

  const installFeeMatch = (info['Installation Fee'] || '').match(/£\s*([\d,]+(?:\.\d+)?)/);

  return {
    reference: (info['Reference'] || '').trim(),
    // WindowCAD7's own permanent internal project id (project.id, e.g.
    // "6a8c6abe96162744e228d91e") — unlike Reference, this never changes even if the
    // office later renames the Reference field. Used as the primary match key (see
    // applyWindowcadProject); Reference stays a fallback for records linked before this
    // existed, and as the human-readable label shown in the CRM.
    windowcadProjectId: (project.id || '').trim(),
    name: (info['Name'] || '').trim(),
    email: (info['Email'] || '').trim(),
    phone: (info['Phone'] || '').trim(),
    address: [info['Address'], info['Postcode']].filter(Boolean).join(', '),
    // Full VAT-inclusive total, per the office's confirmed choice — 0 on a freshly created
    // project before any pricing exists, so only ever applied when > 0.
    quoteValue: typeof project.price === 'number' && project.price > 0 ? String(project.price) : '',
    installationValue: installFeeMatch ? installFeeMatch[1].replace(/,/g, '') : '',
    windowcadStatus: (project.statusName || '').trim(),
    // WindowCAD7's own "last modified" timestamp - used as a staleness guard so an
    // out-of-order or duplicate webhook delivery (from whatever cause) can never overwrite
    // newer data with older data. Not every payload has this (e.g. malformed/legacy test
    // payloads), so treat missing as "always apply" rather than blocking on it.
    windowcadModifiedAt: project.modifiedDate || '',
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
//   1. Already linked by WindowCAD7's own permanent project id -> update in place. This is
//      the robust path: it survives the office renaming a project's Reference later, and it
//      correctly tells apart two different real projects that happen to share one Reference
//      (e.g. "Option A"/"Option B" quotes for the same address) rather than colliding them
//      into a single record.
//   2. Not found by id, but linked by Reference text on a record that has never been touched
//      under the id-based system (windowcadProjectId not yet stored) -> update in place, and
//      stamp its id now so every record self-upgrades onto path 1 the moment it's next
//      touched. This is a one-time fallback purely for records linked before this existed —
//      never used again for that record afterwards.
//   3. Existing customer found by email, then phone -> create a new Job under them (repeat/
//      concurrent business - the CRM already supports multiple Jobs per Customer for this).
//   4. No match at all -> brand new Sales Pipeline lead.
// Identity fields (name/email/phone/address) only ever apply to a Customer record - a Job
// has no fields of its own for these, it reads them from its linked Customer. Deal-specific
// fields (quoteValue/installationValue/windowcadStatus/windowcad reference/project id) apply
// to whichever record actually represents this specific WindowCAD7 project.
async function applyWindowcadProject(pool, project, context) {
  const f = extractProjectFields(project);
  if (!f.reference) return { action: 'skipped', reason: 'no Reference on project' };

  const custRows = (await pool.request().query('SELECT * FROM dbo.Customers WHERE TenantId = 1')).recordset;
  const customers = custRows.map(mapCustomerRow);
  const jobRows = (await pool.request().query('SELECT * FROM dbo.Jobs WHERE TenantId = 1')).recordset;
  const jobs = jobRows.map(mapJobRow);

  const settingsRow = (await pool.request().query('SELECT DataJson FROM dbo.Settings WHERE TenantId = 1')).recordset;
  const settings = settingsRow.length ? JSON.parse(settingsRow[0].DataJson) : {};
  const mappedStage = resolveMappedStage(f.windowcadStatus, settings.windowcadStatusMapping);

  // Staleness guard: skip applying if this project's own modifiedDate is not newer than the
  // last one we actually applied for it. Protects against any out-of-order or duplicate
  // webhook delivery — from WindowCAD7 retrying, our own re-processing of an old capture, or
  // anything else — ever overwriting newer data with older data. A record with no stored
  // windowcadModifiedAt yet (never linked before) always applies.
  const isStale = (record) =>
    f.windowcadModifiedAt && record.windowcadModifiedAt && f.windowcadModifiedAt <= record.windowcadModifiedAt;

  const byProjectId = (r) => f.windowcadProjectId && r.windowcadProjectId && r.windowcadProjectId === f.windowcadProjectId;
  // Deliberately excludes any record that already has its OWN windowcadProjectId stored —
  // once a record is known to be a specific distinct project, a mere shared Reference string
  // must never fold a different project into it.
  const byLegacyReference = (r) => !r.windowcadProjectId && r.windowcad && norm(r.windowcad) === norm(f.reference);

  const linkedJob = jobs.find(byProjectId) || jobs.find(byLegacyReference);
  if (linkedJob) {
    if (isStale(linkedJob)) return { action: 'skipped-stale', jobId: linkedJob.id };
    const patch = { ...linkedJob };
    if (f.windowcadProjectId) patch.windowcadProjectId = f.windowcadProjectId;
    // Keep the displayed Reference label current too — matching by id means a rename in
    // WindowCAD7 no longer breaks the link, but the office should still see the *current*
    // Reference, not whatever it was called when first linked.
    if (f.reference) patch.windowcad = f.reference;
    if (f.quoteValue) patch.quoteValue = f.quoteValue;
    if (f.installationValue) patch.installationValue = f.installationValue;
    if (f.windowcadStatus) patch.windowcadStatus = f.windowcadStatus;
    if (f.windowcadModifiedAt) patch.windowcadModifiedAt = f.windowcadModifiedAt;
    // Auto-advances this Job onto (or further along) the mapped stage — Sales or
    // Installation Pipeline, per Settings → WindowCAD7 → Status Mapping — but only ever
    // forward; never regresses or resets stage progress the office has made by hand.
    patch.status = maybeAdvanceStage(linkedJob.status, mappedStage);
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

  const linkedCustomer = customers.find(byProjectId) || customers.find(byLegacyReference);
  if (linkedCustomer) {
    if (isStale(linkedCustomer)) return { action: 'skipped-stale', customerId: linkedCustomer.id };
    const patch = { ...linkedCustomer };
    if (f.windowcadProjectId) patch.windowcadProjectId = f.windowcadProjectId;
    if (f.reference) patch.windowcad = f.reference;
    if (f.name) patch.name = f.name;
    if (f.email) patch.email = f.email;
    if (f.phone) patch.phone = f.phone;
    if (f.address) patch.address = f.address;
    if (f.quoteValue) patch.quoteValue = f.quoteValue;
    if (f.installationValue) patch.installationValue = f.installationValue;
    if (f.windowcadStatus) patch.windowcadStatus = f.windowcadStatus;
    if (f.windowcadModifiedAt) patch.windowcadModifiedAt = f.windowcadModifiedAt;
    // Same forward-only stage advancement as the linked-Job path above.
    patch.stage = maybeAdvanceStage(linkedCustomer.stage, mappedStage);
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
      // This project's own name first, not the customer's — this Job specifically
      // represents *this* WindowCAD7 project (e.g. "...Option One"), which is usually a
      // more distinctive name than whatever the customer record happens to be called,
      // especially once several same-customer quotes each have their own Job.
      title: f.name || matched.name || f.reference,
      status: mappedStage || 'Book Survey',
      reference: f.reference,
      windowcad: f.reference,
      windowcadProjectId: f.windowcadProjectId,
      quoteValue: f.quoteValue,
      installationValue: f.installationValue,
      windowcadStatus: f.windowcadStatus,
      windowcadModifiedAt: f.windowcadModifiedAt,
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
    stage: mappedStage || (f.quoteValue ? 'Quoted' : 'New Enquiry'),
    windowcad: f.reference,
    windowcadProjectId: f.windowcadProjectId,
    quoteValue: f.quoteValue,
    installationValue: f.installationValue,
    windowcadStatus: f.windowcadStatus,
    windowcadModifiedAt: f.windowcadModifiedAt,
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
