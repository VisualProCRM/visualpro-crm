const { app } = require('@azure/functions');
const { getPool } = require('../db');
const { sendJobReminder, getSenderDomain, getDomainProperties } = require('../reminderCore');
const { requireAuth } = require('../auth');

// Manual trigger — used by the app's "Send Now" button. The automatic daily version is
// reminderTimer.js, sharing the same sendJobReminder logic from reminderCore.js.
app.http('sendReminder', {
  methods: ['POST'],
  route: 'send-reminder',
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      requireAuth(request);
      const body = await request.json();
      const { jobId, reminderKey, testEmailOverride, debug } = body;

      if (debug === 'customDomain') {
        const props = await getDomainProperties('visualglazing.co.uk');
        return { jsonBody: props };
      }

      if (debug) {
        const domainInfo = await getSenderDomain();
        return { jsonBody: domainInfo };
      }

      if (!jobId || !['week', 'day'].includes(reminderKey)) {
        return { status: 400, jsonBody: { error: 'jobId and reminderKey ("week"|"day") are required' } };
      }

      const pool = await getPool();
      const result = await sendJobReminder({ pool, jobId, reminderKey, testEmailOverride });
      return { status: 200, jsonBody: result };
    } catch (err) {
      context.error('sendReminder failed', err);
      return { status: err.status || 500, jsonBody: { error: err.message } };
    }
  },
});
