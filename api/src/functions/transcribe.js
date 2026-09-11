const { app } = require('@azure/functions');
const { requireAuth } = require('../auth');

// Speech-to-text for the digital survey form's voice-input mic buttons. Deliberately kept
// as its own thin endpoint (one STT call in, {text} out) so swapping providers later only
// ever touches this one file — nothing else in the API or frontend needs to know which
// service actually did the transcription.
//
// Expects 16kHz mono 16-bit PCM WAV audio, base64-encoded. The frontend's VoiceMicButton
// always converts its MediaRecorder capture to this format client-side (via the Web Audio
// API) before sending, specifically so this endpoint never has to guess at or negotiate a
// codec across iOS/Android/desktop browsers — Azure's short-audio REST endpoint accepts
// WAV/PCM unconditionally, unlike the webm/mp4 containers those browsers natively record.
app.http('transcribe', {
  methods: ['POST'],
  route: 'transcribe',
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      requireAuth(request);
      const body = await request.json();
      if (!body.audioBase64) return { status: 400, jsonBody: { error: 'audioBase64 is required' } };

      const speechKey = process.env.SPEECH_KEY;
      const speechRegion = process.env.SPEECH_REGION;
      if (!speechKey || !speechRegion) {
        throw new Error('Speech-to-text is not configured (missing SPEECH_KEY/SPEECH_REGION app settings)');
      }

      const audioBuffer = Buffer.from(body.audioBase64, 'base64');
      const language = body.language || 'en-GB';
      const url = `https://${speechRegion}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${encodeURIComponent(language)}&format=simple`;

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': speechKey,
          'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
          Accept: 'application/json',
        },
        body: audioBuffer,
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Speech-to-text request failed: ${res.status} ${errText}`);
      }

      const result = await res.json();
      // RecognitionStatus "Success" = real speech recognized; "NoMatch" = nothing
      // recognizable was said (silence, too quiet, unintelligible) — both are normal
      // outcomes, not errors, so NoMatch just returns an empty transcript for the frontend
      // to show as "didn't catch that, try again" rather than a hard failure.
      const text = result.RecognitionStatus === 'Success' ? result.DisplayText || '' : '';
      return { jsonBody: { text, status: result.RecognitionStatus } };
    } catch (err) {
      context.error('transcribe failed', err);
      return { status: err.status || 500, jsonBody: { error: err.message } };
    }
  },
});
