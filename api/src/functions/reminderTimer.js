const { app } = require('@azure/functions');
const { getPool } = require('../db');
const { sendJobReminder, sendSurveyReminderEmail, sendServiceCallReminderEmail, bookingFitters } = require('../reminderCore');

// Runs hourly through the working day and sends any reminder that's due and hasn't been sent.
//
// Day-before reminders fire ONLY when the appointment is exactly 1 day away. They used to fire
// at 0 or 1 days as a catch-up, which meant a booking made after the single daily run got its
// "tomorrow" reminder on the morning of the appointment itself — wrong, and confusing (three
// went out that way on 2026-09-23). Running hourly instead is what keeps last-minute bookings
// covered: a survey booked at 2pm still gets its reminder that afternoon, the day before.
//
// Anything booked after the last run on the day before gets no reminder at all — by design.
// The booking confirmation, sent immediately on booking, already states the date.
//
// Each job is handled independently (one failure doesn't stop the rest), and every reminder
// records that it was sent, so running hourly cannot produce duplicates.
//
// Schedule is UTC: 07:00-19:00 UTC is 08:00-20:00 UK during British Summer Time.
app.timer('reminderTimer', {
  schedule: '0 0 7-19 * * *',
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

          if (daysUntil === 1 && reminders.day?.status !== 'sent') {
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
          bookingFitters(job.tabs?.survey).length &&
          job.tabs?.survey?.notifyEnabled !== false &&
          job.tabs?.survey?.reminderSent?.status !== 'sent'
        ) {
          const surveyDate = new Date(surveyDateStr);
          surveyDate.setHours(0, 0, 0, 0);
          const surveyDaysUntil = Math.round((surveyDate - today) / 86400000);
          if (surveyDaysUntil === 1) {
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
          if (!booking.date || !bookingFitters(booking).length || !scNotifyEnabled || booking.reminderSent?.status === 'sent') continue;
          const bookingDate = new Date(booking.date);
          bookingDate.setHours(0, 0, 0, 0);
          const bookingDaysUntil = Math.round((bookingDate - today) / 86400000);
          if (bookingDaysUntil === 1) {
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
