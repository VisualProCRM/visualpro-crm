const { app } = require('@azure/functions');
const { EmailClient } = require('@azure/communication-email');
const { DefaultAzureCredential } = require('@azure/identity');
const { getPool, sql } = require('../db');

const emailClient = new EmailClient(process.env.ACS_CONNECTION_STRING);
const armCredential = new DefaultAzureCredential();

// Looks up the Azure-managed domain's actual assigned sender hostname via the ARM API
// (read-only, via the Function App's managed identity + Reader role) rather than hardcoding
// it, since the exact hostname is only known after deployment. Returns the raw ARM
// properties object too, so a caller can inspect the real field names if our guesses below
// are wrong.
async function getSenderDomain() {
  const token = await armCredential.getToken('https://management.azure.com/.default');
  const subId = process.env.AZURE_SUBSCRIPTION_ID;
  const rg = process.env.RESOURCE_GROUP_NAME;
  const emailServiceName = process.env.EMAIL_SERVICE_NAME;
  const url = `https://management.azure.com/subscriptions/${subId}/resourceGroups/${rg}/providers/Microsoft.Communication/emailServices/${emailServiceName}/domains/AzureManagedDomain?api-version=2023-04-01`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token.token}` } });
  if (!res.ok) {
    throw new Error(`ARM lookup failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  const props = json.properties || {};
  const hostname = props.mailFromSenderDomain || props.fromSenderDomain || props.dataLocation;
  return { hostname, rawProperties: props };
}

function fillTemplate(tmpl, vars) {
  return Object.entries(vars).reduce(
    (str, [key, val]) => str.replaceAll(`{{${key}}}`, val || ''),
    tmpl
  );
}

// Default templates mirror DEFAULT_EMAIL_TEMPLATES in index.html. Note: these are NOT read
// from the frontend's Settings (which isn't persisted to the backend at all yet) — if a
// customer edits templates in Settings, this backend copy won't reflect that until Settings
// itself is persisted. Known limitation, flagged for follow-up.
const TEMPLATES = {
  week: {
    subject: 'Your Installation is Coming Up - {{customerName}}',
    body: `Dear {{customerName}},

Just a reminder that your installation is booked for:

Date: {{installDate}}
Installers: {{fitterNames}}
Address: {{address}}

If you have any questions before then, please get in touch.

Kind regards,
{{companyName}}`,
  },
  day: {
    subject: 'Your Installation is Tomorrow - {{customerName}}',
    body: `Dear {{customerName}},

Just a reminder that your installation is tomorrow:

Date: {{installDate}}
Installers: {{fitterNames}}
Address: {{address}}

Please ensure access is available and any furniture near windows/doors is moved.

Kind regards,
{{companyName}}`,
  },
};

app.http('sendReminder', {
  methods: ['POST'],
  route: 'send-reminder',
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      const body = await request.json();
      const { jobId, reminderKey, testEmailOverride, debug } = body;

      if (debug) {
        const domainInfo = await getSenderDomain();
        return { jsonBody: domainInfo };
      }

      if (!jobId || !['week', 'day'].includes(reminderKey)) {
        return { status: 400, jsonBody: { error: 'jobId and reminderKey ("week"|"day") are required' } };
      }

      const pool = await getPool();
      const jobResult = await pool.request().input('Id', sql.Int, jobId).query('SELECT * FROM dbo.Jobs WHERE Id = @Id');
      if (!jobResult.recordset.length) return { status: 404, jsonBody: { error: 'Job not found' } };
      const jobRow = jobResult.recordset[0];
      const job = JSON.parse(jobRow.DataJson);

      const customerResult = await pool
        .request()
        .input('Id', sql.Int, jobRow.CustomerId)
        .query('SELECT * FROM dbo.Customers WHERE Id = @Id');
      if (!customerResult.recordset.length) return { status: 404, jsonBody: { error: 'Customer not found' } };
      const customer = JSON.parse(customerResult.recordset[0].DataJson);

      const recipient = testEmailOverride || customer.email;
      if (!recipient) return { status: 400, jsonBody: { error: 'No recipient email available' } };

      const installDate = job.tabs?.installation?.date;
      const vars = {
        customerName: customer.name || '',
        address: customer.address || '',
        installDate: installDate
          ? new Date(installDate).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
          : '',
        fitterNames: (job.tabs?.installation?.fitters || []).join(', '),
        companyName: 'VisualPro',
      };

      const tmpl = TEMPLATES[reminderKey];
      const subject = fillTemplate(tmpl.subject, vars);
      const plainText = fillTemplate(tmpl.body, vars);

      const { hostname } = await getSenderDomain();
      const senderAddress = `donotreply@${hostname}`;

      const poller = await emailClient.beginSend({
        senderAddress,
        content: { subject, plainText },
        recipients: { to: [{ address: recipient }] },
      });
      const result = await poller.pollUntilDone();

      // Only mark the real reminder as sent if this wasn't a test send to an override address.
      if (!testEmailOverride) {
        job.tabs = job.tabs || {};
        job.tabs.installation = job.tabs.installation || {};
        job.tabs.installation.emailReminders = job.tabs.installation.emailReminders || {};
        job.tabs.installation.emailReminders[reminderKey] = {
          status: 'sent',
          sentAt: new Date().toLocaleDateString('en-GB'),
        };
        await pool
          .request()
          .input('Id', sql.Int, jobId)
          .input('DataJson', sql.NVarChar, JSON.stringify(job))
          .query('UPDATE dbo.Jobs SET DataJson = @DataJson, UpdatedAt = SYSUTCDATETIME() WHERE Id = @Id');
      }

      return { status: 200, jsonBody: { sent: true, to: recipient, senderAddress, messageId: result.id } };
    } catch (err) {
      context.error('sendReminder failed', err);
      return { status: 500, jsonBody: { error: err.message } };
    }
  },
});
