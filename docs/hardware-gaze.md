# Robot hardware firmware and gaze contract

**Owner:** Arunya. **Paths:** existing ESP8266/ESP-12E firmware in `bot/`; planned gaze module in `apps/web/src/lib/gaze/`.

Use [firmware setup](firmware-setup.md), [MQTT commands](mqtt.md), [shared interfaces](interfaces.md), and [robot operation](robot-operation.md). `bot/platformio.ini` is the board/toolchain/dependency source of truth. The robot uses its existing motor wiring and a phone fixed to the same chassis.

## ESP8266 hardware and firmware

| Area | Current contract |
| --- | --- |
| Target | ESP-12E / ESP8266 with Arduino and the configured PlatformIO environments. |
| Networking | Provision through `Lain_Setup`; connect to the configured MQTT broker, not a laptop service. |
| Commands | Subscribe to `carbot/command`; normal app control comes from the mounted phone's signed-wheel envelope. |
| Motors | Use existing GPIOs, direction polarity, and 1–100 effort to 85–255 PWM mapping. See the wiring table in firmware setup. |
| Servo | Existing GPIO15 control and 60–180 degree range. |
| Phone timeout | Active phone control stops after more than 500 ms without accepted drive commands or on detected MQTT/Wi-Fi loss. |
| Status | Publish current output state to `carbot/status` every two seconds. |
| Credentials | Local ignored header for initial/setup passwords; EEPROM for provisioned Wi-Fi/control settings. No secrets in source or logs. |

The phone, not the ESP, computes gyro correction and validates application session/sequence/expiry. Firmware does not enforce a duration-based movement command, Topic 1 sequence numbers, or control-session ownership. Do not implement a second motor protocol beside the documented MQTT contract.

There are no IR reads, edge fallback maneuvers, IR lockouts, ultrasonic obstacle checks, or distance telemetry. The UI must not advertise obstacle protection. A physical motor-power cutoff is a hardware option for the supervised setup, not a firmware-reported state already implemented here.

Keep the phone rigidly attached, camera/screen facing the intended direction, speaker uncovered, and wiring consistent with the documented board. Maintain appropriate motor power and a common ground; motors are powered through the existing driver, not ESP GPIO. Do not apply another board's GPIO advice to this ESP8266 wiring. GPIO1 serves right-motor PWM after UART is disabled.

## Firmware validation and phone handoff

Build `bot/` using [the setup commands](firmware-setup.md#build). Never add passwords to MQTT examples or commit firmware binaries. Provision the matching board only during an authorized hardware session. With the phone controller, check forward/reverse/turn polarity, explicit disarm, gyro correction, missing-intention stopping, missing-phone-command stopping, and reconnect while disarmed.

Use a simulated MQTT receiver for frontend/backend work when hardware is unavailable. Direct plain wheel/direction commands exist for bench diagnostics, but they persist until changed and do not replace the mobile controller's timeout-enabled envelope. A published command is not evidence that the wheels moved.

## Gaze module

Provide the API in [shared interfaces](interfaces.md#browser-module-contracts): calibration, gaze points/confidence, tracking state, mouse fallback, shared camera stream, and cleanup. Large navigation zones and reply cards consume the same `data-gaze-target` dwell events.

Gaze selection starts a frontend intention state. Sahil's publisher owns the 100 ms heartbeat; the gaze module owns enter/leave/select/hold and reliable status changes. Lost or uncertain gaze must stop the active intention. The video center is a neutral area with no navigation action, and driving requires explicit enable.

Start with a validated gaze implementation and retain a mouse mode behind the same API. Smooth noise, prevent accidental target switching, and support recalibration after mount/user changes. Share the existing laptop camera stream with the media hook rather than opening it twice. Measure real selection accuracy, dwell behavior, and lost-tracking response under the demo lighting.

## Integration checkpoints

First agree board wiring, mount axes, and message contracts. Then provide firmware build/provisioning support and gaze mouse-mode events, integrate the phone's local controller, and validate calibrated gaze with supervised movement. Hand off measured gaze reliability and actual stop behavior for the demo. Obstacle avoidance is not an acceptance requirement of the current sensor-free firmware.
