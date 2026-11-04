# IRIS shared communication interfaces

Movement uses MQTT: frontend/backend publish intentions on Topic 1, and the mounted phone uses gyro feedback to publish ESP wheel commands on Topic 2. Other application traffic uses WebSocket between frontend and backend, and between backend and phone. The backend relays conversation and media signalling; it does not relay movement over WebSocket or connect the ESP as a WebSocket peer.

The detailed control contract is [robot operation](robot-operation.md); exact firmware fields and behavior are in [MQTT commands](mqtt.md). See [console controls](controls.md) for the implemented signed drive message, gaze dwell behavior and appliance topics. The firmware in `bot/` already implements its documented command/status interface.

## Connections and topics

| Connection | Transport | Traffic |
| --- | --- | --- |
| Frontend ↔ backend | WebSocket, WSS for deployment | Authenticated session coordination, conversation/UI events, and media signalling. |
| Backend ↔ mounted phone | WebSocket, WSS for deployment | Session readiness, speech/TTS events, and media signalling. |
| Frontend/backend → phone | MQTT Topic 1 | `drive_intent`; phone returns movement `mobile_status` on the same topic. |
| Phone ↔ ESP8266 | MQTT command/status topics | Signed wheels and current ESP output. |

The backend hub uses `/ws?role=web` for the frontend and `/ws?role=phone` for the phone. Local development may use `ws://localhost:3000/ws?role=web` in the laptop browser and the configured backend LAN address for the phone. Use authenticated `wss://` connections in deployment. Role query values identify routing intent, not identity or permissions; the server binds each connection to an authenticated device/session. The active owner’s authenticated peers receive the drive grant separately from MQTT.

| Channel | Topic | Publishers and subscribers |
| --- | --- | --- |
| Topic 1 application channel | `teekhi-nazaar/esp12e_carbot/intent` | Frontend/backend publish authorized `drive_intent`; phone subscribes. Phone publishes `mobile_status`; frontend/backend subscribe. Conversation and media events below use the backend WebSocket hub. |
| Topic 2 motor commands | `carbot/command` | Only the mounted phone normally publishes; ESP8266 subscribes. |
| ESP output status | `carbot/status` | ESP8266 publishes; phone subscribes and relays relevant state as `mobile_status`. |

Current ESP broker: `broker.emqx.io:1883`. The frontend's MQTT client uses `wss://broker.emqx.io:8084/mqtt`, which is separate from its backend WebSocket connection. Movement messages follow MQTT publish/subscribe; other application messages follow the backend WebSocket routes. Protected deployments require a private authenticated broker, TLS on every connection, and topic permissions; see [password and transport security](robot-operation.md#password-process-and-protection-against-interception).

WebSocket and gRPC are different protocols. This contract retains WebSocket for the two application links, matching the application hub. Choosing gRPC later would require an agreed service schema and compatible server/browser/phone clients; it would not replace either movement MQTT topic. See the [WebSocket standard](https://www.rfc-editor.org/rfc/rfc6455) and [gRPC concepts](https://grpc.io/docs/what-is-grpc/core-concepts/).

The backend coordinates one active controller per robot. Each subscriber filters by `type`, target `device_id`, active session, and relevant message ID. The `type` field routes application messages; it is not proof of sender identity. Unknown types and reflected status messages never enter the movement translator.

## Movement and status

Use the exact `drive_intent` and `mobile_status` shapes in [robot operation](robot-operation.md#mqtt-channels-and-message-contracts). Movement actions are `forward`, `backward`, `left`, `right`, and `stop`, with speed 0–100. Stop is `type:"drive_intent", action:"stop"`, not a separate firmware command type.

The phone publishes the existing timeout-enabled envelope to Topic 2, including `password`, `source:"lain-mobile"`, `device_id:"esp12e_carbot"`, `phone_control:true`, explicit `armed`, and integer `left`/`right` values from -100 to +100. `cmd` is a direction label; wheel values drive the motors. The source string is a firmware compatibility marker. Credentials stay local and are never included on Topic 1.

| Rule | Owner and behavior |
| --- | --- |
| Held intention | Frontend/backend renew every 100 ms with fresh IDs/sequences/time; proposed validity is 300 ms. |
| Heading correction | Phone retains the target heading while the same direction is held and uses calibrated orientation feedback. |
| Wheel publication | Phone sends latest wheel values every 100 ms, QoS 0, `retain=false`. |
| Explicit stop | Phone sends `armed:false`, `left:0`, `right:0`, QoS 1, `retain=false`. |
| Upstream expiry or invalid readiness | Phone disarms and stops publishing drive commands; keeping the old intention alive is forbidden. |
| Missing phone commands | Existing ESP stops active phone control after more than 500 ms, or on detected MQTT/Wi-Fi loss. Plain commands do not have this timeout. |
| Reconnect | Remain disarmed; discard queued movement and require fresh readiness and explicit enable. |
| ESP status | Full output status every two seconds; expire stale status locally. There is no per-command execution acknowledgement. |

Sequence, session, and expiry validation belong to the phone/backend. The ESP does not enforce those application fields. There is no duration-based movement schema, ultrasonic/proximity telemetry, or IR behavior in the current firmware. Do not display an obstacle-clear state based on absent sensor data.

## Proposed conversation and media events

These events are future application work over the authenticated backend WebSocket hub. The backend routes them between the frontend and phone; they are not MQTT Topic 1 movement messages. Every event includes `type`, target `device_id`, the backend-authorized `control_session_id`, and an application timestamp `ts` in milliseconds. Frontend, backend, and phone reject events outside the active authorized session; the session ID alone does not authenticate a publisher. Validate ownership and permissions in addition to message shape. None of these events is forwarded to the ESP.

| Type | Origin and consumer | Purpose |
| --- | --- | --- |
| `gaze_status` | Frontend to backend | Calibrated/uncertain/lost state. Frontend also stops its own intention heartbeat immediately on lost gaze. |
| `speech_activity` | Phone to frontend/backend | Nearby speech has started or stopped. |
| `transcript` | Backend to frontend; phone fallback to backend | Recognized text for one utterance. |
| `suggestions` | Backend to frontend | Three candidate replies requiring explicit confirmation. |
| `speak` | Authorized frontend to phone | Speak a user-confirmed response. Deduplicate by `speak_id`. |
| `tts_status` | Phone to frontend/backend | Speaking started, finished, or failed. |
| `motion` | Phone to frontend/backend | Optional orientation telemetry; high-rate control calculations remain local to the phone. |
| `bump` | Phone to frontend/backend | Optional impact/tilt event. Phone also stops locally when its configured fault policy fires. |
| `media_ready` | Frontend to phone | Request a fresh media offer for the active authorized session. |
| `rtc_offer`, `rtc_answer`, `rtc_ice` | Phone ↔ backend ↔ frontend | WebRTC signalling messages relayed through the WebSocket hub. |
| `error` | Application component to relevant consumers | Human-readable failure with a machine-readable code. |

Conversation payload fields remain `utterance_id`, `text`, `confidence` for transcripts; `utterance_id`, `heard`, `suggestions`, `low_confidence`, `requires_user_confirmation:true` for suggestions; and `speak_id`, `text`, `source`, optional `audio_url` for speech. TTS status uses `speak_id`, `state` (`started`, `finished`, `error`), and optional `error`. These fields accompany `type`, `device_id`, `control_session_id`, and `ts`; they do not replace the movement envelope. Preserve the same `utterance_id` from transcript through suggestions so asynchronous responses remain correlated.

The phone makes the media offer after an authorized `media_ready`. SDP uses `sdp`; ICE uses `candidate`. A reconnect creates a fresh media negotiation. WebRTC carries camera/microphone streams; the backend WebSocket hub carries signalling and conversation events. MQTT remains the movement channel. Do not put continuous video or base64 frames on either command topic, where media traffic would compete with command freshness. A media failure should show an unavailable state; a degraded media fallback needs a separate agreed implementation.

Speech, suggestions, and media must not silently arm driving. The AI never publishes drive intentions or speaks a suggested response without user confirmation.

## Audio upload

Proposed `POST /api/utterance` on the backend accepts one utterance as multipart form data: `audio` (WAV preferred), `utterance_id`, and `duration_ms`. Use HTTPS and application authentication. This endpoint handles media upload, not robot movement. A successful response is `202 {"ok":true}`; the backend sends transcript/suggestion events to the frontend over WebSocket asynchronously. Do not store clips or log their contents without consent.

## Browser module contracts

### Gaze module

Arunya owns `apps/web/src/lib/gaze/`; Sahil consumes its interface. This API remains the boundary for gaze or mouse input:

```ts
export type GazeState = "uncalibrated" | "calibrated" | "uncertain" | "lost";

export interface Gaze {
  init(opts: { mode: "gaze" | "mouse" }): Promise<void>;
  setMode(mode: "gaze" | "mouse"): void;
  calibrate(): Promise<{ accuracyPx: number }>;
  onPoint(cb: (p: { x: number; y: number; confidence: number }) => void): () => void;
  onStatus(cb: (s: GazeState) => void): () => void;
  getCameraStream(): MediaStream | null;
  destroy(): void;
}
export const gaze: Gaze;
```

DOM elements marked `data-gaze-target` receive `gaze:enter`, `gaze:progress` with `{progress}`, `gaze:leave`, `gaze:select`, and `gaze:hold`. Select fires once after dwell; hold continues while the target remains active. `data-gaze-dwell` controls the dwell time, initially 800 ms. The frontend runs its separate 100 ms intention timer while a navigation target is active; it does not use gaze-event arrival as the publish clock. Lost/uncertain gaze or leaving a target stops movement.

### Media module

Harnoor owns `apps/web/src/lib/rtc/`. Its planned `useRobotStream(hubClient, options)` hook uses the application's authenticated WebSocket hub adapter for signalling and returns remote media plus `idle`, `connecting`, `live`, or `failed` state. An optional local camera stream comes from `gaze.getCameraStream()` so the laptop webcam is not opened twice. The hub carries media/session/conversation messages; `drive_intent` and `mobile_status` remain on MQTT Topic 1. Connection lifecycle messages such as `hello`/`peer_status` are backend-owned application state; role claims never bypass authentication.
