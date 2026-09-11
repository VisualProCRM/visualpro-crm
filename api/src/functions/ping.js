const { app } = require('@azure/functions');

// Deliberately the simplest possible endpoint: no auth check, no database, no blob storage —
// used client-side as a pure network-reachability/latency probe before starting a voice
// recording (see VoiceMicButton's checkSignalOk in index.html). Keeping it dependency-free
// matters: if this hit the database, a slow SQL wake-up from idle (a known, separate gotcha)
// would get misread as "weak signal" and block voice input for no real reason.
app.http('ping', {
  methods: ['GET'],
  route: 'ping',
  authLevel: 'anonymous',
  handler: async () => ({ jsonBody: { ok: true } }),
});
