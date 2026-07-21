const { app } = require('@azure/functions');
const { getPool } = require('../db');
const { sendJobReminder } = require('../reminderCore');

// Runs once daily at 07:00 UTC (~7-8am UK time depending on BST) and sends any reminder
// that's due and hasn't been sent yet. Uses "due within N days, not yet sent" rather than
// an exact-day match, so a reminder still goes out even if this run happens to be skipped
// or delayed on its exact target day — it just catches up next time, rather than silently
// never sending. Each job is handled independently (one failure doesn't stop the rest).
app.timer('reminderTimer', {
  schedule: '0 0 7 * * *',
  handler: async (myTimer, context) => {
    const pool = await getPool();
    const jobsResult = await pool.request().query('SELECT Id, DataJson FROM dbo.Jobs');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const row of jobsResult.recordset) {
      const jobId = row.Id;
      try {
        const job = JSON.parse(row.DataJson);
        const installDateStr = job.tabs?.installation?.date;
        if (!installDateStr) continue;

        const installDate = new Date(installDateStr);
        installDate.setHours(0, 0, 0, 0);
        const daysUntil = Math.round((installDate - today) / 86400000);

        const reminders = job.tabs?.installation?.emailReminders || {};

        if (daysUntil >= 1 && daysUntil <= 7 && reminders.week?.status !== 'sent') {
          try {
            const result = await sendJobReminder({ pool, jobId, reminderKey: 'week' });
            context.log(`Sent week reminder for job ${jobId}: ${result.messageId}`);
          } catch (err) {
            context.error(`Failed week reminder for job ${jobId}`, err);
          }
        }

        if (daysUntil >= 0 && daysUntil <= 1 && reminders.day?.status !== 'sent') {
          try {
            const result = await sendJobReminder({ pool, jobId, reminderKey: 'day' });
            context.log(`Sent day reminder for job ${jobId}: ${result.messageId}`);
          } catch (err) {
            context.error(`Failed day reminder for job ${jobId}`, err);
          }
        }
      } catch (err) {
        context.error(`Failed processing job ${jobId}`, err);
      }
    }
  },
});
