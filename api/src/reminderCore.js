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

// BCCs to the sending template's own bcc field (if set) — configured per-template in
// Settings, not a single global address, so different templates can go to different
// inboxes if needed. Lets the office see when a send actually went out.
function buildRecipients(recipient, tmpl) {
  const recipients = { to: [{ address: recipient }] };
  if (tmpl.bcc && tmpl.bcc.trim()) {
    recipients.bcc = [{ address: tmpl.bcc.trim() }];
  }
  return recipients;
}

// Matches DEFAULT_EMAIL_TEMPLATES in index.html — used only if Settings has never been
// saved (no row yet) or is missing that particular template key.
const DEFAULT_INSTALL_REMINDER_WEEK = {
  subject: 'Reminder: Your Installation is Coming Up – {{customerName}}',
  body: `Dear {{customerName}},

This is a friendly reminder that your installation is coming up in the next week:

Date: {{installDate}}
Installers: {{fitterNames}}
Address: {{address}}

Please ensure:
- Access to the property is available
- Any furniture near the areas to be fitted is cleared
- Pets are secured away from the work area

We look forward to seeing you soon!

Kind regards,
{{companyName}}
{{companyPhone}}`,
};

const DEFAULT_INSTALL_REMINDER_DAY = {
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

const DEFAULT_SURVEY_BOOKED = {
  subject: 'Your Survey has been Booked – {{customerName}}',
  body: `Dear {{customerName}},

Thank you for choosing us! We're pleased to confirm that your survey has been booked for:

Date: {{surveyDate}}
Surveyor: {{fitterName}}
Address: {{address}}

If you need to rearrange or have any questions, please don't hesitate to get in touch.

Kind regards,
{{companyName}}
{{companyPhone}}`,
};

const DEFAULT_SERVICE_CALL_BOOKED = {
  subject: 'Your Service Call has been Booked – {{customerName}}',
  body: `Dear {{customerName}},

Thank you for contacting us. We're pleased to confirm your service call has been booked for:

Date: {{serviceCallDate}}
Fitter: {{fitterName}}
Address: {{address}}

If you need to rearrange or have any questions, please don't hesitate to get in touch.

Kind regards,
{{companyName}}
{{companyPhone}}`,
};

const DEFAULT_SURVEY_REMINDER_DAY = {
  subject: 'Reminder: Your Survey is Tomorrow – {{customerName}}',
  body: `Dear {{customerName}},

This is a friendly reminder that your survey is scheduled for tomorrow:

Date: {{surveyDate}}
Surveyor: {{fitterName}}
Address: {{address}}

If you need to rearrange or have any questions, please don't hesitate to get in touch.

Kind regards,
{{companyName}}
{{companyPhone}}`,
};

const DEFAULT_SERVICE_CALL_REMINDER_DAY = {
  subject: 'Reminder: Your Service Call is Tomorrow – {{customerName}}',
  body: `Dear {{customerName}},

This is a friendly reminder that your service call is scheduled for tomorrow:

Date: {{serviceCallDate}}
Fitter: {{fitterName}}
Address: {{address}}

If you need to rearrange or have any questions, please don't hesitate to get in touch.

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
  const templateKey = reminderKey === 'week' ? 'installReminderWeek' : 'installReminderDay';
  const defaultTmpl = reminderKey === 'week' ? DEFAULT_INSTALL_REMINDER_WEEK : DEFAULT_INSTALL_REMINDER_DAY;
  const tmpl = settings.emailTemplates?.[templateKey] || defaultTmpl;

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
    recipients: buildRecipients(recipient, tmpl),
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

// Sends the "survey booked" email for a job. Called from jobs.js's update handler the
// moment a survey's date+fitter are first set (see there for the actual trigger/toggle
// check) — this function itself just sends and marks the job's tabs.survey.emailSent
// status, mirroring the emailReminders.week/day pattern used for install reminders.
async function sendSurveyBookedEmail({ pool, jobId, testEmailOverride }) {
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
  const tmpl = settings.emailTemplates?.surveyBooked || DEFAULT_SURVEY_BOOKED;

  const surveyDate = job.tabs?.survey?.date;
  const vars = {
    customerName: customer.name || '',
    address: customer.address || '',
    surveyDate: surveyDate
      ? new Date(surveyDate).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      : '',
    fitterName: job.tabs?.survey?.fitter || '',
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
    recipients: buildRecipients(recipient, tmpl),
  });
  const result = await poller.pollUntilDone();

  if (!testEmailOverride) {
    job.tabs = job.tabs || {};
    job.tabs.survey = job.tabs.survey || {};
    job.tabs.survey.emailSent = { status: 'sent', sentAt: new Date().toLocaleDateString('en-GB') };
    await pool
      .request()
      .input('Id', sql.Int, jobId)
      .input('DataJson', sql.NVarChar, JSON.stringify(job))
      .query('UPDATE dbo.Jobs SET DataJson = @DataJson, UpdatedAt = SYSUTCDATETIME() WHERE Id = @Id');
  }

  return { sent: true, to: recipient, senderAddress, messageId: result.id };
}

// Sends the "service call booked" email for one specific booking on a job. Unlike Survey
// (a single date+fitter on the job), Service Call supports multiple bookings
// (job.tabs.serviceCall.bookings, each with its own id) — so this targets one booking by
// id, and marks sent-status on that booking specifically, not the job as a whole. Called
// from jobs.js's update handler the moment a *new* booking (by id) is detected.
async function sendServiceCallBookedEmail({ pool, jobId, bookingId, testEmailOverride }) {
  const jobResult = await pool.request().input('Id', sql.Int, jobId).query('SELECT * FROM dbo.Jobs WHERE Id = @Id');
  if (!jobResult.recordset.length) throw new Error('Job not found');
  const jobRow = jobResult.recordset[0];
  const job = JSON.parse(jobRow.DataJson);

  const bookings = job.tabs?.serviceCall?.bookings || [];
  const booking = bookings.find((b) => b.id === bookingId);
  if (!booking) throw new Error('Service call booking not found');

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
  const tmpl = settings.emailTemplates?.serviceCallBooked || DEFAULT_SERVICE_CALL_BOOKED;

  const vars = {
    customerName: customer.name || '',
    address: customer.address || '',
    serviceCallDate: booking.date
      ? new Date(booking.date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      : '',
    fitterName: booking.fitter || '',
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
    recipients: buildRecipients(recipient, tmpl),
  });
  const result = await poller.pollUntilDone();

  if (!testEmailOverride) {
    job.tabs.serviceCall.bookings = bookings.map((b) =>
      b.id === bookingId ? { ...b, emailSent: { status: 'sent', sentAt: new Date().toLocaleDateString('en-GB') } } : b
    );
    await pool
      .request()
      .input('Id', sql.Int, jobId)
      .input('DataJson', sql.NVarChar, JSON.stringify(job))
      .query('UPDATE dbo.Jobs SET DataJson = @DataJson, UpdatedAt = SYSUTCDATETIME() WHERE Id = @Id');
  }

  return { sent: true, to: recipient, senderAddress, messageId: result.id };
}

// Sends the "survey reminder" email (day before) for a job. Mirrors sendSurveyBookedEmail
// but uses the surveyReminderDay template and marks tabs.survey.reminderSent separately from
// emailSent (the booking-confirmation email), so both are tracked independently. Called from
// reminderTimer.js's daily scan, not from a save-triggered transition.
async function sendSurveyReminderEmail({ pool, jobId, testEmailOverride }) {
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
  const tmpl = settings.emailTemplates?.surveyReminderDay || DEFAULT_SURVEY_REMINDER_DAY;

  const surveyDate = job.tabs?.survey?.date;
  const vars = {
    customerName: customer.name || '',
    address: customer.address || '',
    surveyDate: surveyDate
      ? new Date(surveyDate).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      : '',
    fitterName: job.tabs?.survey?.fitter || '',
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
    recipients: buildRecipients(recipient, tmpl),
  });
  const result = await poller.pollUntilDone();

  if (!testEmailOverride) {
    job.tabs = job.tabs || {};
    job.tabs.survey = job.tabs.survey || {};
    job.tabs.survey.reminderSent = { status: 'sent', sentAt: new Date().toLocaleDateString('en-GB') };
    await pool
      .request()
      .input('Id', sql.Int, jobId)
      .input('DataJson', sql.NVarChar, JSON.stringify(job))
      .query('UPDATE dbo.Jobs SET DataJson = @DataJson, UpdatedAt = SYSUTCDATETIME() WHERE Id = @Id');
  }

  return { sent: true, to: recipient, senderAddress, messageId: result.id };
}

// Sends the "service call reminder" email (day before) for one specific booking on a job.
// Mirrors sendServiceCallBookedEmail but uses the serviceCallReminderDay template and marks
// that booking's reminderSent separately from emailSent (the booking-confirmation email).
async function sendServiceCallReminderEmail({ pool, jobId, bookingId, testEmailOverride }) {
  const jobResult = await pool.request().input('Id', sql.Int, jobId).query('SELECT * FROM dbo.Jobs WHERE Id = @Id');
  if (!jobResult.recordset.length) throw new Error('Job not found');
  const jobRow = jobResult.recordset[0];
  const job = JSON.parse(jobRow.DataJson);

  const bookings = job.tabs?.serviceCall?.bookings || [];
  const booking = bookings.find((b) => b.id === bookingId);
  if (!booking) throw new Error('Service call booking not found');

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
  const tmpl = settings.emailTemplates?.serviceCallReminderDay || DEFAULT_SERVICE_CALL_REMINDER_DAY;

  const vars = {
    customerName: customer.name || '',
    address: customer.address || '',
    serviceCallDate: booking.date
      ? new Date(booking.date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      : '',
    fitterName: booking.fitter || '',
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
    recipients: buildRecipients(recipient, tmpl),
  });
  const result = await poller.pollUntilDone();

  if (!testEmailOverride) {
    job.tabs.serviceCall.bookings = bookings.map((b) =>
      b.id === bookingId ? { ...b, reminderSent: { status: 'sent', sentAt: new Date().toLocaleDateString('en-GB') } } : b
    );
    await pool
      .request()
      .input('Id', sql.Int, jobId)
      .input('DataJson', sql.NVarChar, JSON.stringify(job))
      .query('UPDATE dbo.Jobs SET DataJson = @DataJson, UpdatedAt = SYSUTCDATETIME() WHERE Id = @Id');
  }

  return { sent: true, to: recipient, senderAddress, messageId: result.id };
}

module.exports = {
  sendJobReminder,
  sendSurveyBookedEmail,
  sendServiceCallBookedEmail,
  sendSurveyReminderEmail,
  sendServiceCallReminderEmail,
  getSenderDomain,
  getDomainProperties,
};
