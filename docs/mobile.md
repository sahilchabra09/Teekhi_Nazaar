# Contract: Robot Phone App (Kotlin / Android)

**Owner:** Harnoor · **Code:** `mobile/` (Android Studio project), `apps/web/src/lib/rtc/` (laptop-side video hook), `pitch/`
**Depends on:** [interfaces.md](./interfaces.md) · **Overview:** [PLAN.md](./PLAN.md)

The phone sits on the robot and acts as its **eyes, ears and mouth**. It:

1. streams its camera + mic to the laptop,
2. speaks the text the patient chose,
3. listens for people talking and sends their speech upstream,
4. reports motion and bumps from its gyroscope/accelerometer.

> **Android only.** A Kotlin app needs an **Android phone on the robot**. Confirm the team has one at H0.

---

## 1. What you deliver

| # | Feature | Priority | Done when… |
|---|---|:-:|---|
| M1 | **Start screen + permissions**: hub IP field (saved), one big "Start IRIS" button, runtime permissions for camera + mic, screen kept on | P0 | Fresh install → enter IP → Start → everything granted; screen doesn't sleep for 10 min |
| M2 | **Hub connection**: OkHttp WebSocket as `role=phone`, auto-reconnect with backoff | P0 | Hub log shows `phone` connected; kill Wi-Fi for 5 s and it reconnects by itself |
| M3 | **Video + audio → laptop** over WebRTC | P0 | Laptop UI shows phone video within 3 s; wave-a-hand delay < 0.5 s |
| M4 | **Text-to-speech**: speak each `speak` message out loud through the loudspeaker | P0 | `speak` sent from `wscat` is heard in < 1 s; `tts_status` started/finished reaches the hub |
| M5 | **Listening**: VAD → one utterance → WAV → `POST /api/utterance` | P0 | Say "How are you feeling?" near the phone and the web UI shows the transcript |
| M6 | **No self-hearing**: VAD paused while TTS plays (+ 500 ms after) | P0 | The robot never transcribes its own voice |
| M7 | **Motion sensors**: `motion` at ≤ 10 Hz; impact/tilt → `bump` | P1 | Knock the robot and the hub logs `bump` and the robot stops |
| M8 | **Phone screen UI** (faces people near the robot): eyes/face, big caption of what IRIS says, "🎙 Listening" indicator, connection dots, "Tap to talk" button | P1 | Someone standing in front of the robot can read what was said and can see that it's listening |
| M9 | **Laptop webcam → phone screen** (patient's face shown on the robot) | P1 | Patient's face is visible on the phone |
| M10 | **JPEG fallback** if WebRTC fails at the venue (`frame` messages) | P1 | Toggle forces fallback; web shows 5–10 fps video |
| M11 | **STT fallback**: Android `SpeechRecognizer` → send `transcript` text | P2 | Works with the backend STT switched off |
| M12 | **Laptop-side `useRobotStream` hook** (TypeScript, interfaces.md §6) | P0 | Sahil drops it into the UI and video plays |

Plus the **demo and pitch** work (§8).

---

## 2. Stack

| Concern | Use |
|---|---|
| Language / UI | Kotlin + **Jetpack Compose**, single `MainActivity`, `minSdk 26` |
| WebSocket + HTTP upload | **OkHttp** (`WebSocket`, `MultipartBody`) |
| JSON | **kotlinx.serialization** (see §3, it matches our `type` field exactly) |
| WebRTC | **`io.getstream:stream-webrtc-android`** (maintained build of Google's libwebrtc). Check the latest version on Maven Central |
| Text-to-speech | `android.speech.tts.TextToSpeech` + `UtteranceProgressListener` |
| VAD | **Silero VAD for Android** (`com.github.gkonovalov.android-vad:silero` on JitPack) or a simple energy VAD to start |
| Sensors | `SensorManager`: `TYPE_ROTATION_VECTOR`, `TYPE_LINEAR_ACCELERATION`, `TYPE_GYROSCOPE` |
| Video on phone screen (M9) | `SurfaceViewRenderer` wrapped in Compose `AndroidView` |

**A good side effect of going native:** there's no HTTPS headache. A native app can use `ws://` and `http://` to the laptop directly once cleartext is allowed (§6).

### Suggested structure

```
mobile/app/src/main/java/com/iris/robot/
├── MainActivity.kt          // Compose UI, permissions, keep-screen-on
├── Protocol.kt              // @Serializable messages (mirror of interfaces.md)
├── HubClient.kt             // OkHttp WS, reconnect, send(), Flow<Msg>
├── RtcClient.kt             // PeerConnectionFactory, camera capturer, offer/ICE
├── Speaker.kt               // TextToSpeech queue + tts_status
├── Listener.kt              // VAD on mic samples, WAV encode, upload
├── Motion.kt                // sensors → motion / bump
└── RobotViewModel.kt        // wires it all together, exposes UI state
```

---

## 3. Protocol in Kotlin

Mirror `interfaces.md` by hand. kotlinx.serialization uses `"type"` as its default class discriminator, so the sealed class lines up with our JSON:

```kotlin
val json = Json { ignoreUnknownKeys = true; encodeDefaults = true; explicitNulls = false }

@Serializable sealed interface Msg { val ts: Long }

@Serializable @SerialName("hello")
data class Hello(val role: String = "phone", val version: Int = 1, override val ts: Long = now()) : Msg

@Serializable @SerialName("speak")
data class Speak(val speak_id: String, val text: String, val source: String,
                 val audio_url: String? = null, override val ts: Long) : Msg

@Serializable @SerialName("tts_status")
data class TtsStatus(val speak_id: String, val state: String, val error: String? = null,
                     override val ts: Long = now()) : Msg
// …speech_activity, transcript, motion, bump, peer_status, rtc_offer/answer/ice, frame, error
```

Incoming messages with a `type` you don't model should be ignored, not crash the app. Wrap `decodeFromString` in `runCatching`.

---

## 4. Feature details

### M1: Permissions & screen

- **Manifest:** `INTERNET`, `ACCESS_NETWORK_STATE`, `CAMERA`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`.
- **Runtime-requested:** `CAMERA`, `RECORD_AUDIO` (one `RequestMultiplePermissions` launcher on the Start button).
- **Gyroscope/accelerometer need no permission.** (`HIGH_SAMPLING_RATE_SENSORS` only matters above 200 Hz, and we use 10 Hz.)
- Keep screen on with `window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)`. Lock the orientation in the manifest so rotating the phone doesn't recreate the Activity and drop the call.
- Hub IP + port in a text field, saved in `SharedPreferences`. At the venue that's the only thing you change.

### M3: Video/audio → laptop (WebRTC)

```kotlin
val adm = JavaAudioDeviceModule.builder(ctx)
    .setUseHardwareAcousticEchoCanceler(true)
    .setUseHardwareNoiseSuppressor(true)
    .setSamplesReadyCallback { s -> listener.onMicSamples(s.data, s.sampleRate, s.channelCount) } // ← feeds VAD (M5)
    .createAudioDeviceModule()

val factory = PeerConnectionFactory.builder()
    .setAudioDeviceModule(adm)
    .setVideoEncoderFactory(DefaultVideoEncoderFactory(eglBase.eglBaseContext, true, true))
    .setVideoDecoderFactory(DefaultVideoDecoderFactory(eglBase.eglBaseContext))
    .createPeerConnectionFactory()

// Front camera (so camera and screen face the same way)
val enumerator = Camera2Enumerator(ctx)
val front = enumerator.deviceNames.first { enumerator.isFrontFacing(it) }
val capturer = enumerator.createCapturer(front, null)
// SurfaceTextureHelper + factory.createVideoSource(false) → capturer.initialize(...) → startCapture(640, 480, 24)
```

- **The phone is always the offerer:** when `peer_status.web` turns true, create a new `PeerConnection`, add audio + video tracks, `createOffer` → `setLocalDescription` → send `rtc_offer`. Send each `onIceCandidate` as `rtc_ice`. Apply `rtc_answer` / incoming `rtc_ice` from the hub.
- Everything is on the same hotspot, so empty `iceServers` works. Optionally add `stun:stun.l.google.com:19302`.
- Use `SdpSemantics.UNIFIED_PLAN` (browsers expect it).
- 640×480 @ 24 fps. Smooth video matters more than sharp video for steering.
- **Why `setSamplesReadyCallback` matters:** WebRTC owns the microphone. If you also open your own `AudioRecord`, one of them usually gets silence. The callback hands you the same mic audio WebRTC is already capturing, so the VAD runs on it for free.
- **The laptop never sends audio to the phone** (the patient doesn't speak). The phone's speaker plays only TTS.
- **M12, laptop side (TypeScript):** write `useRobotStream(hub)` in `apps/web/src/lib/rtc/`. It answers the phone's offer, handles ICE, and returns the `MediaStream`. Native Android ↔ Chrome WebRTC works fine (VP8/H.264).

### M4: Text-to-speech

```kotlin
tts = TextToSpeech(ctx) { status -> if (status == TextToSpeech.SUCCESS) tts.language = Locale.US }
tts.setAudioAttributes(AudioAttributes.Builder()
    .setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
tts.setSpeechRate(0.95f)
tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
    override fun onStart(id: String)  { listener.pause(); hub.send(TtsStatus(id, "started")) }
    override fun onDone(id: String)   { hub.send(TtsStatus(id, "finished")); listener.resumeAfter(500) }
    override fun onError(id: String)  { hub.send(TtsStatus(id, "error")); listener.resumeAfter(500) }
})

// on Speak message:
showCaption(msg.text)
if (msg.audio_url != null) playWithMediaPlayer(msg.audio_url, msg.speak_id)   // optional premium voice
else tts.speak(msg.text, TextToSpeech.QUEUE_ADD, null, msg.speak_id)          // speak_id = utteranceId
```

- `QUEUE_ADD` means a new message waits until the current one finishes.
- `UtteranceProgressListener` callbacks run on a background thread. Post UI updates to the main thread.
- **Loudspeaker routing:** while a WebRTC call is active, Android switches to communication audio mode, which can send sound to the **earpiece**. Force the loudspeaker (`AudioManager.setCommunicationDevice(...)` on API 31+, `isSpeakerphoneOn = true` on older) and **test the volume in a noisy room**. A small Bluetooth speaker on the robot is the easy fix.

### M5: Listening. Where should speech-to-text run?

**Recommendation: detect speech on the phone, transcribe on the backend.**

| Option | Verdict |
|---|---|
| **A. On-device STT** (Android `SpeechRecognizer`) | ❌ As the main path: it stops after silence, fights WebRTC for the mic, shows system UI/beeps on some phones, and quality varies by device. ✅ Fine as the **fallback** (M11). |
| **B. Stream all audio to the backend continuously** | ❌ Wastes bandwidth and STT cost on silence, and the backend has to do VAD. |
| **C. VAD on the phone → upload one WAV per utterance → backend STT** | ✅ **Use this.** Only real speech is sent, the backend uses a strong Whisper-class model, and the STT can be swapped without rebuilding the APK. The hub can save clips for debugging. |

**How to build C:**

1. Mic samples arrive from `setSamplesReadyCallback` (16-bit PCM, usually 48 kHz; downmix to mono if needed). Downsample to **16 kHz** (take every 3rd sample after a simple average; that's good enough for speech).
2. Keep a **ring buffer of the last ~500 ms**, so the start of a sentence isn't cut off.
3. Feed 512-sample frames into Silero VAD. A simple RMS threshold works for the first version, but a hackathon hall will keep triggering it, so switch to Silero before CP3.
4. Speech starts (VAD true for ~250 ms) → send `speech_activity {active:true}`, start collecting (ring buffer + new samples). The web UI shows "Someone is speaking…", which is the zero-prompt moment.
5. Speech ends (silence for ~700 ms) → wrap the PCM in a 44-byte WAV header → `POST /api/utterance` (OkHttp multipart: `audio`, `utterance_id`, `duration_ms`) → send `speech_activity {active:false}`.
6. Drop clips under 400 ms. Cap clips at 15 s.
7. **M6:** `listener.pause()` on TTS `onStart`, resume 500 ms after `onDone`. Otherwise IRIS answers itself.
8. **Noise backup for the demo:** a large "Tap to talk" button on the phone screen. Tap = start recording, tap again = send. Use it if the hall is too loud for the VAD.

### M7: Gyroscope / motion

```kotlin
sensorManager.registerListener(this, rotationVector, SensorManager.SENSOR_DELAY_GAME)
sensorManager.registerListener(this, linearAccel,    SensorManager.SENSOR_DELAY_GAME)
// rotation vector → SensorManager.getRotationMatrixFromVector → getOrientation → alpha/beta/gamma in degrees
```

- Send `motion` at **≤ 10 Hz**. Throttle it, because the sensors fire much faster.
- `bump {kind:"impact"}` when linear acceleration magnitude jumps sharply (start at more than 15 m/s² and tune it on the real robot; motor vibration causes false positives).
- `bump {kind:"tilt"}` when the phone tilts more than 35° from the resting angle recorded at Start.
- Unregister in `onPause` and re-register in `onResume`.
- Later ideas: heading/compass in the web UI, turn-angle feedback.

### M8: Phone screen layout (the people near the robot see this)

```
┌──────────────────────────┐
│ ● hub  ● video  🎙 Listening│  ← small status row
│                          │
│    [patient face video]  │  ← M9 (SurfaceViewRenderer); until then animated "IRIS eyes"
│    or animated eyes      │
│                          │
│  "I'm okay, thank you."  │  ← big caption of the last thing IRIS said
│                          │
│     [ Tap to talk ]      │  ← noise backup (M5.8)
└──────────────────────────┘
```

Keep it dark-background and high contrast. The visible "Listening" indicator matters for the ethics story too (idea.md §11, consent).

### M10: JPEG fallback

Add a `VideoSink` to the local video track. Every 100–200 ms, take the `VideoFrame` → `toI420()` → NV21 → `YuvImage.compressToJpeg(quality 60)` → base64 → send as a `frame` message. `useRobotStream` switches to `state:"fallback"`. Build this only if WebRTC is flaky by H8. Have the toggle ready either way.

---

## 5. What you depend on and how to test without it

| You need | From | Until it's ready |
|---|---|---|
| Hub WebSocket + `/api/utterance` | Sahil | Sahil ships the hub relay by H2.5. Before that, run `bunx wscat -l 3000` on the laptop and point the app at it |
| Someone sending `speak` | Sahil's web UI | Send it by hand from `wscat` |
| Someone answering the WebRTC offer | your own `useRobotStream` | Put a bare test page in the web app (e.g. `/robot-viewer`) that uses the hook and plays the video |
| Robot mount | Arunya | Tape the phone to a box |

The emulator is fine for the WebSocket/TTS/protocol work. Use the **real phone** for camera, mic, sensors and loudness.

---

## 6. Gotchas

- **Cleartext is blocked by default** (Android 9+). Add `android:usesCleartextTraffic="true"` to `<application>` (or a network-security-config allowing the hotspot IP), otherwise `ws://` and `http://` silently fail.
- **First Gradle sync + WebRTC download is slow.** Start the Android Studio project at **H0**, not H2.
- **Phone and laptop must be on the same hotspot**, and the laptop firewall must allow port 3000.
- **Don't leave the app during the demo.** If it goes to the background, Android may cut the camera/mic. Turn on Do Not Disturb, disable battery optimisation for the app, and keep it in the foreground. (A foreground service is P2.)
- **Battery:** streaming video drains it fast. Keep a power bank on the robot and start the demo at 100%.
- **Mounting:** vibration blurs video, so the phone needs a firm mount. Keep the speaker uncovered. Keep the mic away from the motors.
- **Release resources** (`capturer.stopCapture()`, `peerConnection.dispose()`, `tts.shutdown()`) on destroy, or the camera stays locked until reboot.
- **Venue noise** is the biggest risk for M5. Test early with a crowd-noise video playing nearby.
- Keep a **signed debug APK** on the laptop so the app can be reinstalled quickly if anything goes wrong.

---

## 7. Milestones

| By | Target |
|---|---|
| H0–H1 | Android Studio project created, Gradle synced with all dependencies; `Protocol.kt` from `interfaces.md` |
| H2.5 | Start screen, permissions, OkHttp WS connected to hub (**CP1**) |
| H5 | WebRTC video live in the laptop UI through `useRobotStream`; TTS speaks `speak` messages (**CP2**) |
| H8 | VAD + WAV upload + mute-while-speaking; motion + bump (**CP3**). **Then help whoever is behind.** |
| H11 | Reconnect tested; JPEG fallback ready; phone screen UI; **backup demo video recorded** (**CP4**) |
| H13 | Feature freeze → deck + metrics |

---

## 8. Acceptance checklist (run before CP4)

- [ ] Fresh install → enter IP → Start → everything works
- [ ] Video on the laptop, delay under 0.5 s
- [ ] `speak` from the UI is heard **on the loudspeaker** at the venue's noise level; caption shows; `tts_status` arrives
- [ ] Someone asks a question → transcript + cards on the laptop in under 3 s total
- [ ] IRIS speaking does **not** trigger a new utterance
- [ ] Knock → `bump` → robot stops
- [ ] Wi-Fi off for 5 s → recovers on its own (WS + WebRTC)
- [ ] 10 minutes running: screen on, no overheating, video still live

---

## 9. Demo & pitch (H11 onward)

You own these because by then your code touches every part of the system.

- **Backup demo video** at H11: record one clean end-to-end run (screen recording of the laptop plus a phone video of the robot).
- **Metrics** (idea.md §10): gaze selection accuracy (with Arunya), speech-to-cards latency (from Sahil's logs), safety stop time, navigation success rate. Write down the real numbers; don't estimate.
- **Deck** in `pitch/`: problem → demo → architecture diagram (PLAN.md §2) → PS-02 fit table (idea.md §3) → metrics → ethics → future.
- **Demo script:** who plays the patient, who plays the friend, and the exact sentences to say (pick ones that get good suggestions; test them).
- Run the 3 rehearsals from H13.
