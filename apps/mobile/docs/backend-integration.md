# Mobile ↔ backend handoff

## Main frontend console

The authenticated console at `/` uses `useRobotConnection` and the shared `createApplicationHub` adapter. Its main feed is the phone's video/audio, with a separate local-webcam preview sent to the phone. It consumes `speech_activity`, `transcript`, `suggestions`, and matching `tts_status`; speaking completes on the phone's result, not a simulated timer. New suggestions queue while a reply is being confirmed/spoken. A replacement connection stops the previous browser from automatically stealing the single web role back.

`NEXT_PUBLIC_SERVER_URL` points to the **same** Better Auth and media API (normally port 3000). The independent media URL override has been removed. On the phone, use that server's LAN IP or HTTPS hostname. See the [first-run instructions](../README.md#first-run).

The backend authenticates both media roles and isolates rooms by the user ID obtained from Better Auth. The integrated `/api/talk/*` routes provide speech/replies with configured providers; the phone's separate `/api/utterance` bridge, robot ownership, MQTT intention publishing and controller leases remain integration work. Signing in does not grant motor control or doctor permissions. Role onboarding, care and Talk routes stay mounted beside the robot gateway. The unauthenticated development hub is only a test fixture.

## Implemented account authorization

| Route | Authorization and behavior |
| --- | --- |
| `POST /api/mobile/oauth/start` | Native app sends fresh state and an S256 PKCE challenge; receives a browser authorization URL valid for five minutes. |
| `GET /api/mobile/oauth/authorize` | Opens the existing Better Auth Google provider, forwarding its state cookie to the external browser. Google returns to the existing registered `/api/auth/callback/google`. |
| `GET /api/mobile/oauth/callback` | Validates a private server callback key and the new Better Auth session, then returns to the fixed Android URI with the app state and a one-use 60-second authorization code. No long-lived credential enters the return URL. |
| `POST /api/mobile/oauth/exchange` | App automatically exchanges the browser return using its private PKCE verifier; receives a native credential and the authenticated user identity. Ten OAuth start/exchange attempts per minute per direct client IP. |
| `POST /api/mobile/web-ticket` | Live browser session and trusted Origin; issues a one-use WebSocket ticket valid for 30 seconds. |
| `GET /api/mobile/me` | Native bearer credential; revalidates its parent Better Auth session. |
| `POST /api/mobile/logout` | Native bearer credential; revokes it and closes its active socket. |
| `GET /ws?role=phone` | Native bearer Authorization header; user identity determines the room. |
| `GET /ws?role=web&ticket=…` | Trusted browser Origin and consumed ticket; user identity determines the room. |

The old `/api/mobile/link-code` and `/api/mobile/link` routes are removed. Both devices independently use the same Google identity and Better Auth account database; media room selection uses the verified account ID. Phone credentials last at most 24 hours, never beyond the phone's parent Better Auth session. Signing out on the laptop closes its socket without signing out the independent phone session. Active sockets revalidate every 15 seconds and close on revocation or validation failure. Replaced roles close with 4001; account revocation closes with 1008. Clients stop retrying these terminal failures.

Issued codes, credentials and tickets are indexed only by hashes in bounded, expiring in-memory stores; PKCE challenge/state and parent session cookies remain server-side for validation. API restart requires signing in again. Multiple API instances require a shared atomic TTL store before deployment. Mobile endpoints return `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. Only fixed callback locations are used; custom redirect destinations are not accepted. Google secrets stay in the server environment. No request URL logger records OAuth parameters or WebSocket tickets. The relay limits payload size, per-peer message rate and queued output, and permits only role-appropriate media/speech events. It never relays a `drive_intent`. Client-provided account IDs do not select a room. Confirmed `speak` uses device TTS; arbitrary audio URLs are not accepted from the browser.

## Existing media/conversation contract

Current implementation and remaining service integration:

| Route | Phone behavior | Backend behavior required |
| --- | --- | --- |
| `GET /ws?role=phone` | Authenticated `hello`; jittered 0.5–30 second reconnect for temporary failures | Implemented: authenticated upgrade, one peer per account/role, initial and updated `peer_status` |
| `POST /api/utterance` | Authenticated multipart WAV in `audio`, ID in `utterance_id`, length in `duration_ms` | Currently **501**, explicitly unconfigured. When STT is connected, return **202 `{ "ok": true }`**, then emit real `transcript` and `suggestions` asynchronously to the same account's web peer. |

Kotlin sealed-message discriminator is exactly `type`; every modeled message includes epoch-millisecond `ts`. Unknown/malformed message types are ignored. Phone messages are implemented in `core/.../Protocol.kt`.

Relay phone `rtc_offer`, `rtc_ice`, `frame`, `speech_activity`, `tts_status`, fallback `transcript`, and bump notifications to web as specified by the shared contract. Relay web `rtc_answer`, `rtc_ice` and confirmed `speak` to the phone. The phone reports motion at no more than 10 Hz. A bump also disarms the local controller immediately and sends a hub `stop`; backend must apply its own stop/safety rules too.

The phone always offers, including after hub reconnect. Relay web `media_ready` to the phone for a fresh offer after the console's listeners are installed. Legacy peer-presence startup remains supported. The web client must receive `peer_status.phone:false` on disconnect so its hook can release stale media. Only the web user confirmation flow may create `speak`; the mobile app does not choose replies.

## Additional controller lease endpoint — proposed, must be implemented by backend

The route exists but currently returns **401** without a valid account credential and **501** for linked phones. It does not mint a drive grant from media pairing.

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
