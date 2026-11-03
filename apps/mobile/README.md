# IRIS Android robot app

Native Kotlin / Jetpack Compose implementation of [mobile.md](../../docs/mobile.md), with the phone-side MQTT controller from [robot-operation.md](../../docs/robot-operation.md). Its mint, pine, teal, honey and sky palette, softly shaded cards and raised buttons match the main frontend's clay styling. The Android Studio project lives here.

## Build and install

Requires JDK **21**, Android SDK platform **35**, build tools **35.0.0**, and an Android **8.0+** device. Open **this directory** in Android Studio, sync Gradle, and run the `app` configuration. Set `ANDROID_HOME` or create an ignored `local.properties` containing `sdk.dir=...` if Studio has not configured the SDK.

On Windows, from the repository root:

```powershell
./apps/mobile/tools/build.ps1
adb install -r ./apps/mobile/app/build/outputs/apk/debug/app-debug.apk
```

The build script uses local `.tooling/` caches and a short temporary path to avoid a Windows Java socket-path issue. It also detects the workspace-local SDK if one is present. On macOS/Linux:

```sh
cd apps/mobile
chmod +x gradlew
./gradlew :core:test :app:assembleDebug :app:lintDebug
```

The debug APK is signed automatically for local installation. Credentials, SDK paths, caches, signing files and APKs are ignored by Git. A release intended for distribution needs your own signing configuration.

## First run

1. Run the API and frontend from the repository root, in separate terminals: `bun run --cwd apps/server dev` and `bun run --cwd apps/web dev`. Keep server credentials in ignored `apps/server/.env`; set `NEXT_PUBLIC_SERVER_URL=http://localhost:3000` in ignored `apps/web/.env.local`. The API's `CORS_ORIGIN` must be `http://localhost:3001` for this setup.
2. Connect the phone to the laptop's hotspot. The API listens on `0.0.0.0:3000`; allow inbound TCP 3000 if the firewall blocks it. Open `http://<laptop IP>:3000/health` in the phone browser to confirm reachability. On the current Windows hotspot, the laptop address is commonly `192.168.137.1`; check `ipconfig` if it changes.
3. On the laptop, open `http://localhost:3001/`, sign in with **Google or email**, and click **Link phone**. This generates a 12-character code that expires in five minutes and can be used once.
4. On Android, enter the **laptop backend address**, such as `192.168.137.1:3000`, and the code. For this private-hotspot HTTP test, explicitly enable **Allow HTTP on my private laptop hotspot**. Use HTTPS for deployment. Tap **Link my account** and check the displayed email matches the laptop account. `localhost` on the phone refers to the phone itself.
5. Tap **Start IRIS** and grant camera/microphone access. On the laptop, click **Connect phone** and allow camera access. Both sides use the real API on port 3000. The web console shows the phone camera; its **Your camera → phone** preview is displayed on the phone. Click **Enable audio** to hear received phone audio.
6. In the console, select **Say something**, choose a phrase, and confirm **Speak it**. Verify the phone speaks and the console waits for matching `tts_status`. Android STT can send real transcripts from phone Controls; server-side WAV transcription and AI suggestions are still unconfigured and return an explicit 501 rather than fake replies.

The app stops and releases camera, microphone, sensors and robot control when its Activity pauses. Return and tap Start to resume. Hub reconnects while the app remains active; motor control always needs a new explicit Enable after faults/reconnects.

The active phone screen prioritizes the **frontend camera**, with captions and Tap to talk below it. Before frames arrive, or if they stop arriving, it shows an explicit waiting/connection message. Open **Controls** for fallbacks, robot pairing/calibration/session actions, and End session. Robot STOP remains accessible at the top of the main screen when the controller is configured. The frontend camera needs WebRTC; JPEG/Android STT fallback modes currently support only robot-to-frontend video.

## Account linking and sign-out

The phone uses the exact Better Auth account already signed in on the laptop. The one-time code is a device sign-in flow, so Google users do not need a separate password on Android. The API determines the user identity; role labels and client-supplied user IDs cannot select another account's media room. One phone and one console can connect per account; another connection replaces the old role.

The phone credential is stored in Android Keystore-encrypted settings. It expires after at most 24 hours and depends on the originating laptop session remaining valid. **Sign out** on the laptop revokes that link; active sockets revalidate at least every 15 seconds. **Sign out** on the phone revokes its credential and clears local credentials without logging out the laptop. **End session** releases camera/microphone while preserving the account link.

Pairing state is intentionally in memory for this single-process API: restarting it requires a new code. A deployment with multiple workers needs a shared expiring store with atomic code/ticket consumption. Browser WebSockets use a single-use 30-second ticket; the native socket uses an Authorization header. Long-lived phone credentials are never placed in socket URLs.

`tools/dev-hub.ts` remains an isolated, unauthenticated protocol-test fixture for Bun tests. The app's account flow and main frontend do not use it. `NEXT_PUBLIC_ROBOT_HUB_URL` and the editable media-hub field have been removed. No mock frontend is installed.

## Robot pairing and control

After account linking, enable **Connect ESP robot controller** on setup and enter the ESP's current control password, broker URL and optional broker credentials. The account credential is attached automatically to session requests. Settings are encrypted with an Android Keystore AES-GCM key; backup is disabled. No control grant or cached movement is persisted. Account linking authorizes media only: `/api/mobile/session` returns 501 until robot ownership and MQTT publishing are configured, so driving remains disarmed.

Use the current ESP's exact topics and envelope:

- Subscribe `teekhi-nazaar/esp12e_carbot/intent` for typed intentions and `carbot/status` for full status.
- Publish wheel output to `carbot/command` with `source:"lain-mobile"`, `phone_control:true`, `device_id:"esp12e_carbot"`, explicit `armed`, integer signed `left`/`right`, and the ESP password.
- Drive output is QoS 0 every 100 ms. Stop/disarm is QoS 1. Nothing is retained; sessions are clean and movement is never queued for reconnect.

Mount in **portrait, phone top up, screen facing robot forward**. With the robot stationary, tap **Calibrate**, then **Fetch session**. Wait for fresh full ESP status and an authorized grant, then explicitly **Enable driving**. Forward/reverse hold the entry heading; turns use yaw-rate feedback; renewing a held direction preserves its heading target. STOP, speed zero, tilt/impact, stale sensors/status/intention, broker loss, session loss and app inactivity disarm. STOP requires explicit enable before subsequent movement.

Rotation-vector and gyro readings must both be fresh (250 ms); ESP full status expires after six seconds. Intentions expire after at most 300 ms, checked on a 100 ms loop. The ESP independently stops its phone branch after more than 500 ms without accepted output. These are software settings, not measured physical stop times. The initial gains and impact threshold need chassis testing with wheels raised; verify motor/yaw signs, correction in reverse, loudness and mounting before floor use. There is no obstacle/edge sensing in the current firmware.

The default public broker matches the existing firmware's bench configuration. Phone WSS does not encrypt the ESP's separate plaintext MQTT connection. A protected deployment requires a private authenticated broker, per-role topic ACLs, and coordinated ESP TLS changes as described in the robot guide.

## Media behavior

- 640×480 at 24 fps; phone is always the WebRTC offerer. The console sends `media_ready` after installing its signaling listeners; the phone creates a fresh peer for this request. Legacy `peer_status` startup is also supported. No STUN is needed on the shared LAN. Remote networks need a separately agreed ICE/TURN configuration.
- Silero VAD processes 512-sample frames from WebRTC's audio callback, off the real-time audio thread. Audio is downmixed/downsampled to 16 kHz PCM. It keeps roughly 500 ms of preroll, starts after 256 ms of speech, ends after 704 ms of silence, rejects clips below 400 ms and caps clips at 15 seconds.
- While no WebRTC call owns the mic (including JPEG mode), one `AudioRecord` supplies the same listener. It is stopped and released before a WebRTC peer starts. This allows listening before a laptop connects.
- Incoming speech is queued and deduplicated by `speak_id`. TTS and optional `audio_url` playback both pause listening **before** playback/preparation, across the queue, and until 500 ms after the last item.
- **JPEG fallback video** sends a throttled, rotated JPEG about every 150 ms, with backpressure. WebRTC failures select JPEG automatically; use **Retry WebRTC** to retry.
- **Android STT fallback** is explicit tap-to-recognize. It closes WebRTC audio and releases `AudioRecord` before opening the Android recognizer; video uses JPEG during this mode. Device recognition availability/network requirements vary.
- Frontend camera video is the phone's main display. Sharing is enabled by default in the viewer and begins after Connect and browser permission. The browser hook reuses only the caller's webcam video track, never the laptop mic, and does not stop caller-owned tracks on cleanup.

## Backend and web handoff

See [backend-integration.md](docs/backend-integration.md) for implemented account/media routes and the remaining controller lease and speech-service contracts. Media/speech messages retain the shared `interfaces.md` contract.

## Verification

```powershell
./apps/mobile/tools/build.ps1
bun run --cwd apps/mobile test
bun run --cwd apps/mobile check-types
bun run --cwd apps/web check-types
bun run --cwd apps/web test
bun run --cwd apps/server test
bun run --cwd apps/server check-types
```

`core` contains JVM tests for clock/freshness, session/target validation, duplicate suppression, heading control, stop/disarm behavior, audio resampling, utterance boundaries and protocol handling. Bun tests exercise the mock's real WebSockets/HTTP and the browser's negotiation/cleanup state machine. These checks do not replace device tests.

Run the [device acceptance checklist](docs/device-acceptance.md) before the demo. Video latency, acoustic echo, noise robustness, motor direction, stop latency, thermal behavior, and Android/OEM audio routing remain physical-device checks; no measurements are fabricated.
