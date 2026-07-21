const { EmailClient } = require('@azure/communication-email');
const { DefaultAzureCredential } = require('@azure/identity');
const { getPool, sql } = require('./db');

// Shared by both the manual "Send Now" endpoint (sendReminder.js) and the daily automatic
// timer (reminderTimer.js), so both send identically and there's only one place to fix bugs.

const emailClient = new EmailClient(process.env.ACS_CONNECTION_STRING);
const armCredential = new DefaultAzureCredential();

// Looks up an ACS Email domain's properties via the ARM API (read-only, via the Function
// App's managed identity + Reader role). Shared by getSenderDomain() (the domain currently
// configured to send from) and the debug endpoint's custom-domain-verification lookup.
async function getDomainProperties(domainName) {
  const token = await armCredential.getToken('https://management.azure.com/.default');
  const subId = process.env.AZURE_SUBSCRIPTION_ID;
  const rg = process.env.RESOURCE_GROUP_NAME;
  const emailServiceName = process.env.EMAIL_SERVICE_NAME;
  const url = `https://management.azure.com/subscriptions/${subId}/resourceGroups/${rg}/providers/Microsoft.Communication/emailServices/${emailServiceName}/domains/${domainName}?api-version=2023-04-01`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token.token}` } });
  if (!res.ok) {
    throw new Error(`ARM lookup failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  return json.properties || {};
}

// Looks up the actual assigned sender hostname for whichever domain is currently configured
// (EMAIL_DOMAIN_NAME — "AzureManagedDomain" by default, or the custom domain once verified)
// via the ARM API rather than hardcoding it, since the exact hostname is only known after
// deployment.
async function getSenderDomain() {
  const domainName = process.env.EMAIL_DOMAIN_NAME || 'AzureManagedDomain';
  const props = await getDomainProperties(domainName);
  const hostname = props.mailFromSenderDomain || props.fromSenderDomain || props.dataLocation || domainName;
  return { hostname, rawProperties: props };
}

function fillTemplate(tmpl, vars) {
  return Object.entries(vars).reduce(
    (str, [key, val]) => str.replaceAll(`{{${key}}}`, val || ''),
    tmpl
  );
}

// Matches DEFAULT_EMAIL_TEMPLATES.installReminder in index.html — used only if Settings has
// never been saved (no row yet).
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

// Sends a reminder for one job. Pass testEmailOverride to send a real test without
// emailing the actual customer or marking their reminder "sent" (used by the manual
// endpoint's test path — the timer never passes this).
async function sendJobReminder({ pool, jobId, reminderKey, testEmailOverride }) {
  const jobResult = await pool.request().input('Id', sql.Int, jobId).query('SELECT * FROM dbo.Jobs WHERE Id = @Id');
  if (!jobResult.recordset.length) throw new Error('Job not found');
  const jobRow = jobResult.recordset[0];
  const job = JSON.parse(jobRow.DataJson);

  const customerResult = await pool
    .request()
    .input('Id', sql.Int, jobRow.CustomerId)
    .query('SELECT * FROM dbo.Customers WHERE Id = @Id');
  if (!customerResult.recordset.length) throw new Error('Customer not found');
  const customer = JSON.parse(customerResult.recordset[0].DataJson);

  const recipient = testEmailOverride || customer.email;
  if (!recipient) throw new Error('No recipient email available');

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
  const senderUsername = process.env.EMAIL_SENDER_USERNAME || 'donotreply';
  const senderAddress = `${senderUsername}@${hostname}`;

  const poller = await emailClient.beginSend({
    senderAddress,
    content: { subject, plainText },
    recipients: { to: [{ address: recipient }] },
  });
  const result = await poller.pollUntilDone();

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

  return { sent: true, to: recipient, senderAddress, messageId: result.id };
}

module.exports = { sendJobReminder, getSenderDomain, getDomainProperties };
