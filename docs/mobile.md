# Mounted Android app contract

**Owner:** Harnoor · **Code:** `apps/mobile/` (Android Studio project), `apps/web/src/lib/rtc/` (laptop-side video hook), `pitch/`
**Depends on:** [interfaces.md](./interfaces.md) · **Overview:** [PLAN.md](./PLAN.md)

The phone is fixed to the robot chassis and owns the local movement controller. It receives MQTT intentions from frontend/backend, uses its orientation and gyro feedback to calculate signed wheel effort, and publishes the existing ESP8266 envelope. It also connects to the backend over WebSocket for session/conversation/media events and provides the camera, microphone, and speaker for telepresence. The Kotlin app and account-authenticated media relay are implemented; the configured owner’s paired console and phone receive a short-lived drive grant. Physical-device acceptance requires the mounted hardware.

Use [robot operation](robot-operation.md) for calibration, correction math, timing, and password handling; [shared interfaces](interfaces.md) for application event routing; and [MQTT commands](mqtt.md) for ESP fields.

**Implementation:** [Android setup and behavior](../apps/mobile/README.md) · [backend handoff](../apps/mobile/docs/backend-integration.md) · [physical-device acceptance](../apps/mobile/docs/device-acceptance.md). The phone uses the frontend's clay palette and raised cards/buttons. Its primary display shows the **frontend webcam**; until live frames arrive it shows a waiting state. **Continue with Google** on both devices using the same email. Android opens the external browser and returns to IRIS; verified account IDs determine media rooms automatically. No OTP or manual laptop-linking step is needed. Session controls live in a Controls panel. The owner’s paired console publishes signed drive intentions under a short-lived controller lease.

> **Android only.** A Kotlin app needs an **Android phone on the robot**. Confirm the team has one at H0.

## Setup and connection

Provide settings for the shared auth/media backend URL, MQTT broker address/transport, target robot, session access, and the ESP control password. Obtain scoped broker credentials and a trusted active-session grant from the backend. Store credentials in Android Keystore-encrypted settings, not application logs, source, or Topic 1. The media-upload endpoint uses the same authenticated API as account linking and signaling.

Connect to the authenticated backend WebSocket as `role=phone` for application/session events. Separately connect to MQTT Topic 1 (`teekhi-nazaar/esp12e_carbot/intent`), Topic 2 (`carbot/command`), and ESP status (`carbot/status`). Validate application inputs by type, target, session, and freshness; check the ESP device ID and age on its status messages. Ignore unknown events and the phone's own status echoes. WebSocket events never bypass the MQTT movement translator. Preserve `source:"lain-mobile"` on motor envelopes because the firmware uses that literal to select its phone timeout.

On startup request needed camera/microphone permissions from a user action, secure the mount, and calibrate orientation while stationary. Keep the phone in its intended mount frame. Driving stays disabled until readiness and explicit enable; reconnect, app inactivity, calibration loss, or control faults return to disarmed state.

## Local movement controller

| Input | Phone behavior |
| --- | --- |
| Forward/backward intention | Capture heading on direction entry; use positive/negative base effort and local heading correction. Renewed unchanged intentions preserve the target. |
| Left/right intention | Turn in place while the intention remains fresh; use gyro feedback to regulate the requested turn. Do not fight the turn by holding the old heading. |
| Stop or speed zero | Cancel movement and correction, publish zero wheels and `armed:false`. |
| Expired intention or lost session | Stop/disarm even while MQTT and the ESP remain online. |
| Stale/unavailable orientation | Stop and require restored readiness. Do not continue the old output. |

The phone samples calibrated/fused orientation locally more frequently than its 100 ms wheel publication. A gyro measures angular rate; it is not a heading angle. Map device axes into robot axes and normalize units. Pitch/roll are chassis tilt, not independent throttle commands. Use the example calculation and forward/reverse sign conventions in [robot operation](robot-operation.md#translating-intentions-with-phone-orientation), then tune on the real mount.

Topic 1 intentions renew about every 100 ms with proposed 300 ms validity. Publish fresh Topic 2 wheel values every 100 ms, QoS 0, `retain=false`; send explicit stop/disarm with QoS 1 and `retain=false`. The ESP's existing phone branch stops after more than 500 ms without an accepted drive command or on detected broker/Wi-Fi loss. Plain firmware commands bypass that timeout, so this app always uses the documented envelope.

When a required backend/session connection is lost, disarm and require renewed readiness before driving again. MQTT broker connectivity and backend WebSocket connectivity are separate states. Do not queue drive packets for reconnect. An expired frontend command must not remain alive through a healthy phone-to-ESP heartbeat. Keep this controller independent of speech, camera, or media processing.

## Status and faults

Consume full ESP status, published every two seconds, and expire it locally. Publish typed `mobile_status` on Topic 1 with the latest accepted command ID, readiness, current/target heading, and output wheel effort. A broker acknowledgement or phone status does not prove physical execution. The ESP does not publish obstacle-distance fields or an offline Last Will.

Optional bump/tilt detection is a phone fault policy to be tuned against actual vibration; if it fires, disarm locally before notifying frontend/backend. It is not an IR edge or ultrasonic obstacle detector. Releasing camera/sensor resources or entering the background must also cancel driving.

## Camera audio and speech

Use Kotlin and platform facilities for permissions, calibrated motion sensors, credential storage, lifecycle handling, and TTS. Use separate MQTT and WebSocket clients with explicit connection/session state. The MQTT client handles movement topics; the WebSocket client handles backend application events. Provider/library selection must not alter the agreed message contract.

WebRTC carries live camera/microphone streams, with `media_ready`, `rtc_offer`, `rtc_answer`, and `rtc_ice` relayed by the backend WebSocket hub. The phone creates the offer; the browser media hook uses the same authenticated hub adapter. Create a fresh media session after reconnect. Share microphone samples between streaming and VAD where possible; avoid opening competing microphone captures.

Phone speech starts only after the signed-in patient approves a request in **Communicate → Listen and reply**. The phone can end its approved turn with **Stop microphone**, and choosing **Drive** cancels the turn. The phone plays confirmed replies and reports TTS completion. See the [current speech workflow](./speech-workflow.md).

Accept `speak` only from the authorized session, deduplicate by `speak_id`, show a caption, speak on the robot loudspeaker, and publish matching `tts_status`. Suggestions alone never trigger speech. Verify volume, echo handling, permissions, battery use, and lifecycle behavior on a real mounted phone.

Do not send continuous media frames on the motor or intention channels. On media failure, expose an unavailable state and preserve independent stop behavior; media fallback transport requires a separate agreed design.

## Implementation structure and handoff

Keep MQTT movement transport, WebSocket application transport, protocol validation, session state, orientation calibration, motor translation, media, listening, and TTS in separate components with clear responsibilities. Start with a simulated motor output sink that does not publish to a real ESP. The emulator can exercise parsing and app flow; the real phone is needed for mount calibration, gyro sign checks, camera, mic, and loudness.

Acceptance covers all four movements and STOP; heading disturbance in forward/reverse; intention expiry while the broker stays healthy; device/session mismatch; duplicate messages; stale ESP/orientation data; backgrounding; and reconnect without resuming motion. Test confirmed speech and media independently of driving. Record measured latency and stopping behavior for the demo rather than claiming an unverified guarantee.
