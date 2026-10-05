const { app } = require('@azure/functions');
const { getPool } = require('../db');
const { sendJobReminder, sendSurveyReminderEmail, sendServiceCallReminderEmail, sendFollowUpEmail, bookingFitters, installBookings } = require('../reminderCore');

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

    const settingsResult = await pool.request().query('SELECT DataJson FROM dbo.Settings WHERE TenantId = 1');
    const settings = settingsResult.recordset.length ? JSON.parse(settingsResult.recordset[0].DataJson) : {};
    const followUpAutoSendEnabled = settings.followUpAutoSendEnabled !== false;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const row of jobsResult.recordset) {
      const jobId = row.Id;
      try {
        const job = JSON.parse(row.DataJson);

        // One set of reminders per install visit, each tracked against its own booking. Reading
        // the job's single mirrored date instead would remind about the next visit only, and the
        // job-level "already sent" flag would then silence every later phase for good.
        //
        // Honours the "Send install booked email automatically" switch, whose label promises it
        // covers each install date's "own confirmation and its own reminders". Reminders used to
        // ignore it, so a date entered with the switch off — typically a provisional one the
        // customer hadn't been told about — still got a reminder (M & J Building, 2026-10-05).
        const installNotifyEnabled = job.tabs?.installation?.notifyEnabled !== false;
        for (const booking of installBookings(job)) {
          if (!installNotifyEnabled || !booking.date || booking.completed) continue;
          const installDate = new Date(booking.date);
          installDate.setHours(0, 0, 0, 0);
          const daysUntil = Math.round((installDate - today) / 86400000);

          const reminders = booking.emailReminders || {};

          if (daysUntil >= 1 && daysUntil <= 7 && reminders.week?.status !== 'sent') {
            try {
              const result = await sendJobReminder({ pool, jobId, reminderKey: 'week', bookingId: booking.id });
              context.log(`Sent week reminder for job ${jobId} booking ${booking.id}: ${result.messageId}`);
            } catch (err) {
              context.error(`Failed week reminder for job ${jobId} booking ${booking.id}`, err);
            }
          }

          if (daysUntil === 1 && reminders.day?.status !== 'sent') {
            try {
              const result = await sendJobReminder({ pool, jobId, reminderKey: 'day', bookingId: booking.id });
              context.log(`Sent day reminder for job ${jobId} booking ${booking.id}: ${result.messageId}`);
            } catch (err) {
              context.error(`Failed day reminder for job ${jobId} booking ${booking.id}`, err);
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

        // Follow-ups flagged with "Flag + Schedule Email" — one send, the day its chase period
        // lapses, not a week/day-before pair like the others above. A follow-up the office has
        // since closed is excluded by !t.done alone, which is also what makes closing one early
        // enough to cancel its pending email — nothing extra to do for that case.
        if (followUpAutoSendEnabled) {
          const followUps = (job.tabs?.tasks || []).filter(
            (t) => t.kind === 'followup' && t.scheduleEmail && !t.done && t.emailStatus?.status !== 'sent' && t.dueDate && t.dueDate <= today.toISOString().slice(0, 10)
          );
          for (const task of followUps) {
            try {
              const result = await sendFollowUpEmail({ pool, jobId, taskId: task.id });
              context.log(`Sent follow-up email for job ${jobId} task ${task.id}: ${result.messageId}`);
            } catch (err) {
              context.error(`Failed follow-up email for job ${jobId} task ${task.id}`, err);
            }
          }
        }
      } catch (err) {
        context.error(`Failed processing job ${jobId}`, err);
      }
    }
  },
});
