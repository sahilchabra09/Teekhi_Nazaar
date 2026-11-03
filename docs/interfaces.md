# IRIS: Interfaces (the shared contract)

> **Frozen at H1.** After that, anyone who changes a message here must tell the other two people **before** pushing.
> Sahil turns this doc into zod schemas in `packages/protocol/src/index.ts`. TypeScript code imports those schemas. The Kotlin app (`Protocol.kt`) and the ESP32 firmware follow the JSON by hand.

**Laptop IP on the hotspot:** `__________` (fill in at H1)

---

## 1. Connections

| Who | Connects to | Notes |
|---|---|---|
| Web UI (laptop browser) | `ws://localhost:3000/ws?role=web` | `localhost` already counts as a secure context, so nothing extra is needed |
| Phone app (Kotlin) | `ws://<LAPTOP_IP>:3000/ws?role=phone` | Native app, so no HTTPS needed; just allow cleartext in the manifest (mobile.md §6) |
| ESP32 | `ws://<LAPTOP_IP>:3000/ws?role=robot` | Plain `ws://`, no TLS on the ESP32 |
| Phone → audio clips | `POST <hub>/api/utterance` | See §4 |

- The hub allows **one connection per role**. A new connection with the same role replaces the old one.
- On connect, the client sends `{"type":"hello","role":"web|phone|robot","version":1}`.
- **Every message** is JSON with a `type` and a `ts` (ms since epoch). Every example below has an implicit `"ts": 1730000000000`.

---

## 2. Message routing table

| `type` | From → To | Purpose |
|---|---|---|
| `hello` | any → hub | Identify role |
| `peer_status` | hub → web, phone | Who is connected right now |
| `move` | web → hub → robot | Short bounded movement burst |
| `stop` | web / hub / phone → robot | Stop now (always obeyed) |
| `robot_state` | robot → hub → web | Robot telemetry |
| `gaze_status` | web → hub | Tracking quality; hub stops the robot when `lost` |
| `speech_activity` | phone → hub → web | Someone near the robot started or stopped talking |
| `transcript` | phone → hub (fallback path) · hub → web | Text of what was heard |
| `suggestions` | hub → web | 3 AI reply options |
| `speak` | web → hub → phone | Say this out loud (only sent after gaze confirmation) |
| `tts_status` | phone → hub → web | Speaking started, finished, or failed |
| `motion` | phone → hub | Orientation/acceleration, ≤ 10 Hz |
| `bump` | phone → hub | Sudden jolt or tip-over; hub sends `stop` |
| `rtc_offer` / `rtc_answer` / `rtc_ice` | phone ↔ web via hub | WebRTC signalling, relayed unchanged |
| `frame` | phone → hub → web | **Fallback only:** JPEG video frame if WebRTC fails |
| `error` | hub → any | Something went wrong; show it |

---

## 3. Message shapes

### Robot control

```jsonc
// web → hub → robot
{ "type": "move", "direction": "forward" | "backward" | "left" | "right",
  "duration_ms": 300,   // clamped by the ESP32 to 100–400
  "seq": 42 }           // increasing; robot ignores seq <= last seen

{ "type": "stop", "reason": "user" | "gaze_lost" | "obstacle" | "bump" | "disconnect" | "estop" }

// robot → hub → web, at 5 Hz and immediately on any change
{ "type": "robot_state",
  "moving": "forward" | "backward" | "left" | "right" | null,
  "obstacle": false,
  "distance_cm": 87,          // -1 if no sensor reading
  "movement_enabled": true,   // false while e-stop is pressed or forward is blocked
  "last_seq": 42 }
```

**How motion works:** the robot never moves on its own. Each `move` runs for `duration_ms` and then the robot stops by itself. To keep moving, the web UI resends `move` **every 150 ms with `duration_ms: 300`** while the user's gaze rests on a nav zone. If anything breaks (gaze, Wi-Fi, browser, hub), the robot stops within 300 ms without anyone sending a message. This is the main safety mechanism.

### Status

```jsonc
// hub → web, phone (sent on every connect/disconnect)
{ "type": "peer_status", "web": true, "phone": true, "robot": false }

// web → hub (on every change)
{ "type": "gaze_status", "state": "uncalibrated" | "calibrated" | "uncertain" | "lost" }
```

### Conversation

```jsonc
// phone → hub → web
{ "type": "speech_activity", "active": true }

// hub → web (after STT). Also phone → hub on the fallback path (on-device STT)
{ "type": "transcript", "utterance_id": "u_17", "text": "Do you need anything?", "confidence": 0.92 }

// hub → web
{ "type": "suggestions", "utterance_id": "u_17",
  "heard": "Do you need anything?",
  "suggestions": ["Could you bring me some water?", "I'm okay, thank you.", "Let's talk for a minute."],
  "low_confidence": false,             // true → UI shows "Repeat / Ignore" instead of the 3 cards
  "requires_user_confirmation": true } // always true

// web → hub → phone. ONLY sent after the user confirms with gaze.
{ "type": "speak", "speak_id": "s_9", "text": "I'm okay, thank you.",
  "source": "suggestion" | "phrase" | "keyboard" | "system",
  "audio_url": null }   // optional: if the hub made TTS audio, phone plays this URL instead of using device TTS

// phone → hub → web
{ "type": "tts_status", "speak_id": "s_9", "state": "started" | "finished" | "error", "error": null }
```

### Phone sensors

```jsonc
// phone → hub, ≤ 10 Hz
{ "type": "motion", "alpha": 12.1, "beta": 3.4, "gamma": -1.2, "accel": 9.9 }  // degrees, m/s²

// phone → hub (hub then sends stop to robot and forwards bump to web)
{ "type": "bump", "kind": "impact" | "tilt", "magnitude": 24.5 }
```

### WebRTC signalling (hub relays these unchanged)

```jsonc
{ "type": "rtc_offer",  "sdp": "..." }                 // phone → web  (the phone always makes the offer)
{ "type": "rtc_answer", "sdp": "..." }                 // web → phone
{ "type": "rtc_ice",    "candidate": { /* RTCIceCandidateInit */ } }  // both ways
```

**Rule:** the phone sends a fresh `rtc_offer` every time `peer_status` changes from `web: false` to `web: true`. That covers reconnects in either direction.

### Fallback video

```jsonc
{ "type": "frame", "jpeg_b64": "/9j/4AAQ...", "w": 640, "h": 480 }  // phone → hub → web, 5–10 fps
```

### Errors

```jsonc
{ "type": "error", "code": "stt_failed" | "llm_failed" | "robot_offline" | "phone_offline" | "bad_message", "message": "human-readable" }
```

---

## 4. HTTP endpoint

`POST /api/utterance`, `multipart/form-data`

| Field | Value |
|---|---|
| `audio` | WAV (16 kHz mono preferred) or WebM/Opus blob of **one** utterance |
| `utterance_id` | phone-generated id, e.g. `u_17` |
| `duration_ms` | length of the clip |

Response is `202 {"ok": true}`. The result comes back **asynchronously** to the web UI as `transcript` followed by `suggestions`. The hub silently drops clips shorter than 400 ms and transcripts with fewer than 2 words, which filters out noise.

---

## 5. Safety rules: who enforces what

Each layer works on its own, so one failure can't make the robot move unsafely.

| Rule | ESP32 (Arunya) | Hub (Sahil) | Web UI (Sahil) |
|---|:-:|:-:|:-:|
| Every move is bounded (≤ 400 ms) | ✅ | clamps too | sends ≤ 300 |
| No message for 1 s → stop, report disconnected | ✅ | | |
| Obstacle < 25 cm → refuse/stop **forward** (backward and turning still allowed) | ✅ | drops forward moves while `obstacle` | shows red banner |
| Gaze `lost` → stop | | ✅ sends `stop` | stops resending `move` |
| Web disconnects → stop | | ✅ | |
| Phone `bump` → stop | | ✅ | shows warning |
| Physical e-stop cuts motor power | ✅ hardware | | |
| AI never speaks without confirmation | | never sends `speak` itself | confirm step |

---

## 6. In-browser module contracts (inside `apps/web`)

### Gaze module (Arunya → used by Sahil): `apps/web/src/lib/gaze/`

```ts
export type GazeState = "uncalibrated" | "calibrated" | "uncertain" | "lost";

export interface Gaze {
  init(opts: { mode: "gaze" | "mouse" }): Promise<void>; // mouse = same events driven by the cursor
  setMode(mode: "gaze" | "mouse"): void;
  calibrate(): Promise<{ accuracyPx: number }>;          // draws its own full-screen overlay
  onPoint(cb: (p: { x: number; y: number; confidence: number }) => void): () => void;
  onStatus(cb: (s: GazeState) => void): () => void;
  getCameraStream(): MediaStream | null;                 // lets the rtc module reuse the webcam
  destroy(): void;
}
export const gaze: Gaze;
```

**Dwell targets:** any DOM element with `data-gaze-target` gets these `CustomEvent`s dispatched on it:

| Event | `detail` |
|---|---|
| `gaze:enter` | `{}` |
| `gaze:progress` | `{ progress: 0..1 }` (use it to draw a fill ring) |
| `gaze:leave` | `{}` |
| `gaze:select` | `{}`, fired once when the dwell completes |
| `gaze:hold` | `{}`, fired every 150 ms **after** select while the gaze stays on the target (for nav zones) |

Optional attribute `data-gaze-dwell="800"` sets the dwell time in ms (default 800).

**Until Arunya's module is ready**, Sahil uses a tiny mouse-only stub with the same API.

### RTC module (Harnoor → used by Sahil): `apps/web/src/lib/rtc/`

```ts
export interface RobotStream {
  remote: MediaStream | null;                      // robot camera + mic → put into <video>
  state: "idle" | "connecting" | "live" | "fallback" | "failed";
  fallbackFrameUrl: string | null;                 // object URL of the latest JPEG when state = "fallback"
}
// hub = Sahil's hub client: { send(msg): void; on(type, cb): () => void }
export function useRobotStream(hub: HubClient, opts?: { sendLocal?: MediaStream }): RobotStream;
```

`sendLocal` is the laptop webcam stream (from `gaze.getCameraStream()`) sent to the phone screen (P1).
