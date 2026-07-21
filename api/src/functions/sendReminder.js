const { app } = require('@azure/functions');
const { EmailClient } = require('@azure/communication-email');
const { DefaultAzureCredential } = require('@azure/identity');
const { getPool, sql } = require('../db');

const emailClient = new EmailClient(process.env.ACS_CONNECTION_STRING);
const armCredential = new DefaultAzureCredential();

// Looks up the Azure-managed domain's actual assigned sender hostname via the ARM API
// (read-only, via the Function App's managed identity + Reader role) rather than hardcoding
// it, since the exact hostname is only known after deployment.
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

// Matches DEFAULT_EMAIL_TEMPLATES.installReminder in index.html — used only if Settings has
// never been saved (no row yet). Once saved, the real settings.emailTemplates.installReminder
// (whatever the office has customized it to) is used instead, fetched fresh from the
// database on every send, not the frontend's in-memory copy.
const DEFAULT_INSTALL_REMINDER = {
  subject: 'Reminder: Your Installation is Tomorrow – {{customerName}}',
  body: `Dear {{customerName}},

This is a friendly reminder that your installation is scheduled for tomorrow:

Date: {{installDate}}
Installers: {{fitterNames}}
Address: {{address}}

Please ensure:
- Access to the property is available
- Any furniture near the areas to be fitted is cleared
- Pets are secured away from the work area

We look forward to seeing you tomorrow!

Kind regards,
{{companyName}}
{{companyPhone}}`,
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

      const settingsResult = await pool.request().query('SELECT * FROM dbo.Settings WHERE TenantId = 1');
      const settings = settingsResult.recordset.length ? JSON.parse(settingsResult.recordset[0].DataJson) : {};
      const tmpl = settings.emailTemplates?.installReminder || DEFAULT_INSTALL_REMINDER;

      const installDate = job.tabs?.installation?.date;
      const vars = {
        customerName: customer.name || '',
        address: customer.address || '',
        installDate: installDate
          ? new Date(installDate).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
          : '',
        fitterNames: (job.tabs?.installation?.fitters || []).join(', '),
        companyName: settings.companyName || 'VisualPro',
        companyPhone: settings.companyPhone || '',
      };

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
