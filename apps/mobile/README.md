# IRIS Android robot app

Native Kotlin / Jetpack Compose implementation of [mobile.md](../../docs/mobile.md), with the phone-side MQTT controller from [robot-operation.md](../../docs/robot-operation.md). The Android Studio project lives here, rather than the older `mobile/` path mentioned in the team plan.

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

1. Put laptop and phone on the same hotspot. Allow inbound TCP port 3000 on the laptop.
2. Enter the **laptop's LAN IP**, such as `192.168.1.10:3000`. `localhost` on a phone refers to the phone itself. Explicit `http://`, `https://`, `ws://` and `wss://` URLs are supported.
3. Tap **Start IRIS** and grant camera/microphone permissions. The foreground screen stays awake.
4. Sign in to the main web console at `/`. Enter the matching **Media hub** address and click **Connect phone**, then allow laptop camera access. The main web feed shows the phone camera; the small **Your camera → phone** preview is what the mounted phone displays. Received robot audio starts muted; click **Enable audio** when wanted. Use one connected console tab because the hub permits one web role.
5. Say a sentence or use **Tap to talk** (tap again to send). Transcripts and suggestions from the hub appear in the console. Choose a quick phrase or suggestion, then **Speak it**; the console waits for the matching phone `tts_status` before completing the speaking view.

The app stops and releases camera, microphone, sensors and robot control when its Activity pauses. Return and tap Start to resume. Hub reconnects while the app remains active; motor control always needs a new explicit Enable after faults/reconnects.

The active phone screen prioritizes the **frontend camera**, with captions and Tap to talk below it. Before frames arrive, or if they stop arriving, it shows an explicit waiting/connection message. Open **Controls** for fallbacks, robot pairing/calibration/session actions, and End session. Robot STOP remains accessible at the top of the main screen when the controller is configured. The frontend camera needs WebRTC; JPEG/Android STT fallback modes currently support only robot-to-frontend video.

## Test before the backend is ready

The production server currently provides authentication, but does not yet provide the media hub/STT endpoints. For the main console, keep that auth server running on port 3000 with its configured database. Run this independent mock on **3002** so it does not collide with login:

```powershell
$env:PORT = "3002"
bun run --cwd apps/mobile dev:hub
# In another terminal:
$env:NEXT_PUBLIC_ROBOT_HUB_URL = "http://localhost:3002"
bun run --cwd apps/web dev
```

Open `http://localhost:3001/`, sign in normally, and connect its **Media hub** to `http://localhost:3002`. Set the phone hub to the laptop LAN address on **3002** (for the Windows hotspot, commonly `192.168.137.1:3002`). Allow that port through the laptop firewall. Authentication still uses `NEXT_PUBLIC_SERVER_URL`; the media setting does not replace it. The console also saves the chosen media address locally.

The development hub handles one socket per role, `media_ready`, signaling, speech events and WAV uploads. Returned transcripts are explicitly prefixed **[MOCK]**; it has no real transcription or LLM. Use the main authenticated console for frontend checks. The console's Driving card reports unavailable until a real authorized MQTT publisher/session is connected; media does not arm driving.

Mock session grants are disabled by default. For controller bench testing only, set `ENABLE_BENCH_SESSION=1` and `MOCK_SESSION_TOKEN` in that terminal before starting the mock. Enter the same token on the phone and explicitly enable private-LAN session HTTP. The mock grants a ten-second renewable bench session; it **never publishes drive intentions**. A real backend must implement ownership and authentication before driving outside the bench setup.

## Robot pairing and control

Enable **Connect ESP robot controller** on setup, enter the ESP's current control password, broker URL, optional broker credentials, and backend token. Settings are encrypted with an Android Keystore AES-GCM key; backup is disabled. No control grant or cached movement is persisted.

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

See [backend-integration.md](docs/backend-integration.md) for exact routes, authorization lease shape, failure behavior and hook usage. Media/speech messages retain the shared `interfaces.md` contract. The new controller lease endpoint and optional revocation message are proposed integration additions, not endpoints already available in `apps/server`.

## Verification

```powershell
./apps/mobile/tools/build.ps1
bun run --cwd apps/mobile test
bun run --cwd apps/mobile check-types
bun run --cwd apps/web check-types
```

`core` contains JVM tests for clock/freshness, session/target validation, duplicate suppression, heading control, stop/disarm behavior, audio resampling, utterance boundaries and protocol handling. Bun tests exercise the mock's real WebSockets/HTTP and the browser's negotiation/cleanup state machine. These checks do not replace device tests.

Run the [device acceptance checklist](docs/device-acceptance.md) before the demo. Video latency, acoustic echo, noise robustness, motor direction, stop latency, thermal behavior, and Android/OEM audio routing remain physical-device checks; no measurements are fabricated.
