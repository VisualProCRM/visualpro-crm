const { app } = require('@azure/functions');
const { getPool } = require('../db');
const { sendJobReminder, sendSurveyReminderEmail, sendServiceCallReminderEmail } = require('../reminderCore');

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
        if (installDateStr) {
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
        }

        // Survey day-before reminder — reuses the same notifyEnabled toggle as the
        // "survey booked" confirmation email, tracked separately via reminderSent so both
        // emails' sent-status can be seen independently.
        const surveyDateStr = job.tabs?.survey?.date;
        if (
          surveyDateStr &&
          job.tabs?.survey?.fitter &&
          job.tabs?.survey?.notifyEnabled !== false &&
          job.tabs?.survey?.reminderSent?.status !== 'sent'
        ) {
          const surveyDate = new Date(surveyDateStr);
          surveyDate.setHours(0, 0, 0, 0);
          const surveyDaysUntil = Math.round((surveyDate - today) / 86400000);
          if (surveyDaysUntil >= 0 && surveyDaysUntil <= 1) {
            try {
              const result = await sendSurveyReminderEmail({ pool, jobId });
              context.log(`Sent survey reminder for job ${jobId}: ${result.messageId}`);
            } catch (err) {
              context.error(`Failed survey reminder for job ${jobId}`, err);
            }
          }
        }

        // Service Call day-before reminders — one per booking, since a job can have several.
        const scNotifyEnabled = job.tabs?.serviceCall?.notifyEnabled !== false;
        const scBookings = job.tabs?.serviceCall?.bookings || [];
        for (const booking of scBookings) {
          if (!booking.date || !booking.fitter || !scNotifyEnabled || booking.reminderSent?.status === 'sent') continue;
          const bookingDate = new Date(booking.date);
          bookingDate.setHours(0, 0, 0, 0);
          const bookingDaysUntil = Math.round((bookingDate - today) / 86400000);
          if (bookingDaysUntil >= 0 && bookingDaysUntil <= 1) {
            try {
              const result = await sendServiceCallReminderEmail({ pool, jobId, bookingId: booking.id });
              context.log(`Sent service call reminder for job ${jobId} booking ${booking.id}: ${result.messageId}`);
            } catch (err) {
              context.error(`Failed service call reminder for job ${jobId} booking ${booking.id}`, err);
            }
          }
        }
      } catch (err) {
        context.error(`Failed processing job ${jobId}`, err);
      }
    }
  },
});
