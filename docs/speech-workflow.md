# Deepgram phone speech (IRIS 0.7.0)

The default Android flow streams 16 kHz mono PCM through the authenticated `/api/mobile/speech` server WebSocket. Deepgram Nova-3 provides transcription and speech activity detection (`vad_events=true`); endpointing and utterance-end detection use a 1.6-second pause. Only finalized transcripts with confidence at least 0.55 enter the existing reply service. Interim results never generate replies. The console can still explicitly start, stop or cancel capture.

Confirmed speech is synthesized with Deepgram Aura-2 Thalia through authenticated `POST /api/mobile/tts`, then played on the phone as 24 kHz WAV. Capture pauses during synthesis and playback and resumes after an echo settling delay. Errors are visible on the phone and reported through the existing TTS status protocol.

Set `DEEPGRAM_API_KEY` only in the ignored `apps/server/.env`. Optional model overrides are `DEEPGRAM_STT_MODEL` (default `nova-3`) and `DEEPGRAM_TTS_MODEL` (default `aura-2-thalia-en`). The key is never bundled into the APK. Reply generation still requires the configured AutoSage/OpenRouter provider. Android recognition remains an explicit fallback; the default flow uses Deepgram.

Restart the API, install the rebuilt APK, sign in with the same patient account as the console, and start IRIS. Check automatic speech detection, pause mid-sentence, confirm a suggested reply, and verify the phone does not transcribe its own playback. Also check cancellation, network loss, and session expiration on a real handset. Cloud audio requires a working server connection.

Provider references: [Deepgram endpointing](https://developers.deepgram.com/docs/endpointing/) and [TTS WAV container](https://developers.deepgram.com/docs/tts-container).

The sections below describe earlier releases and are retained as historical context.

# Automatic phone speech (IRIS 0.6.2)

Starting a phone session enables continuous Silero VAD. There is no Tap to talk / Tap to send button. After 256 ms of sustained detected speech, IRIS captures an utterance with preroll and ends after 1.6 seconds of silence (15-second maximum). Upload requires at least 480 ms classified as speech and a 30% voiced fraction before the trailing silence. Brief sounds and rejected clips stay on-device. Capture pauses while the server processes a clip and while IRIS speaks, preventing overlapping uploads and self-hearing.

The console's Say something still requests phone capture through the same pipeline. With no connected phone, it records the selected laptop microphone. Backend near-silence and low-confidence checks still run before reply generation.

VAD identifies likely speech, not sentence meaning. Speech-like noise can pass it, and a grammatically plausible mistranscription can still be wrong. Semantic validation before upload would require an on-device transcription/language model; that is not included in this APK. Check the transcript shown by the console before confirming a reply.

## Earlier integration details

# Shared speech workflow (IRIS 0.6.1)

With the phone connected, both **Tap to talk / Tap to send** on Android and **Say something** in the console record the phone microphone. The former starts/stops manually; the latter sends an account-scoped `listen` message and stops after speech and 1.6 seconds of silence (or **They're done**). Only when no phone is connected does the console use its selected laptop microphone, labelled in the footer.

Phone audio goes to authenticated `POST /api/utterance`. The gateway verifies the native credential, then invokes the same `/api/talk/utterance` handler as browser recordings, using the phone's server-held Google session. The Talk routes retain patient-role and conversation-ownership checks. Both use the same configured OpenRouter transcription and AutoSage/OpenRouter reply providers. The result is returned to the phone and delivered as `talk_result` to the same account's console. Restart both web and API and install the updated APK together.

**Phone speech recognition** remains an optional Android fallback. It posts the recognized text and confidence through the same native bridge into `/api/talk/transcript` and the same conversation/reply service. This mode continues to use compatibility video, because Android recognition needs exclusive microphone ownership. Normal phone WAV recording no longer needs this switch. English recognition is currently selected for Android's fallback.

During an active session, sustained speech triggers uploads automatically. Short/no-speech captures produce a retry state; provider failures remain visible; known low-confidence transcripts are rejected before being added to history or generating replies. A provider that supplies no confidence cannot establish transcription accuracy, and a plausible wrong transcript still requires the listener to check the displayed words. Suggestions flagged as unclear offer repeat/ignore actions rather than presenting substantive answers.

Cancellation retires the console capture ID so delayed results cannot reopen a canceled recording. A disconnect ends the pending console capture. Phone media/microphone ownership and TTS playback suppression continue to apply.

## Verify on hardware

1. Run API on 3000 and web on 3001. Configure `OPENROUTER_API_KEY` and real STT model IDs in the server environment; retain the Google/database configuration. Use the USB forwarding or reachable HTTPS setup in `google.md`.
2. Sign in on both devices with the same patient account, start the phone session, then **Connect phone** on the console. Leave **Phone speech recognition** off for normal WAV capture.
3. Speak beside the phone: **Tap to talk**, say "Would you like a glass of water?", then **Tap to send**. Verify the displayed transcript and three replies; confirm one and hear it on the phone.
4. Select **Say something** on the console and repeat beside the phone while staying away from the laptop mic. Verify the same words and reply flow. Pause briefly mid-sentence; use **They're done** to end explicitly.
5. Cancel during recording/processing and check that delayed results do not reopen it. Disconnect the phone, verify the footer shows the laptop mic picker, and repeat using that mic.
6. Enable Android recognition and repeat both entry points. Verify low-confidence/no-speech/provider-error states and second-account isolation. Accuracy, echo, background noise and OEM recognition behavior require real handset testing.
