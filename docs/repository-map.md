# Repository map

## Components

| Path | Responsibility |
| --- | --- |
| `apps/web/`, `apps/server/`, `packages/` | Better Auth web console and API, account-bound phone sign-in codes and authenticated media relay. STT/AI suggestions and robot ownership/MQTT publisher grants remain integration work. |
| `apps/mobile/` | Native IRIS Android companion with the frontend's clay styling, shared account sign-in, secure credential storage, Kotlin protocol/audio/controller core and device checklist. The development mock is an isolated protocol-test fixture. |
| `bot/src/main.cpp` | ESP-12E firmware for motor/servo control and Wi-Fi provisioning, without IR sensors. |
| `bot/platformio.ini` | Board, framework, library dependencies, serial speeds, and Apple Silicon compiler configuration. |
| `pyproject.toml`, `uv.lock` | Independent uv-managed PlatformIO tooling; the Bun workspace continues to manage the web/server apps. |
| `docs/firmware-setup.md` | Firmware build, upload, provisioning, and wiring instructions. |
| `docs/mqtt.md` | MQTT topics, authentication, command fields, units, ranges, and examples. |
| `docs/robot-operation.md` | Frontend/backend/mobile integration, proposed Topic 1 contract, existing ESP Topic 2 contract, gyro control, and password/security responsibilities. |
| `docs/PLAN.md`, `docs/interfaces.md` | Team ownership, MQTT movement routing, WebSocket application routing, control/session rules, and planned media/conversation events. |
| `docs/backend-web.md`, `docs/mobile.md`, `docs/hardware-gaze.md` | Component contracts for MQTT movement and WebSocket application links. |

The firmware is an independent component of this workspace. Build outputs, installed tools, and `bot/include/bot_secrets.h` stay local and are excluded from Git. The committed `bot/include/bot_secrets.example.h` contains configuration placeholders.

## Firmware behavior

The firmware provides Wi-Fi station connection, `Lain_Setup` provisioning, EEPROM credentials, password checks, MQTT reconnection, motor direction/PWM control, servo control, and a phone-control timeout. `autonomous` remains the existing stored/reported flag; it does not implement a navigation routine.

Removed: both IR inputs, sampling/debounce, threshold/polarity storage, edge recovery maneuvers, edge lockout/re-arm handling, sensor alerts, IR status fields, and setup-page sensor controls/endpoints. No code configures or reads A0 or GPIO3 for sensors. There is no automatic response to a desk edge.

## MQTT interface

- Broker: `broker.emqx.io:1883` over MQTT/TCP, with no broker username/password configured. Browser clients can use `wss://broker.emqx.io:8084/mqtt`.
- Commands: publish JSON to `carbot/command`; the ESP subscribes at QoS 1. Each command requires the `password` configured on the ESP setup page. See [the command reference](mqtt.md) for both existing command formats.
- Wheel values: `left` and `right`, integers from **-100 to +100**, dimensionless motor effort. Positive is forward; negative is reverse; zero stops that wheel.
- Direction format: `cmd` is `F`, `B`, `L`, `R`, or `S`; `speed` is a nonnegative integer from **0 to 100** (default 50).
- Servo: `servo`, integer degrees, clamped to **60–180**.
- Status: JSON on `carbot/status` with `device_id:"esp12e_carbot"`, online state, wheel/servo output, autonomous flag, phone-control data, RSSI in dBm, and uptime in seconds. A minimal online message is published at MQTT connection and full status follows every two seconds.
- `carbot/sensors` and all IR/edge status fields have been removed. The mobile app consumes the remaining full ESP status.
- The existing phone envelope uses `source:"lain-mobile"`, `phone_control:true`, and `device_id:"esp12e_carbot"`. This path enforces a 500 ms command timeout and stops on MQTT/Wi-Fi loss. Plain wheel/direction commands keep the original persistent behavior.

The broker and device ID/topics form the current interface. Other clients using the same shared topics may receive or send robot messages; coordinate a single controller per robot. The payload password is an application check, not broker authentication, and the ESP MQTT connection is unencrypted.

## Mobile integration

The [robot operation guide](robot-operation.md) describes the two-command-channel architecture. Frontend/backend send high-level intentions on Topic 1; the mounted phone combines them with orientation feedback and publishes the existing timeout-enabled wheel envelope to `carbot/command` (Topic 2). The ESP status channel remains `carbot/status`. Phone-side translation and Topic 1 validation are implemented in [apps/mobile](../apps/mobile/README.md). Backend publishers, authenticated session coordination, and hardware tuning/acceptance remain integration work; see the [mobile backend contract](../apps/mobile/docs/backend-integration.md).

Frontend ↔ backend and backend ↔ phone WebSocket connections carry session, conversation, and media-signalling events; movement intentions and ESP wheel commands remain on MQTT.
