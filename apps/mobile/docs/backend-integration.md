# Mobile ↔ backend handoff

## Main frontend console

The authenticated console at `/` uses `useRobotConnection` and the shared `createApplicationHub` adapter. Its main feed is the phone's video/audio, with a separate local-webcam preview sent to the phone. Incoming calls appear as one action card. One patient approval permits successive voice turns until the call ends. Speech playback completes on the matching `tts_status`. A replacement connection stops the previous browser from automatically stealing the single web role back.

`NEXT_PUBLIC_SERVER_URL` points to the **same** Better Auth and media API (normally port 3000). The independent media URL override has been removed. On the phone, use that server's LAN IP or HTTPS hostname. See the [first-run instructions](../README.md#first-run).

The backend authenticates both media roles and isolates rooms by the user ID obtained from Better Auth. The integrated `/api/talk/*` routes provide speech/replies with configured providers; the phone's `/api/utterance` bridge invokes those same routes using its verified, server-held Google session. The server can authorize one owner for the paired robot console. Signing in does not grant motor control or doctor permissions. Role onboarding, care and Talk routes stay mounted beside the robot gateway. The unauthenticated development hub is only a test fixture.

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

The old `/api/mobile/link-code` and `/api/mobile/link` routes are removed. Both devices independently use the same Google identity and Better Auth account database; media room selection uses the verified account ID. A phone credential has a fixed expiry at the earlier of seven days after issue and the parent Better Auth session expiry. Reconnecting through USB, Wi-Fi or a VPN uses the same bearer and expiry. Signing out on the laptop closes its socket without signing out the independent phone session. Active sockets revalidate every 15 seconds and close on revocation or validation failure. Replaced roles close with 4001; account revocation closes with 1008. Clients stop retrying these terminal failures.

Issued codes, credentials and tickets are indexed only by hashes in bounded, expiring in-memory stores; PKCE challenge/state and parent session cookies remain server-side for validation. API restart requires signing in again. Multiple API instances require a shared atomic TTL store before deployment. Mobile endpoints return `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. Only fixed callback locations are used; custom redirect destinations are not accepted. Google secrets stay in the server environment. No request URL logger records OAuth parameters or WebSocket tickets. The relay limits payload size, per-peer message rate and queued output, and permits only role-appropriate media/speech events. It never relays a `drive_intent`. Client-provided account IDs do not select a room. Confirmed `speak` uses device TTS; arbitrary audio URLs are not accepted from the browser.

## Existing media/conversation contract

Current implementation and remaining service integration:

| Route | Phone behavior | Backend behavior required |
| --- | --- | --- |
| `GET /ws?role=phone` | Authenticated `hello`; jittered 0.5–30 second reconnect for temporary failures | Implemented: authenticated upgrade, one peer per account/role, initial and updated `peer_status` |
| `POST /api/utterance` | Authenticated multipart WAV in `audio`, ID in `utterance_id`, length in `duration_ms` | Requires an approved matching utterance and sends `talk_result` (`request_id`, `ok`, `result`, `ts`) to the same account's console. Android recognition sends multipart `text` and `confidence` through this route instead of WAV. |

Kotlin sealed-message discriminator is exactly `type`; every modeled message includes epoch-millisecond `ts`. Unknown/malformed message types are ignored. Phone messages are implemented in `core/.../Protocol.kt`.

Relay phone `rtc_offer`, `rtc_ice`, `frame`, `speech_activity`, `tts_status`, fallback `transcript`, and bump notifications to web as specified by the shared contract. Relay web `rtc_answer`, `rtc_ice` and confirmed `speak` to the phone. The phone reports motion at no more than 10 Hz. A bump also disarms the local controller immediately and sends a hub `stop`; backend must apply its own stop/safety rules too.

The phone always offers, including after hub reconnect. Relay web `media_ready` to the phone for a fresh offer after the console's listeners are installed. Legacy peer-presence startup remains supported. The web client must receive `peer_status.phone:false` on disconnect so its hook can release stale media. Only the web user confirmation flow may create `speak`; the mobile app does not choose replies.

## Owner-authorized driving

On the API server, set `IRIS_ROBOT_OWNER_ID` to the permitted user's **Better Auth user ID** and restart the single server process. An empty value disables all drive grants. The assignment applies only to `esp12e_carbot`.

1. The owner opens the console and connects a phone signed into the same account. The phone's authenticated WebSocket sends `hello` with `drive_proof: "hmac-sha256-v1"`. When both peers are present, the server privately sends the phone `{type:"drive_binding",device_id,binding,ts}`.
2. **Fetch session** starts a poll every 2.5 seconds. The phone calls `GET /api/mobile/session?device_id=esp12e_carbot` with its bearer credential and the private `X-IRIS-Drive-Binding` header. Each poll verifies both peer identities and the current pair.
3. HTTP returns `{device_id,control_session_id,signing_key,server_time_ms,expires_at_ms,max_ttl_ms:300}`. Only the matching console receives these fields over its authenticated WebSocket, with `type:"drive_grant"` and epoch-millisecond `ts`. The 32-byte signing key is encoded as 64 lowercase hexadecimal characters. Keep it in memory.
4. The lease lasts at most 10 seconds. Polls before expiry renew the same UUID and key, keeping the phone's sequence history. Polls after expiry create a new UUID and key. Disconnecting or replacing either peer invalidates the binding and lease and sends `{type:"session_revoked",device_id,control_session_id,ts}` to connected peers. An HTTP response for a former binding is discarded by the phone.
5. Calibrate and explicitly **Enable driving** on the phone. A valid grant alone leaves the wheels stopped. A new session, disconnect, expired intention or STOP disarms the controller.

HTTP 401 means the phone credential is invalid, 403 means the owner or device does not match, 409 means the compatible pair or binding is unavailable, and 501 means the owner is unset. An HTTP or parsing failure disarms the phone. Socket or network failure is also bounded by the short lease and intention expiry.

Use HTTPS/WSS for grants in deployment. The client rejects redirects. Its explicit local bench option permits HTTP only on localhost or private IPv4. The phone anchors server epoch to its monotonic clock and subtracts the full request RTT from its movement and lease budgets. It rejects RTTs over two seconds. The browser should stamp each command using the current server clock estimate.

## MQTT integration

Follow `docs/robot-operation.md` for `drive_intent` and `mobile_status`. The paired browser publishes fresh intentions roughly every 100 ms with new `command_id`, increasing `seq`, current UTC `sent_at`, TTL ≤300 ms, QoS 1 and `retain:false`. The phone rejects retained, expired, future, duplicate, out-of-order, malformed, mistargeted and wrong-session intentions. `mobile_status` is never treated as movement input.

The phone requires a 32-byte secret in the private grant and a lowercase hex HMAC-SHA256 `signature` on every intention, including STOP. Compute the MAC over UTF-8 values in this order, joined by one newline with no trailing newline. Integers use base ten and `sent_at` is the exact UTC ISO string sent on the wire.

```text
device_id
control_session_id
command_id
seq
action
speed
sent_at
ttl_ms
```

Keep the key off MQTT. Invalid proofs cannot advance the sequence counter, refresh movement or stop the controller. The keyless development hub fixture cannot authorize Android driving.

The phone publishes integer wheel effort using the **existing** `lain-mobile` envelope to `carbot/command`; backend/frontend must not also drive that topic. Phone consumes nonretained full `carbot/status` updates. A successful publish is not proof of ESP execution, password correctness, or physical movement. Backend tokens and the ESP payload password serve different purposes; backend does not need that ESP password.

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

## Android command translation

On `teekhi-nazaar/esp12e_carbot/intent`, send the usual signed `drive_intent` JSON envelope. The `action` field accepts `F`, `B`, `L`, `R`, `U`, `D`, and `S`, or the corresponding lowercase words. Sign the action exactly as sent. Existing session, sequence, speed (0–100), freshness, and explicit Enable requirements apply. Zero speed or S disarms. Renew held intentions at 100 ms intervals.

F/B hold the heading measured at direction entry. L/R pivot with yaw-rate correction. The mounted Android phone samples the rotation vector and projects its gyroscope onto the vertical axis. Hold the mount upright and still for about 1–2 seconds before calibration. The phone averages 24 fresh orientation samples around the circle, smooths relative angles, and passes signed integer wheel efforts in the ESP's phone-control envelope on `carbot/command`.

U/D control camera tilt with the wheels stopped. Positive speed permits a step. The phone starts at the ESP's reported `servo_angle`, steps by 5 degrees at most once every 200 ms of renewed input, and clamps to 60–180 degrees. The ESP expects a separate `{"password":"<ESP password>","servo":95}` message on the same topic. Missing valid servo telemetry prevents tilt. The current website sends word-form drive actions; other authorized controllers can send the letter forms. The standalone appliance board has a different firmware and topics.
