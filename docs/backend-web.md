# Contract: Backend Hub, AI Pipeline & Web Control UI

**Owner:** Sahil · **Code:** `apps/server/`, `packages/protocol/`, `apps/web/` (except `src/lib/gaze/` → Arunya, `src/lib/rtc/` → Harnoor; the phone app itself lives in `mobile/`)
**Depends on:** [interfaces.md](./interfaces.md) · **Overview:** [PLAN.md](./PLAN.md)

You own the **hub that every device connects to**, the **zero-prompt AI** (speech → text → 3 replies), and the **screen the patient uses**.

---

## 1. What you deliver

### Backend (`apps/server`, Hono on Bun)

| # | Feature | Priority | Done when… |
|---|---|:-:|---|
| B0 | Remove/stub Postgres + Better-Auth so `bun run dev` works without a DB | P0 | Fresh clone → `bun install && bun run dev` works |
| B1 | `packages/protocol`: zod schemas for every message in interfaces.md | P0 | Web and server import from it (the Kotlin app mirrors it in `Protocol.kt`) |
| B2 | **WebSocket hub** `/ws?role=…`: one client per role, routing per interfaces.md §2, `peer_status` on change, logs every message | P0 | `wscat` as `robot` receives `move` that `wscat` as `web` sends |
| B3 | **Mocks** for the others: `mock-robot` (prints moves, sends `robot_state` at 5 Hz, fakes an obstacle on keypress) and `mock-phone` (uploads a sample WAV, prints `speak`) | P0 | Others can test against the hub without real hardware |
| B4 | **Safety rules** (interfaces.md §5): stop on gaze lost / web disconnect / bump; drop forward moves during obstacle; clamp `duration_ms` | P0 | Each rule shown working with the mocks |
| B5 | `POST /api/utterance` → **STT** → `transcript` to web | P0 | Sample WAV → transcript in < 1.2 s |
| B6 | **LLM suggestions** → `suggestions` to web | P0 | Transcript → 3 replies in < 1.3 s |
| B7 | Conversation memory: last ~6 turns (heard + spoken) passed to the LLM | P1 | Follow-up questions get replies that fit the conversation |
| B8 | Canned-suggestion fallback when the LLM fails or times out (> 3 s) | P1 | Kill the API key → still get 3 sensible cards |
| B9 | Server-side TTS (e.g. ElevenLabs) → `speak.audio_url` for a nicer voice | P2 | Phone plays the generated audio |
| B10 | `/debug` page: live message log + buttons to send any message | P1 | The whole team uses it during integration |

### Web control UI (`apps/web`, Next.js)

| # | Feature | Priority | Done when… |
|---|---|:-:|---|
| W1 | Layout: 80% video / 20% side panel with 3 cards (§3) | P0 | Matches the layout below in Chrome fullscreen on the demo laptop |
| W2 | Hub client (`send`, `on`) with auto-reconnect | P0 | Survives restarting the hub |
| W3 | **Mouse mode**: a stub gaze module with the interfaces.md §6 API until Arunya's is ready | P0 | Whole UI works with the mouse alone |
| W4 | **Nav edge zones** on the video + Drive on/off toggle | P0 | Holding gaze on the top edge moves the robot forward; looking away stops it in ≤ 300 ms |
| W5 | **Card state machine** (§4): Home → Suggestions → Confirm → Speaking | P0 | Full loop works with the mouse and the mocks |
| W6 | **Status bar**: hub / phone / robot / gaze dots; big red obstacle banner; error toasts | P0 | Unplugging anything shows up within 1 s |
| W7 | "Someone is speaking…" indicator + live transcript (from `speech_activity` / `transcript`) | P0 | Visible as soon as someone starts talking |
| W8 | Low-confidence state: "Repeat / Ignore" cards | P1 | `low_confidence:true` shows them; Repeat speaks "Sorry, could you repeat that?" |
| W9 | Quick phrases (Help card → "Please come here", "I need assistance", "Can you repeat that?") | P1 | Each one can be spoken with gaze + confirm |
| W10 | Gaze keyboard ("Other" option) | P2 | Type and speak a short word |
| W11 | Calibration flow on launch (calls `gaze.calibrate()`), recalibrate from the Help card | P0 once the gaze module lands | |

---

## 2. AI pipeline

```
phone clip ─► /api/utterance ─► drop if < 400 ms
                               ─► STT ─► drop if < 2 words ─► transcript → web
                               ─► LLM (transcript + last 6 turns) ─► suggestions → web
```

- **STT:** whichever fast Whisper-class API you have a key for (Groq Whisper is very fast; OpenAI, ElevenLabs Scribe or Deepgram also work). Budget **≤ 1.2 s**.
- **LLM:** a fast model with JSON / structured output (e.g. Claude Haiku 5.5, or any OpenAI-compatible fast model). Budget **≤ 1.3 s**. Target total: **speech ends → cards visible ≤ 2.5 s**.
- **Prompt rules** (from idea.md §4C and §7):
  - Exactly 3 replies, each **≤ 12 words**, first person, spoken-style.
  - Make them **different from each other**, usually one positive/yes, one negative/no, one that asks or defers ("Can you give me a minute?").
  - **Never** state medical facts, feelings or decisions as true. These are *options* the user picks from.
  - If the input isn't a question or request (e.g. "Hi!"), give natural social replies.
  - If the transcript is garbled or ambiguous, return `low_confidence: true`.
- Use temperature around 0.7 and validate the output with the zod schema. On a parse failure, retry once, then fall back to canned replies (B8).
- **The hub never sends `speak` on its own.** Only the web UI sends `speak`, after the user confirms.

---

## 3. Layout (W1)

```
┌──────────────────────────────────────────────────────┬─────────────────┐
│ ● hub ● phone ● robot ● gaze   🗣 "Do you need…"      │  ✕ Ignore       │ ← panel header (small)
│ ┌──────────────── ▲ FORWARD zone ─────────────────┐  ├─────────────────┤
│ │                                                 │  │                 │
│ │◄ LEFT                                    RIGHT ►│  │     CARD 1      │
│ │ zone        robot camera feed            zone   │  │                 │
│ │             (center = safe, no action)          │  ├─────────────────┤
│ │                                                 │  │     CARD 2      │
│ │                                                 │  │                 │
│ └──────────────── ▼ BACK zone ────────────────────┘  ├─────────────────┤
│  [ Drive: ON ]                 ⛔ OBSTACLE banner     │     CARD 3      │
└──────────────────────────────────────────────────────┴─────────────────┘
               80% width                                     20% width
```

- **The three cards are stacked vertically.** Each is about 20vw × 30vh, which is large enough for webcam gaze. (The original note said "flex row"; see PLAN.md open question 2.)
- **The center of the video does nothing.** The patient spends most of their time watching the feed, so looking there must never move the robot. Only the edge bands (about 15% of the video on each side) are nav zones.
- Nav zones: dwell 600 ms → `gaze:select` → start sending `move` every 150 ms on `gaze:hold`. Stop sending on `gaze:leave`.
- **Drive toggle:** when OFF, nav zones are disabled so the patient can look anywhere freely. Default ON for the demo.
- High contrast, text ≥ 28 px on cards, a visible dwell-progress fill on every target, no hover-only interactions.

---

## 4. Card state machine (W5)

The side panel **always shows exactly three big slots**. What fills them depends on the state:

| State | Card 1 | Card 2 | Card 3 | Enter when | Leave when |
|---|---|---|---|---|---|
| **Home** | 💬 Talk (shows last suggestions / phrases) | ⚡ Quick phrases | 🆘 Help (recalibrate, call caregiver) | Start; after speaking; Ignore | `suggestions` arrives |
| **Suggestions** | Reply 1 | Reply 2 | Reply 3 | `suggestions` arrives (**this is the zero-prompt moment**: no click, the cards just appear) | Card selected → Confirm; Ignore; 30 s timeout → Home |
| **Low confidence** | 🔁 "Ask to repeat" | 🙈 Ignore | ⌨️ Other | `low_confidence: true` | Selected |
| **Confirm** | Preview of the selected text (not a target) | ✅ **Speak it** | ✕ Cancel | Any speakable item selected | Speak → Speaking; Cancel → previous state |
| **Speaking** | "Speaking…" + text | — | — | `speak` sent | `tts_status: finished/error` → Home |

A new `suggestions` message that arrives during Confirm/Speaking is **queued** and doesn't replace what the user is acting on.

---

## 5. What you depend on and how to test without it

| You need | From | Until it's ready |
|---|---|---|
| Gaze events | Arunya (`lib/gaze`) | Your mouse stub (W3) with the same API |
| Robot | Arunya (ESP32) | `mock-robot` (B3) |
| Video | Harnoor (`useRobotStream`) | A `<video>` showing your own webcam, or a looping mp4 |
| Utterances / TTS | Harnoor (phone) | `mock-phone` (B3) + `/debug` page |

---

## 6. Milestones

| By | Target |
|---|---|
| H1 | B0, B1 started; interfaces agreed |
| H2.5 | B2 hub relay + B3 mocks pushed (**others depend on this, so ship it first**); W1–W3 skeleton (**CP1**) |
| H5 | B4, B5, B6 working on a sample WAV; W4 nav zones drive the robot (**CP2**) |
| H8 | W5 state machine, W6 status, W7 (**CP3** full loop) |
| H11 | Latency tuned to < 2.5 s; B8, W8, W9, B10 (**CP4**) |
| H13 | Freeze → bug fixes |

---

## 7. Gotchas

- `apps/web/AGENTS.md` warns that this Next.js version has breaking changes. Check `node_modules/next/dist/docs/` before relying on memory for the APIs.
- Bun + Hono WebSockets: use `upgradeWebSocket` from `hono/bun` and export `websocket` along with `fetch` from the server entry.
- The **gaze camera and the WebRTC send-local stream are the same laptop webcam.** Get it from `gaze.getCameraStream()`; don't open it twice.
- Keep secrets (STT/LLM keys) in `apps/server/.env`, never in the web bundle.
- Log the latency of each step (`t_clip_received`, `t_stt_done`, `t_llm_done`). Harnoor needs these numbers for the metrics slide.
