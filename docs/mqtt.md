# MQTT command reference

## Connection and authentication

| Setting | Value |
| --- | --- |
| ESP broker | `broker.emqx.io` |
| ESP transport | MQTT/TCP, port `1883` |
| Optional browser transport | `wss://broker.emqx.io:8084/mqtt` |
| Command topic | `carbot/command` |
| Status topic | `carbot/status` |
| Device ID | `esp12e_carbot` |
| Broker authentication | None configured (`mqtt_user` / `mqtt_password` are empty). |
| Command authentication | Include `password` matching the ESP's EEPROM control password, set through the Wi-Fi setup page. |

Publish command messages with **retain=false** so a new subscription does not replay a previous movement. The ESP subscribes at QoS 1. There is no sensor topic in this firmware. The broker topics and device ID are shared identifiers, so other clients using them may also receive these commands.

The payload password does not authenticate a broker connection. The retained ESP transport is unencrypted and uses a public broker; use the existing bench setup accordingly.

## Signed wheel values

This format already exists; it has not been redesigned:

```json
{"password":"YOUR_CONTROL_PASSWORD","left":40,"right":40}
```

`left` and `right` must both be JSON integers. Normal input range is **-100 to +100**. The sign selects each wheel's direction; the absolute value sets its effort. Zero stops that wheel. These are relative motor commands, not measured speed, RPM, or distance per second. The original minimum-effort scaling is preserved: absolute values 1–100 map to PWM values 85–255.

| Movement | `left` | `right` |
| --- | ---: | ---: |
| Forward | 40 | 40 |
| Backward | -40 | -40 |
| Turn left in place | -40 | 40 |
| Turn right in place | 40 | -40 |
| Curve left while moving forward | 20 | 40 |
| Curve right while moving forward | 40 | 20 |
| Stop | 0 | 0 |

Motor polarity follows the documented robot wiring. Equal positive values mean forward on that setup. Different wheel efforts create a curve; opposite signs turn in place. These plain commands do not require a device ID or phone metadata. Out-of-range integer wheel values are clamped by the original motor function.

## Direction plus speed

The original direction-command format also works:

```json
{"password":"YOUR_CONTROL_PASSWORD","cmd":"F","speed":40}
```

| `cmd` | Movement | Wheel values at speed `s` |
| --- | --- | --- |
| `F` | Forward | `(s, s)` |
| `B` | Backward | `(-s, -s)` |
| `L` | Turn left in place | `(-s, s)` |
| `R` | Turn right in place | `(s, -s)` |
| `S` | Stop | `(0, 0)` |

Use uppercase command letters and a **nonnegative integer `speed` from 0–100**. Missing `speed` defaults to 50; `S` ignores speed. Direction is chosen by `cmd`, so use positive speed here. If both valid `left`/`right` values and `cmd` appear in a plain command, the wheel values take precedence.

**Plain wheel/direction commands persist until another command changes them.** They do not use the phone path's 500 ms timeout or its connection-loss stop. This behavior is unchanged. Publish `{"password":"YOUR_CONTROL_PASSWORD","cmd":"S"}` to stop.

## Existing streamed control with timeout

For a continuously controlled robot, Teekhi Nazaar can use the existing phone envelope so loss of fresh commands stops the motors:

```json
{
  "password": "YOUR_CONTROL_PASSWORD",
  "source": "lain-mobile",
  "device_id": "esp12e_carbot",
  "phone_control": true,
  "armed": true,
  "left": 40,
  "right": 40,
  "cmd": "F",
  "pitch_deg": 0,
  "roll_deg": 0,
  "yaw_deg": 0
}
```

- `source:"lain-mobile"` and `phone_control:true` select the existing timeout behavior. Keep this source string even when Teekhi Nazaar is the publisher; the firmware uses it as a compatibility marker.
- `device_id` must match `esp12e_carbot`. Plain commands do not check `device_id`.
- `left` and `right` are required integers in **-100..100**; values outside that range are rejected on this path.
- Send commands regularly, for example every 100 ms. Active phone control stops when no accepted fresh drive command has arrived for more than 500 ms, or Wi-Fi/MQTT disconnects.
- `armed:false` stops immediately (still include `left` and `right`). `armed` defaults to true when omitted, but publishers should send it explicitly.
- Wheel values control actual movement. `cmd` is only a direction label on this path; `speed` is not used. `pitch_deg`, `roll_deg`, and `yaw_deg` are optional telemetry in degrees, defaulting to zero and clamped to ±180; the ESP does not derive wheel commands from them.
- There are no IR checks, edge interrupts, automatic recovery maneuvers, or edge lockout to clear.

Example stop/disarm (QoS 1, retain=false):

```json
{"password":"YOUR_CONTROL_PASSWORD","source":"lain-mobile","device_id":"esp12e_carbot","phone_control":true,"armed":false,"left":0,"right":0,"cmd":"S"}
```

Choose one command mode per driving session. Plain commands do not reset an already active phone-control timer, so mixing the two modes can cause a subsequent timeout stop.

## Servo and existing autonomous flag

Plain commands can include `servo` (integer degrees, clamped to 60–180) or `autonomous` (boolean), alongside wheel/direction fields:

```json
{"password":"YOUR_CONTROL_PASSWORD","servo":90,"autonomous":false,"left":0,"right":0}
```

These fields are processed before plain movement commands. A phone-envelope command returns through its own branch and does not process `servo`; send a separate plain servo command if needed. `autonomous` only sets the original status flag; it does not start autonomous driving. Accepted armed phone commands clear that flag, as before.

Malformed JSON, wrong passwords, and phone commands targeting a different device are ignored. Unknown direction commands do not change wheel output.

## Status

The ESP publishes a minimal online message on MQTT connect and full status every two seconds on `carbot/status`:

```json
{
  "device_id": "esp12e_carbot",
  "status": "online",
  "left_speed": 40,
  "right_speed": 40,
  "servo_angle": 90,
  "autonomous_mode": false,
  "phone_control_active": true,
  "phone_direction": "F",
  "phone_pitch_deg": 0,
  "phone_roll_deg": 0,
  "phone_yaw_deg": 0,
  "rssi": -55,
  "uptime": 12
}
```

Wheel values are signed effort; servo/phone angles are degrees; RSSI is dBm; uptime is seconds. Phone fields describe the phone-control path, while `left_speed` / `right_speed` describe current motor output. There are no IR or edge fields or alerts. The existing firmware does not publish an MQTT Last Will/offline message; a controller should expire stale status locally.
