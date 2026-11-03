# Mobile ↔ backend handoff

## Main frontend console

The authenticated console at `/` uses `useRobotConnection` and the shared `createApplicationHub` adapter. Its main feed is the phone's video/audio, with a separate local-webcam preview sent to the phone. It consumes `speech_activity`, `transcript`, `suggestions`, and matching `tts_status`; speaking completes on the phone's result, not a simulated timer. New suggestions queue while a reply is being confirmed/spoken. A replacement connection stops the previous browser from automatically stealing the single web role back.

`NEXT_PUBLIC_SERVER_URL` continues to point to the existing auth API. An optional `NEXT_PUBLIC_ROBOT_HUB_URL` or the console's editable Media hub field selects the media service independently. Until the production hub exists, run the mock with `PORT=3002`, connect the console to `http://localhost:3002`, and the phone to `<laptop LAN IP>:3002`. Keep the auth server on its existing port. Do not run the mock on top of the authentication service.

The production backend still needs authenticated/scoped WebSocket routing, STT, and controller/session authorization. The development hub is unauthenticated and simulates transcripts/suggestions. Browser login alone does not make that development media transport secure. Production adapters must bind/validate `device_id` and `control_session_id` from authorized backend session state; the current development compatibility events do not invent grants or treat role labels as authentication.

## Existing media/conversation contract

Implement the routes from `docs/interfaces.md` in the production Hono/Bun server:

| Route | Phone behavior | Backend behavior required |
| --- | --- | --- |
| `GET /ws?role=phone` | Sends `hello`, reconnects with jittered 0.5–30 second backoff | Upgrade WebSocket, one peer per role, send `peer_status` immediately and after changes |
| `POST /api/utterance` | Multipart WAV in `audio`, ID in `utterance_id`, length in `duration_ms` | Return **202 `{ "ok": true }`**, then emit `transcript` and `suggestions` asynchronously to web |

Kotlin sealed-message discriminator is exactly `type`; every modeled message includes epoch-millisecond `ts`. Unknown/malformed message types are ignored. Phone messages are implemented in `core/.../Protocol.kt`.

Relay phone `rtc_offer`, `rtc_ice`, `frame`, `speech_activity`, `tts_status`, fallback `transcript`, and bump notifications to web as specified by the shared contract. Relay web `rtc_answer`, `rtc_ice` and confirmed `speak` to the phone. The phone reports motion at no more than 10 Hz. A bump also disarms the local controller immediately and sends a hub `stop`; backend must apply its own stop/safety rules too.

The phone always offers, including after hub reconnect. Relay web `media_ready` to the phone for a fresh offer after the console's listeners are installed. Legacy peer-presence startup remains supported. The web client must receive `peer_status.phone:false` on disconnect so its hook can release stale media. Only the web user confirmation flow may create `speak`; the mobile app does not choose replies.

## Additional controller lease endpoint — proposed, must be implemented by backend

`GET /api/mobile/session?device_id=esp12e_carbot`

```http
Authorization: Bearer <phone pairing/session token>
```

```json
{
  "device_id": "esp12e_carbot",
  "control_session_id": "backend-issued-controller-session",
  "server_time_ms": 1793748600000,
  "expires_at_ms": 1793748610000,
  "max_ttl_ms": 300
}
```

Those timestamps are illustrative. Generate the current server time on **every** response. The backend must authenticate the token, check this phone is paired to this robot, enforce one active controller, and return **only an already-authorized active session**. Fetching a grant must not implicitly take ownership, authorize another controller, or start the robot. Return 401/403 when revoked or unauthorized, and 409 when no matching active controller exists. An MQTT intention cannot authorize its own session ID.

The phone starts polling after the operator taps Fetch session, then refreshes every 2.5 seconds. Use a short lease such as **10 seconds**; the implementation rejects lifetime over 60 seconds, TTL outside 1–300 ms and request RTT above two seconds. Same-session renewal preserves sequence history; changed/expired sessions disarm. Any HTTP/JSON/transport failure revokes the local grant and stops output. Polling-based revocation is bounded by polling/request time and lease expiry, not instantaneous.

Use authenticated HTTPS in deployment. The client does not follow redirects, so it cannot forward the token to another origin. An explicit phone setting permits HTTP only for localhost/private IPv4 LAN bench setups. No credentials should be placed in URLs or logs.

The server epoch is anchored to the phone's monotonic elapsed clock. The full request RTT is treated conservatively as clock uncertainty: it shortens usable command TTL and lease lifetime rather than reviving old commands. Frontend publishers must synchronize timestamps with the backend. A slow network may safely reject movement instead of stretching expiry.

For faster revocation, the authenticated hub may additionally send this **new optional message**:

```json
{
  "type": "session_revoked",
  "device_id": "esp12e_carbot",
  "control_session_id": "backend-issued-controller-session",
  "ts": 1793748600500
}
```

This optional extension is scoped to controller integration; it does not alter media messages. Normal `stop` messages also stop/disarm locally, without being echoed back to the hub.

## MQTT integration

Follow `docs/robot-operation.md` for `drive_intent` and `mobile_status`. Backend/controller publishes fresh intentions roughly every 100 ms with new `command_id`, increasing `seq`, current UTC `sent_at`, TTL ≤300 ms, QoS 1 and `retain:false`. The phone rejects retained, expired, future, duplicate, out-of-order, malformed, mistargeted and wrong-session intentions. `mobile_status` is never treated as movement input.

Phone publishes signed wheel effort using the **existing** `lain-mobile` envelope to `carbot/command`; backend/frontend must not also drive that topic. Phone consumes nonretained full `carbot/status` updates. A successful publish is not proof of ESP execution, password correctness, or physical movement. Backend tokens and the ESP payload password serve different purposes; backend does not need that ESP password.

Broker credentials can be provisioned through phone setup. Broker identity and topic ACLs must enforce which controller can publish this robot's intentions. A session ID in a public MQTT payload is not a credential. ESP security/transport is unchanged by this app.

## Web hook integration

```tsx
"use client";
import { useEffect, useRef } from "react";
import { useRobotStream } from "@/lib/rtc";
import type { HubClient } from "@/lib/rtc";

export function RobotVideo({ hub, patientWebcam }: {
  hub: HubClient;
  patientWebcam?: MediaStream;
}) {
  const { remote, state, fallbackFrameUrl } = useRobotStream(hub, { sendLocal: patientWebcam });
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (video.current) video.current.srcObject = remote; }, [remote]);
  return <>
    <video ref={video} autoPlay playsInline muted />
    {state === "fallback" && fallbackFrameUrl && <img src={fallbackFrameUrl} alt="Robot camera" />}
  </>;
}
```

Hub shape is `{ send(message): void; on(type, callback): () => void }`. Use one stable hub object, not a new wrapper on every render. Pass the gaze module's existing webcam stream; do not open a second camera. A webcam arriving later replaces the negotiated video sender without replacing the peer. The hook never sends laptop audio and never stops caller-owned tracks. Use a user gesture to unmute/play received robot audio if the browser blocks autoplay.

Use the main authenticated console at `/` for integration checks. Only one console tab may occupy the web role at a time.
