# IRIS: Team Plan

**Hackathon:** Upside Down.exe, 3–4 Nov 2026 · **Product spec:** [idea.md](./idea.md) · **Shared contract:** [interfaces.md](./interfaces.md)

Each person works only from their own contract doc plus `interfaces.md`. If you stick to the message formats in `interfaces.md`, you never have to wait on someone else's code. You can test against a mock until the real piece is ready.

---

## 1. Who owns what

| Member | Owns | Contract doc | Code they own |
|---|---|---|---|
| **Arunya** | Robot hardware, ESP32 firmware, obstacle safety, **eye-tracking module** | [hardware-gaze.md](./hardware-gaze.md) | `firmware/`, `apps/web/src/lib/gaze/` |
| **Sahil** | Backend hub, AI pipeline (STT → LLM → suggestions), **web control UI** | [backend-web.md](./backend-web.md) | `apps/server/`, `packages/protocol/`, `apps/web/` (except folders listed for others) |
| **Harnoor** | **Robot phone app in Kotlin/Android** (camera, mic, speaker, TTS, motion sensors), the video link into the web UI, **demo + pitch** | [mobile.md](./mobile.md) | `mobile/`, `apps/web/src/lib/rtc/`, `pitch/` |

### Why Harnoor gets the phone app (and the demo)

- **It's a separate piece with clear edges.** The phone only talks to the rest of the system through the hub WebSocket and one WebRTC link. Harnoor can build and test it start to finish without touching Arunya's or Sahil's code.
- **It's one of the two biggest risks.** idea.md §6 names video/audio transport as one of the two things most likely to break the demo. It needs one person's full attention, not leftover time from someone else.
- **It balances the work.** Arunya already has hardware plus gaze, and Sahil already has backend, AI and UI. Those are both full loads.
- **Demo ownership follows naturally.** By about H8, Harnoor's code will touch every other component (hub, web UI, robot). That makes her the right person to run integration checkpoints, record the backup demo video, collect the metrics in idea.md §10, and build the pitch deck.
- **Spare capacity.** Once the phone's P0 items are done (around H8), Harnoor is the first person to help whoever is behind. The most likely candidate is Arunya's phone mount and wiring.

---

## 2. Architecture at a glance

```
 LAPTOP (patient side)                                     ROBOT
 ┌────────────────────────────────────┐            ┌──────────────────────────────┐
 │ Web control UI  (Sahil)            │            │ Phone app  (Harnoor)         │
 │  ├─ gaze module      (Arunya)      │◄─ WebRTC ─►│  camera + mic  → laptop      │
 │  └─ rtc module       (Harnoor)     │ video/audio│  speaker (TTS) ← laptop text │
 └───────────────┬────────────────────┘            │  VAD, motion sensors         │
                 │ WebSocket (role=web)            └───────────────┬──────────────┘
                 ▼                                                 │ WebSocket (role=phone)
        ┌─────────────────────────────────────────────────────┐    │ + HTTP POST audio clips
        │ Backend hub, runs on the laptop (Sahil)             │◄───┘
        │  message relay · STT · LLM suggestions · safety     │
        └──────────────────────────┬──────────────────────────┘
                                   │ plain WebSocket over Wi-Fi (role=robot)
                                   ▼
                ┌──────────────────────────────────────┐
                │ ESP32 + motor driver + ultrasonic    │  (Arunya)
                │ bounded moves · watchdog · e-stop    │
                └──────────────────────────────────────┘
```

**Network:** All devices join **one hotspot that the team controls**. Don't use venue Wi-Fi, because it often blocks device-to-device traffic. Use a spare phone or the laptop as the hotspot, not the robot phone, since that phone is busy streaming. Write the laptop's IP at the top of `interfaces.md` once it's known.

**The existing scaffold:** Postgres, Drizzle and Better-Auth came with the Better-T-Stack template, and **the demo doesn't need them**. Sahil should stub or remove the auth wiring so that `bun run dev` works without a database.

---

## 3. Timeline (H0 = start of hacking)

| By | Arunya | Sahil | Harnoor | ✅ Team checkpoint |
|---|---|---|---|---|
| **H1** | Read `interfaces.md`, agree on it, set up hotspot | Same; create `packages/protocol` from `interfaces.md` | Same | **Contract frozen.** After this, any change needs a heads-up to the other two. |
| **H2.5** | Robot drives on `move`/`stop` sent from `wscat` | Hub relays every message and logs it; ships `mock-robot` + `mock-phone` scripts; UI skeleton works in mouse mode | Kotlin app installed on the robot phone, gets camera + mic permissions, connects to hub | **CP1:** hub log shows `web`, `phone` and `robot` all connected |
| **H5** | Watchdog + ultrasonic stop working; WebGazer gives a gaze point; dwell events fire | Audio file in → transcript + 3 suggestions out; edge zones send `move` | Phone video shows in the web UI; phone speaks any `speak` message | **CP2:** drive the real robot with the mouse from the UI while watching the phone video |
| **H8** | Phone mount, physical e-stop, calibration screen | Confirm flow, speak routing, obstacle banner, status bar | VAD + utterance upload, mic muted during TTS, motion/bump events | **CP3:** full loop once: someone talks near the robot → cards appear → confirm → robot speaks |
| **H11** | Tune gaze in the venue lighting; measure accuracy | Latency tuning, error states, quick phrases | Auto-reconnect; JPEG fallback if WebRTC is flaky; **record backup demo video**; start the deck | **CP4:** demo acts 1–4 (idea.md §9) each pass once using **gaze, not the mouse** |
| **H13** | | | | 🧊 **Feature freeze.** Bug fixes only after this point. |
| **H13–15.5** | Fix bugs | Fix bugs | Finish deck, fill in metrics, run rehearsals | Rehearse the full 3-minute demo **3 times** |

Work in priority order: **P0** = needed for the demo, **P1** = only after all P0s pass, **P2** = only if there's time left. Every contract doc tags its tasks this way.

---

## 4. How we work without blocking each other

1. **`interfaces.md` is the contract.** If code and the doc disagree, the doc wins until the team agrees to change it.
2. **Mock everything you depend on.**
   - Sahil builds the UI in **mouse mode** (the mouse produces the same events as gaze) and against `mock-robot`.
   - Harnoor tests the phone against the hub plus `wscat` and doesn't need the web UI.
   - Arunya tests the ESP32 with `wscat` and doesn't need the hub.
3. **Folder ownership.** Only edit folders you own (table in §1). If you need a change somewhere else, ask the owner. Commit small and often to `main`.
4. **The hub log is the shared debugger.** Every message goes through the hub and gets logged. When something breaks, check the log first to find out whose side it's on.

---

## 5. Demo-day fallbacks (decide now, not at 3 a.m.)

| If this breaks… | …do this | Owner |
|---|---|---|
| Gaze is unreliable in venue lighting | Switch to mouse mode (same UI), tell the judges honestly, and show the recorded gaze run | Arunya |
| Venue Wi-Fi blocks devices | Use our own hotspot (the plan from the start) | All |
| WebRTC won't connect | Phone sends JPEG frames over the WebSocket at 5–10 fps | Harnoor |
| STT API fails or is slow | Phone falls back to Android `SpeechRecognizer` and sends `transcript` text instead | Harnoor + Sahil |
| LLM API fails | Hub returns canned suggestions picked by question type | Sahil |
| Robot misbehaves | Hit the physical e-stop. Show the obstacle stop on its own, robot on the table, wheels in the air | Arunya |
| Everything breaks | Play the backup demo video recorded at H11 | Harnoor |

---

## 6. Open questions for the team

1. **Which way does video go?** The notes say *"stream video from the webcam via the computer's web app to the mobile app."* idea.md needs the opposite (robot camera → laptop) for navigation. **The docs assume both directions:** robot camera → laptop is **P0**, and laptop webcam → phone screen (so people near the robot see the patient's face) is **P1**. Confirm this is what you meant.
2. **Layout of the three side cards.** The notes say *flex-direction row inside the 20% side panel*. That makes each card about 6% of the screen wide, which is too small to hit reliably with webcam gaze. `backend-web.md` **stacks the three cards vertically** in the 20% column. Say so if you meant a bottom strip instead.
3. **Which phone goes on the robot?** The app is Kotlin, so it **must be an Android phone**. Make sure we have one, with a charging cable and a power bank.
