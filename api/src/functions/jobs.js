const { app } = require('@azure/functions');
const { getPool, sql } = require('../db');
const { mapJobRow } = require('../mapRow');
const { requireAuth } = require('../auth');
const { nextLinkLog } = require('../customerLink');
const { sendInstallBookedEmail, sendSurveyBookedEmail, sendServiceCallBookedEmail, sendFeedbackReviewEmail, feedbackQualifiesForReview, sendSurveyCompleteEmail, bookingFitters, installBookings, sendFitterCheckEmail, bumpFollowedUpStage } = require('../reminderCore');

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
      const auth = requireAuth(request);
      const id = Number(request.params.id);
      const body = await request.json();
      const pool = await getPool();

      // Fetch the current row first so we can detect a survey being booked for the first
      // time (date+fitter newly set) — that's a genuine event, not something the daily
      // reminder timer can catch, so it's triggered here as a side effect of the save.
      const beforeResult = await pool.request().input('Id', sql.Int, id).query('SELECT DataJson, CustomerId FROM dbo.Jobs WHERE Id = @Id AND TenantId = 1');
      const before = beforeResult.recordset.length ? JSON.parse(beforeResult.recordset[0].DataJson) : null;

      // Who a job belongs to decides who its emails go to, so any change to it is recorded: the
      // stored log is carried forward (never taken from the client) and an entry is added when
      // this save moves the link. Compared against the column, which is what emails are sent by.
      if (beforeResult.recordset.length) {
        body.customerLinkLog = nextLinkLog(before?.customerLinkLog, beforeResult.recordset[0].CustomerId, body.customerId, 'office-save', auth.email || auth.role);
      }

      // Check-ins are never taken from the client. A job save sends the whole record, so a
      // client holding a copy from before a fitter checked in or out would erase it — which is
      // how a real check-out was lost on 2026-09-23. Times are stamped only by the check-in
      // endpoint, so whatever is stored always wins here.
      if (before?.tabs?.installation?.checkIns) {
        body.tabs = body.tabs || {};
        body.tabs.installation = body.tabs.installation || {};
        body.tabs.installation.checkIns = before.tabs.installation.checkIns;
      }

      // Neither is an email's sent-status, for the same reason and with a worse consequence. The
      // reminder timer runs hourly and marks each install visit once its reminder has gone out; an
      // office client holding a copy from before that mark would clear it, and the next run would
      // email the customer the same "your installation is tomorrow" again. Stamped only by the
      // send itself, so what is stored always wins.
      if (Array.isArray(before?.tabs?.installation?.bookings) && Array.isArray(body?.tabs?.installation?.bookings)) {
        const sentById = new Map(before.tabs.installation.bookings.map((b) => [b.id, b]));
        body.tabs.installation.bookings = body.tabs.installation.bookings.map((b) => {
          const prior = sentById.get(b.id);
          if (!prior) return b;
          return {
            ...b,
            bookedEmailSent: prior.bookedEmailSent || b.bookedEmailSent,
            emailReminders: prior.emailReminders || b.emailReminders,
          };
        });
      }

      // Same protection, same reason, for a follow-up's automated email: the hourly timer marks
      // it sent, and a stale save must never clear that mark — the next run would email the
      // customer the same follow-up again.
      if (Array.isArray(before?.tabs?.tasks) && Array.isArray(body?.tabs?.tasks)) {
        const priorById = new Map(before.tabs.tasks.map((t) => [t.id, t]));
        body.tabs.tasks = body.tabs.tasks.map((t) => {
          const prior = priorById.get(t.id);
          if (!prior || prior.kind !== 'followup') return t;
          return prior.emailStatus?.status === 'sent' ? { ...t, emailStatus: prior.emailStatus } : t;
        });
      }

      // A follow-up marked done is a genuine "we followed up" event, exactly like its automated
      // email actually sending — nudge the job forward the same way. Only on the actual
      // false->true transition, so re-saving an already-closed follow-up doesn't do anything.
      if (Array.isArray(body?.tabs?.tasks)) {
        const beforeById = new Map((before?.tabs?.tasks || []).map((t) => [t.id, t]));
        for (const t of body.tabs.tasks) {
          if (t.kind !== 'followup' || !t.done) continue;
          const prior = beforeById.get(t.id);
          if (prior?.done) continue;
          bumpFollowedUpStage(body);
        }
      }

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

      const wasBooked = !!(before?.tabs?.survey?.date && bookingFitters(before?.tabs?.survey).length);
      const isNowBooked = !!(body.tabs?.survey?.date && bookingFitters(body.tabs?.survey).length);
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

      // Install Booked — one confirmation per install visit, since a job fitted in phases has
      // several. Detected exactly like Service Call bookings below, and for the same reason: the
      // real flow is click "+ Add Install Date" (creates an empty card), fill in date and fitters,
      // then save — sometimes across two saves. Testing "is this id new" would miss that entirely,
      // so a visit counts as newly booked when it has a date+fitters now and didn't in the prior
      // saved state. Adding a second phase must never resend the first phase's confirmation.
      const beforeInstallById = new Map(installBookings(before || {}).map((b) => [b.id, b]));
      const installNotifyEnabled = body.tabs?.installation?.notifyEnabled !== false; // default on
      const newInstallBookings = installBookings(body).filter((b) => {
        if (!b.date || !bookingFitters(b).length || b.bookedEmailSent) return false;
        const prior = beforeInstallById.get(b.id);
        const wasFullyBooked = !!(prior && prior.date && bookingFitters(prior).length);
        return !wasFullyBooked;
      });
      if (installNotifyEnabled && newInstallBookings.length) {
        for (const booking of newInstallBookings) {
          try {
            await sendInstallBookedEmail({ pool, jobId: id, bookingId: booking.id });
            sentAny = true;
          } catch (err) {
            context.error('sendInstallBookedEmail failed', err);
          }
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
        if (!b.date || !bookingFitters(b).length || b.emailSent) return false;
        const prior = beforeBookingsById.get(b.id);
        const wasFullyBooked = !!(prior && prior.date && bookingFitters(prior).length);
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

// Records a fitter checking in or out, and emails the office.
//
// Deliberately its own endpoint rather than part of a normal job save. Saving a job writes the
// whole record, so any client holding a slightly older copy silently wipes newer fields — which
// is exactly what happened on 2026-09-23: a fitter checked out on their phone, the email went,
// and a stale save from the office view then erased the check-out time. Check-in/out is the one
// thing two devices touch at the same moment, so it reads and writes only the checkIns array,
// server-side, under its own request.
app.http('jobCheckIn', {
  methods: ['POST'],
  route: 'jobs/{id}/checkin',
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      requireAuth(request);
      const id = Number(request.params.id);
      const { fitter, kind, bookingId } = await request.json();
      if (!fitter || !['in', 'out'].includes(kind)) {
        return { status: 400, jsonBody: { error: 'fitter and kind ("in" or "out") are required' } };
      }

      const pool = await getPool();
      const rows = await pool.request().input('Id', sql.Int, id).query('SELECT DataJson FROM dbo.Jobs WHERE Id = @Id AND TenantId = 1');
      if (!rows.recordset.length) return { status: 404, jsonBody: { error: 'Not found' } };

      const job = JSON.parse(rows.recordset[0].DataJson);
      job.tabs = job.tabs || {};
      job.tabs.installation = job.tabs.installation || {};
      const list = job.tabs.installation.checkIns || [];
      // One record per fitter per VISIT, not per job: a job fitted in phases has the same fitter
      // on site more than once, and keying on the name alone meant phase 2's check-in landed on
      // phase 1's already-closed record and was rejected as "already recorded". Entries written
      // before this have no bookingId and belong to the job's only visit, so they still match.
      const visitId = bookingId || null;
      let entry = list.find((c) => c.fitter === fitter && (c.bookingId || null) === visitId);
      if (!entry) {
        entry = visitId ? { fitter, bookingId: visitId } : { fitter };
        list.push(entry);
      }
      const stamp = kind === 'out' ? 'outAt' : 'inAt';
      // Already recorded — return what's stored rather than moving the time or re-sending.
      const alreadyDone = !!entry[stamp];
      if (!alreadyDone) entry[stamp] = new Date().toISOString();
      job.tabs.installation.checkIns = list;

      await pool
        .request()
        .input('Id', sql.Int, id)
        .input('DataJson', sql.NVarChar, JSON.stringify(job))
        .query('UPDATE dbo.Jobs SET DataJson = @DataJson, UpdatedAt = SYSUTCDATETIME() WHERE Id = @Id AND TenantId = 1');

      if (!alreadyDone) {
        try {
          const setRow = await pool.request().query('SELECT DataJson FROM dbo.Settings WHERE TenantId = 1');
          const settings = setRow.recordset.length ? JSON.parse(setRow.recordset[0].DataJson) : {};
          const tmpl = settings.emailTemplates?.[kind === 'out' ? 'fitterCheckOut' : 'fitterCheckIn'];
          if (!tmpl || tmpl.enabled !== false) {
            await sendFitterCheckEmail({ pool, jobId: id, fitter, kind, bookingId });
          }
        } catch (err) {
          // The time is recorded either way — a failed email must not lose the check-in.
          context.error('sendFitterCheckEmail failed', err);
        }
      }

      const refreshed = await pool.request().input('Id', sql.Int, id).query('SELECT * FROM dbo.Jobs WHERE Id = @Id AND TenantId = 1');
      return { jsonBody: mapJobRow(refreshed.recordset[0]) };
    } catch (err) {
      context.error('jobCheckIn failed', err);
      return { status: err.status || 500, jsonBody: { error: err.message } };
    }
  },
});
