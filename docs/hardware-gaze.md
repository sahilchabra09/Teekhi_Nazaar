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

The phone, not the ESP, computes gyro correction and validates application session/sequence/expiry. Firmware does not enforce a duration-based movement command, Topic 1 sequence numbers, or control-session ownership. The phone also has a backend WebSocket connection for non-movement application events. The ESP remains an MQTT client; do not connect it to the backend WebSocket hub or introduce another motor protocol.

There are no IR reads, edge fallback maneuvers, IR lockouts, ultrasonic obstacle checks, or distance telemetry. The UI must not advertise obstacle protection. A physical motor-power cutoff is a hardware option for the supervised setup, not a firmware-reported state already implemented here.

Keep the phone rigidly attached, camera/screen facing the intended direction, speaker uncovered, and wiring consistent with the documented board. Maintain appropriate motor power and a common ground; motors are powered through the existing driver, not ESP GPIO. Do not apply another board's GPIO advice to this ESP8266 wiring. GPIO1 serves right-motor PWM after UART is disabled.

## Firmware validation and phone handoff

Build `bot/` using [the setup commands](firmware-setup.md#build). Never add passwords to MQTT examples or commit firmware binaries. Provision the matching board only during an authorized hardware session. With the phone controller, check forward/reverse/turn polarity, explicit disarm, gyro correction, missing-intention stopping, missing-phone-command stopping, and reconnect while disarmed.

Use a simulated MQTT receiver for frontend/backend work when hardware is unavailable. Direct plain wheel/direction commands exist for bench diagnostics, but they persist until changed and do not replace the mobile controller's timeout-enabled envelope. A published command is not evidence that the wheels moved.

## Screen 1 in the patient console

Open **Setup** beside the patient’s name on localhost or HTTPS. Select the head-mounted eye camera or its network video stream. The camera on the robot phone supplies the driving view. Frame the eye, build and lock the eye model, and optionally add a separate front camera for head compensation. Follow the nine screen calibration points and the accuracy check. Once the accuracy check passes, the gaze pointer activates over the video and cards. Hold your gaze on **Drive**, **Communicate**, or **Appliances** to enter that activity.

Hold your gaze on a card or video region until its dwell completes. Appliance cards send one on/off request per fixation. Look away and back to switch it again. The label follows the appliance board’s state report. Enter the appliance control password in the console settings. See the [appliance board setup](../iot/README.md) for the three output channels.

The tracker maps camera measurements into normalized viewport coordinates and hit-tests visible console targets. Moving off a target, losing valid tracking, opening settings or hiding the page ends a hold. A screen resize requires calibration again. Choose **Setup** to review the eye camera and calibration. The separate **Settings** panel configures the conversation microphone, the laptop camera to share with the phone, and the appliance connection.

Run `bun install` from the repository root before starting the website. The web dev and build commands prepare the local vision runtime. Eye detection and calibration run in browser workers. The [control guide](controls.md) covers robot and appliance settings.
