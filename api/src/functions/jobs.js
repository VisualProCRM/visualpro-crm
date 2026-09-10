const { app } = require('@azure/functions');
const { getPool, sql } = require('../db');
const { mapJobRow } = require('../mapRow');
const { requireAuth } = require('../auth');
const { sendInstallBookedEmail, sendSurveyBookedEmail, sendServiceCallBookedEmail, sendFeedbackReviewEmail, feedbackQualifiesForReview, sendSurveyCompleteEmail } = require('../reminderCore');

app.http('jobsList', {
  methods: ['GET'],
  route: 'jobs',
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      requireAuth(request);
      const pool = await getPool();
      const result = await pool
        .request()
        .query('SELECT * FROM dbo.Jobs WHERE TenantId = 1 ORDER BY CreatedAt DESC');
      return { jsonBody: result.recordset.map(mapJobRow) };
    } catch (err) {
      context.error('jobsList failed', err);
      return { status: err.status || 500, jsonBody: { error: err.message } };
    }
  },
});

app.http('jobsGet', {
  methods: ['GET'],
  route: 'jobs/{id}',
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      requireAuth(request);
      const id = Number(request.params.id);
      const pool = await getPool();
      const result = await pool
        .request()
        .input('Id', sql.Int, id)
        .query('SELECT * FROM dbo.Jobs WHERE Id = @Id AND TenantId = 1');
      if (!result.recordset.length) return { status: 404, jsonBody: { error: 'Not found' } };
      return { jsonBody: mapJobRow(result.recordset[0]) };
    } catch (err) {
      context.error('jobsGet failed', err);
      return { status: err.status || 500, jsonBody: { error: err.message } };
    }
  },
});

app.http('jobsCreate', {
  methods: ['POST'],
  route: 'jobs',
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      requireAuth(request);
      const body = await request.json();
      const pool = await getPool();
      const result = await pool
        .request()
        .input('CustomerId', sql.Int, body.customerId)
        .input('Title', sql.NVarChar, body.title || '')
        .input('Status', sql.NVarChar, body.status || 'Book Survey')
        .input('DataJson', sql.NVarChar, JSON.stringify(body))
        .query(
          `INSERT INTO dbo.Jobs (CustomerId, Title, Status, DataJson)
           OUTPUT INSERTED.*
           VALUES (@CustomerId, @Title, @Status, @DataJson)`
        );
      return { status: 201, jsonBody: mapJobRow(result.recordset[0]) };
    } catch (err) {
      context.error('jobsCreate failed', err);
      return { status: err.status || 500, jsonBody: { error: err.message } };
    }
  },
});

app.http('jobsUpdate', {
  methods: ['PUT'],
  route: 'jobs/{id}',
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      requireAuth(request);
      const id = Number(request.params.id);
      const body = await request.json();
      const pool = await getPool();

      // Fetch the current row first so we can detect a survey being booked for the first
      // time (date+fitter newly set) — that's a genuine event, not something the daily
      // reminder timer can catch, so it's triggered here as a side effect of the save.
      const beforeResult = await pool.request().input('Id', sql.Int, id).query('SELECT DataJson FROM dbo.Jobs WHERE Id = @Id AND TenantId = 1');
      const before = beforeResult.recordset.length ? JSON.parse(beforeResult.recordset[0].DataJson) : null;

      const result = await pool
        .request()
        .input('Id', sql.Int, id)
        .input('CustomerId', sql.Int, body.customerId)
        .input('Title', sql.NVarChar, body.title || '')
        .input('Status', sql.NVarChar, body.status || 'Book Survey')
        .input('DataJson', sql.NVarChar, JSON.stringify(body))
        .query(
          `UPDATE dbo.Jobs SET CustomerId=@CustomerId, Title=@Title, Status=@Status, DataJson=@DataJson, UpdatedAt=SYSUTCDATETIME()
           OUTPUT INSERTED.*
           WHERE Id=@Id AND TenantId = 1`
        );
      if (!result.recordset.length) return { status: 404, jsonBody: { error: 'Not found' } };

      const wasBooked = !!(before?.tabs?.survey?.date && before?.tabs?.survey?.fitter);
      const isNowBooked = !!(body.tabs?.survey?.date && body.tabs?.survey?.fitter);
      const surveyNotifyEnabled = body.tabs?.survey?.notifyEnabled !== false; // default on
      const surveyAlreadySent = !!body.tabs?.survey?.emailSent;
      let sentAny = false;

      if (!wasBooked && isNowBooked && surveyNotifyEnabled && !surveyAlreadySent) {
        try {
          await sendSurveyBookedEmail({ pool, jobId: id });
          sentAny = true;
        } catch (err) {
          context.error('sendSurveyBookedEmail failed', err);
        }
      }

      // Install Booked — same shape as the survey check above. Was never actually wired up
      // despite the template existing in Settings (found 2026-08-11 after a real booking
      // didn't send); this closes that gap.
      const installWasBooked = !!(before?.tabs?.installation?.date && (before?.tabs?.installation?.fitters || []).length > 0);
      const installIsNowBooked = !!(body.tabs?.installation?.date && (body.tabs?.installation?.fitters || []).length > 0);
      const installNotifyEnabled = body.tabs?.installation?.notifyEnabled !== false; // default on
      const installAlreadySent = !!body.tabs?.installation?.bookedEmailSent;

      if (!installWasBooked && installIsNowBooked && installNotifyEnabled && !installAlreadySent) {
        try {
          await sendInstallBookedEmail({ pool, jobId: id });
          sentAny = true;
        } catch (err) {
          context.error('sendInstallBookedEmail failed', err);
        }
      }

      // Service Call supports multiple bookings (unlike Survey's single date+fitter), so
      // detect per-booking (by id) transitions from "not fully booked" to "fully booked" —
      // matching on id alone isn't enough, since the real UI flow is often: click "+ Book
      // Service Call" (creates an empty booking), fill in date/fitter, then save — sometimes
      // across two separate saves. If we only checked "is this id new", a booking created
      // blank in one save and filled in on a later save would never be detected, since its
      // id already existed. Instead: a booking counts as newly-booked if it now has a
      // date+fitter but didn't in the *prior* saved state (whether or not that id existed
      // before).
      const beforeBookingsById = new Map((before?.tabs?.serviceCall?.bookings || []).map((b) => [b.id, b]));
      const scNotifyEnabled = body.tabs?.serviceCall?.notifyEnabled !== false; // default on
      const newBookings = (body.tabs?.serviceCall?.bookings || []).filter((b) => {
        if (!b.date || !b.fitter || b.emailSent) return false;
        const prior = beforeBookingsById.get(b.id);
        const wasFullyBooked = !!(prior && prior.date && prior.fitter);
        return !wasFullyBooked;
      });
      if (scNotifyEnabled && newBookings.length) {
        for (const booking of newBookings) {
          try {
            await sendServiceCallBookedEmail({ pool, jobId: id, bookingId: booking.id });
            sentAny = true;
          } catch (err) {
            context.error('sendServiceCallBookedEmail failed', err);
          }
        }
      }

      // Survey completed → office notification — fires the first time the fitter marks the
      // whole digital survey complete (digitised.completedAt set). Recipient + which sections
      // to include are configured on the surveyComplete template in Settings.
      const surveyDoneWas = !!before?.tabs?.survey?.digitised?.completedAt;
      const surveyDoneNow = !!body.tabs?.survey?.digitised?.completedAt;
      const surveyCompleteAlreadySent = !!body.tabs?.survey?.completeEmailSent;
      if (!surveyDoneWas && surveyDoneNow && !surveyCompleteAlreadySent) {
        try {
          const scRow = await pool.request().query('SELECT DataJson FROM dbo.Settings WHERE TenantId = 1');
          const scSettings = scRow.recordset.length ? JSON.parse(scRow.recordset[0].DataJson) : {};
          const scTmpl = scSettings.emailTemplates?.surveyComplete;
          if (!scTmpl || scTmpl.enabled !== false) {
            await sendSurveyCompleteEmail({ pool, jobId: id });
            sentAny = true;
          }
        } catch (err) {
          context.error('sendSurveyCompleteEmail failed', err);
        }
      }

      // Feedback Form / review-invite email — fires the first time the customer's feedback
      // form is saved, if any question the office flagged in Settings → Feedback Form was
      // answered qualifyingly (4★+ or "Yes"). The BCC on the feedbackReview template is the
      // TrustPilot Automatic Feedback Service alias, so BCC'ing it is what triggers the
      // actual review invite.
      const feedbackWasSaved = !!before?.tabs?.installation?.feedback;
      const feedbackIsNowSaved = !!body.tabs?.installation?.feedback;
      const feedbackAlreadySent = !!body.tabs?.installation?.feedbackEmailSent;
      if (!feedbackWasSaved && feedbackIsNowSaved && !feedbackAlreadySent) {
        try {
          const settingsRow = await pool.request().query('SELECT DataJson FROM dbo.Settings WHERE TenantId = 1');
          const feedbackSettings = settingsRow.recordset.length ? JSON.parse(settingsRow.recordset[0].DataJson) : {};
          if (feedbackQualifiesForReview(body.tabs.installation.feedback, feedbackSettings.feedbackQuestions)) {
            await sendFeedbackReviewEmail({ pool, jobId: id });
            sentAny = true;
          }
        } catch (err) {
          context.error('sendFeedbackReviewEmail failed', err);
        }
      }

      if (sentAny) {
        const refreshed = await pool.request().input('Id', sql.Int, id).query('SELECT * FROM dbo.Jobs WHERE Id = @Id');
        return { jsonBody: mapJobRow(refreshed.recordset[0]) };
      }

      return { jsonBody: mapJobRow(result.recordset[0]) };
    } catch (err) {
      context.error('jobsUpdate failed', err);
      return { status: err.status || 500, jsonBody: { error: err.message } };
    }
  },
});

app.http('jobsDelete', {
  methods: ['DELETE'],
  route: 'jobs/{id}',
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      requireAuth(request);
      const id = Number(request.params.id);
      const pool = await getPool();
      await pool.request().input('Id', sql.Int, id).query('DELETE FROM dbo.Jobs WHERE Id=@Id AND TenantId = 1');
      return { status: 204 };
    } catch (err) {
      context.error('jobsDelete failed', err);
      return { status: err.status || 500, jsonBody: { error: err.message } };
    }
  },
});
