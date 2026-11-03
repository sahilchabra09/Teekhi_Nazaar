# Robot driving and appliance control (browser → MQTT)

The patient console controls two devices **directly from the browser** over MQTT, with no IRIS backend in between:

- **Robot driving:** click regions of the robot's camera feed.
- **Appliances:** three ON/OFF switches (pins `d1`–`d3`), from Gaze Connect's appliance board.

Camera streaming, authentication and speech still use the IRIS backend as before.

---

## 1. One shared broker connection

| | |
|---|---|
| Broker | `wss://broker.emqx.io:8084/mqtt` (public EMQX, WebSocket + TLS) |
| Library | `mqtt` 5.16.1, loaded in the browser with a dynamic `import()` |
| Code | `apps/web/src/lib/mqtt/broker.ts`: a single `broker` instance, ref-counted (`broker.acquire()` on console mount) |
| Publish | QoS 1, `retain: false`. `publish()` resolves on the broker's PUBACK, or rejects with a readable error (not connected / timeout / broker error) |
| Reconnect | Automatic every 3 s. Subscriptions are restored after each reconnect |
| Status | Footer chip **Controls · connected / connecting… / offline**. Click it for details and **Reconnect**. Connection errors also show a toast (once per distinct error) |

> `mqtt`'s browser bundle imports `@babel/runtime` without declaring it, so `apps/web` lists `@babel/runtime` explicitly.

## 2. Passwords

Both devices check a password **inside each message**. Neither is hardcoded:

- Footer **Controls** chip, or the **Password** pill in Appliances → *Robot & appliance controls* dialog.
- Saved in this browser only (`localStorage["iris.controlSettings"]`), never sent to the IRIS backend.
- Trying to drive or switch without a password opens the dialog and explains why.

---

## 3. Robot: click-to-drive

Contract with the IoT engineer:

```json
// topic: carbot/command   QoS 1, retain=false
{"password":"<robot password>","cmd":"S"}
```

`cmd` is one of **`U` `D` `F` `B` `L` `R` `S`**. U/D are sent as-is; the firmware support is being added by the engineer, and they're **not** translated into servo commands.

### Regions (match the coloured guide lines)

```
┌──────────┬────────────────────────────┬──────────┐
│          │ U   0–15%                  │          │
│          ├────────────────────────────┤          │
│          │ F  15–30%                  │          │
│          ├────────────────────────────┤          │
│    L     │                            │    R     │
│  outer   │ S  30–70%  (largest)       │  outer   │
│  left    │                            │  right   │
│  25%     ├────────────────────────────┤  25%     │
│          │ B  70–85%                  │          │
│          ├────────────────────────────┤          │
│          │ D  85–100%                 │          │
└──────────┴────────────────────────────┴──────────┘
             middle 50% of the width
```

- **One click = one command.** Hovering shows the letter and its name. The last command that reached the broker stays highlighted on its region.
- **Only active while robot video is on screen:** either the WebRTC stream or the JPEG fallback. The green "Waiting for the robot's camera" screen has no regions, so clicking it does nothing.
- **Never moves the robot:** the video pill and its audio button, the "Someone nearby said" caption, the status pill, the laptop-camera preview and the **Stop** button all sit above the regions (`z-20` over `z-10`).
- **Stop:** the large middle **S** region, plus a red **Stop** button in the top-right corner of the feed.

### Safety stops (best effort)

Plain `cmd` messages keep the motors running until the next command (docs/mqtt.md). So after any movement, IRIS publishes `S` without waiting for an acknowledgement when:
- the robot video disappears (stream and fallback both gone);
- the tab is hidden, the page is closed or navigated away (`pagehide`), or the console unmounts.

These sends are best effort: if the network is already gone, nothing can be sent. The red Stop button and the firmware's own safeguards remain the primary stop.

### Home card

The old "Driving unavailable" card is now **Drive from the video**. Its hint shows what's missing: *Connect the robot phone first* · *Controls are connecting…* · *Set the robot password* · *Click a region · centre stops*. Selecting it opens the password dialog, or shows the region guide.

---

## 4. Appliances

The **Help** card and view were removed; **Appliances** replaces them. **Say something** is unchanged.

Firmware contract (Gaze Connect `appliances_control_hardware`):

```json
// command → gazeconnect/appliances/control   QoS 1, retain=false
{"password":"<appliance password>","pins":{"d3":"on"}}

// state ← gazeconnect/appliances/state   (retained; sent after every accepted command and on connect)
{"d0":"off","d1":"on","d2":"off", … ,"d8":"off"}
```

- **Three cards (`d1`–`d3`)**, the same big clay cards as every other screen. No paging. On = teal, off = light. Header pills: **Password** and **Back**. Works by click or gaze dwell.
- **Toggle:** sends the opposite of the board's last reported state (unknown → `on`). The card shows **Turning on…/off…** until the state report confirms it.
- **State:** taken from the retained state topic as soon as the console subscribes. Until the board has reported anything, cards say **State unknown**.
- **Wrong password:** the board silently ignores the command. If the expected state doesn't arrive within **5 s**, the card shows **No reply. Check the password**.
- **Publish failures** (broker offline, timeout) show a toast, and the card goes back to its previous state.

---

## 5. Files

| File | What it does |
|---|---|
| `apps/web/src/lib/mqtt/broker.ts` | Shared connection, status store, `publish` (QoS 1, PUBACK), `publishBestEffort`, `subscribe` |
| `apps/web/src/lib/mqtt/settings.ts` | Robot / appliance passwords in `localStorage` |
| `apps/web/src/lib/mqtt/robot.ts` | Command letters, labels, `sendRobotCommand`, `stopRobotBestEffort` |
| `apps/web/src/lib/mqtt/appliances.ts` | `APPLIANCE_PINS` (`d1`–`d3`), `useAppliances()`: state subscription, toggle, pending / unconfirmed tracking |
| `apps/web/src/components/console/robot-feed.tsx` | Click regions (`DriveRegions`), Stop button, overlays above the regions |
| `apps/web/src/components/console/control-settings.tsx` | Password dialog and footer status chip |
| `apps/web/src/components/console/console.tsx` | Wiring: broker lifetime, drive card, safety stops, Appliances view (three cards) |
| `apps/web/src/components/console/use-dwell.ts` | Dwell won't fire for a card that appears under a pointer/gaze already resting there; it waits for the pointer to leave first (prevents switching an appliance by accident when opening the screen) |

---

## 6. Verified (2026-11-04)

Tested against the real broker, with a monitor subscribed over **MQTT/TCP 1883**, the same transport the ESP boards use. It used **dummy passwords**, so any real robot or board on the public broker ignored the test commands, and the simulated board replied with `retain: false` so it couldn't overwrite real retained state.

| Check | Result |
|---|---|
| Browser connects to `wss://broker.emqx.io:8084/mqtt` | ✅ "Connected" |
| L, R, U, F, S, B, D regions + Stop button | ✅ `{"password":"…","cmd":"L"}` … each with `qos=1 retain=false`, correct letter for every region |
| Click without a robot password | ✅ dialog opens, nothing sent |
| Click on the video pill (overlay) | ✅ nothing sent |
| F, then leave the page | ✅ best-effort `S` arrived |
| Clicks on the green waiting screen | ✅ nothing sent; Drive card shows "no video" |
| Appliance toggles → simulated board reply | ✅ `{"password":"…","pins":{"d1":"on"}}`; the card shows On and the others Off, from the state report |
| Wrong appliance password | ✅ sent, no reply → **No reply** + hint after 5 s |

The regions were exercised through a **temporary dev-only test feed** (a test-pattern JPEG on the same `fallbackFrameUrl` path the robot phone uses). It was removed afterwards. Not yet tested: a real robot or appliance board, and U/D on the firmware.
