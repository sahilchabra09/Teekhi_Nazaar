# Contract: Robot Hardware, ESP32 Firmware & Eye Tracking

**Owner:** Arunya · **Code:** `firmware/` (Arduino/PlatformIO for ESP32), `apps/web/src/lib/gaze/`
**Depends on:** [interfaces.md](./interfaces.md) · **Overview:** [PLAN.md](./PLAN.md)

You own the two things that are physically closest to the user and the world: **the robot that moves** and **the eye tracking that drives everything**.

---

## Part A: Robot hardware + firmware

### Deliverables

| # | Feature | Priority | Done when… |
|---|---|:-:|---|
| R1 | Chassis + motor driver (TB6612FNG / L298N) + battery wired; motors **never** powered from ESP32 pins | P0 | All 4 directions work from a test sketch |
| R2 | ESP32 joins the team hotspot and connects as a WebSocket client to `ws://<LAPTOP_IP>:3000/ws?role=robot`, sends `hello`, auto-reconnects | P0 | Hub log shows `robot` connected; reconnects after a hub restart |
| R3 | `move` handling: run `direction` for `duration_ms` (clamp 100–400), then stop by itself; ignore `seq` ≤ last; a new move extends the timer | P0 | Spamming `move` from `wscat` drives smoothly; stopping the spam stops it in ≤ 400 ms |
| R4 | `stop`: motors off immediately, whatever the reason | P0 | |
| R5 | **Watchdog:** no message from the hub for 1 s, or WS disconnected → stop, `movement_enabled` follows reality | P0 | Turn the hotspot off mid-move and the robot stops |
| R6 | **Ultrasonic** (HC-SR04 or similar): 15–20 Hz, median of 3 readings; < 25 cm → refuse/stop **forward** only (backward and turns still allowed so it can back out) | P0 | Box in front → stops by itself, and the UI shows the obstacle |
| R7 | `robot_state` at 5 Hz and immediately on change (interfaces.md §3) | P0 | Visible in the hub log |
| R8 | **Physical e-stop**: switch in series with the **motor** battery (logic stays powered so the state is still reported) | P0 | Switch off → wheels dead even if the firmware is wrong |
| R9 | Phone mount: front camera facing forward, screen visible to people in front, speaker uncovered, firm (no wobble) | P0 | Agree it with Harnoor; video doesn't shake while driving |
| R10 | Status LED: connected / moving / obstacle | P2 | |

### Driving rules

- Left/right = **turn in place** (wheels spin in opposite directions). That's easiest to control with short bursts.
- Keep it **slow**: PWM about 50–60%. A slow, predictable robot makes a better demo than a fast one.
- Use a short soft-start ramp (about 50 ms). It reduces jerk and current spikes.

### Suggested libraries

`WebSocketsClient` from **arduinoWebSockets** (links2004), **ArduinoJson** v7. Use `millis()` timers everywhere; no `delay()` in the loop.

### Hardware gotchas

- **HC-SR04 ECHO outputs 5 V and ESP32 GPIO is 3.3 V.** Use a voltage divider (e.g. 1 kΩ / 2 kΩ) or a 3.3 V-tolerant sensor.
- **Brownouts:** motor current spikes can reset the ESP32. Use a separate supply for the logic, or at least a big capacitor across the motor supply. **All grounds must be common.**
- Some ESP32 pins are input-only (34–39) or affect boot (0, 2, 12, 15). Avoid them for motor PWM.
- Write the hotspot SSID/password and the laptop IP in one `config.h`. At the venue that's the only file you edit.

### Testing without the hub

```bash
bunx wscat -l 3000                         # pretend to be the hub; the ESP32 connects to you
> {"type":"move","direction":"forward","duration_ms":300,"seq":1}
> {"type":"stop","reason":"user"}
```

---

## Part B: Eye-tracking module (`apps/web/src/lib/gaze/`)

Sahil's UI only uses the API in **interfaces.md §6**. Build behind that API and you can change the internals whenever you want.

### Deliverables

| # | Feature | Priority | Done when… |
|---|---|:-:|---|
| G1 | Gaze point from the laptop webcam (`onPoint`) | P0 | A dot follows the user's eyes roughly |
| G2 | **Calibration** overlay: 9 points (click/dwell each), returns `accuracyPx` | P0 | After calibration the dot lands in the right screen quadrant ≥ 90% of the time |
| G3 | **Smoothing** (moving average or One-Euro filter) | P0 | Dot doesn't jitter between neighbouring targets |
| G4 | **Dwell engine** that fires `gaze:enter/progress/leave/select/hold` on `[data-gaze-target]` elements | P0 | Sahil's cards and zones react with no extra code on his side |
| G5 | `onStatus`: `lost` when no face for > 500 ms, `uncertain` when confidence is low | P0 | Cover the webcam → `lost` → robot stops |
| G6 | **Mouse mode** (same events driven by the cursor) | P0 | Demo fallback + Sahil's dev mode |
| G7 | `getCameraStream()` shares the webcam stream with the rtc module | P1 | Patient face reaches the phone without opening the camera twice |
| G8 | Accuracy test page: 20 random targets, reports hit rate + mean dwell time | P1 | Numbers handed to Harnoor for the metrics slide |

### Approach

- **Start with WebGazer.js.** It's fastest to get running, and we only need **coarse targets** (edge bands + 3 big cards), not pixel accuracy. Hide its default video preview and prediction dot, and draw your own.
- If WebGazer is too noisy by H8, switch the internals to **MediaPipe Face Landmarker** (iris landmarks + head pose → map to screen zones via calibration). The API stays the same, so nobody else is affected.
- Hit-testing: on each smoothed point, `document.elementFromPoint(x, y)?.closest("[data-gaze-target]")`. Add a little stickiness: only switch to a new target after about 100 ms on it, so a single noisy sample doesn't reset the dwell.

### Gaze gotchas

- **Lighting decides everything.** Light the face from the front and never sit with a window behind you. Test in the **actual venue spot** at H11.
- Laptop screen at eye level, about 50–70 cm away. Head movement after calibration hurts accuracy, so recalibrate if the user moves (Help card → Recalibrate).
- Webcam permission prompts must come from a user gesture. Trigger `init()` from the "Start" button.

---

## Milestones

| By | Robot | Gaze |
|---|---|---|
| H1 | Agree interfaces; hotspot up; laptop IP in `interfaces.md` | |
| H2.5 | R1–R4: drives from `wscat` (**CP1**: robot connected to hub) | G1: WebGazer gives a point |
| H5 | R5–R7: watchdog + obstacle + state (**CP2**) | G4, G6: dwell events + mouse mode handed to Sahil |
| H8 | R8, R9: e-stop + phone mount (**CP3**) | G2, G3, G5: calibration, smoothing, lost-detection in the real UI |
| H11 | Drive-test the demo course 10× | Tune in venue lighting; G8 accuracy numbers (**CP4**) |
| H13 | Freeze | Freeze |

**If you fall behind:** after H8, Harnoor is the first person available to help. Hand over the phone mount (R9) and the ultrasonic wiring/testing (R6) first.
