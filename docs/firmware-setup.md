# ESP-12E firmware setup

The `bot/` firmware controls an ESP-12E robot over MQTT, with Wi-Fi provisioning, EEPROM credentials, signed motor effort, servo control, and a timeout for streamed mobile commands. It does not use IR sensors.

## Build

From the repository root, create the local credential header and replace both placeholder values with local passwords before building:

```sh
cp bot/include/bot_secrets.example.h bot/include/bot_secrets.h
# Edit bot/include/bot_secrets.h before continuing.
uv sync --group firmware
PLATFORMIO_CORE_DIR="$PWD/.platformio" uv run --group firmware pio run --project-dir bot --environment esp12e_arm64
```

`bot/include/bot_secrets.h` is ignored by Git. It defines `BOT_SETUP_AP_PASSWORD` (8–63 ASCII characters) and `BOT_DEFAULT_CONTROL_PASSWORD` (4–49 ASCII characters). The setup AP password controls access to provisioning; the initial control password is used only when no valid stored control password is loaded. Changing the header does not override an existing EEPROM password. Do not put real credentials in the committed example header or documentation.

Use `--environment esp12e` on Intel Mac/Linux. `esp12e_arm64` remains the default environment for Apple Silicon. PlatformIO downloads the configured toolchain/framework/libraries on the first build. `pyproject.toml` and `uv.lock` manage only PlatformIO tooling, separately from the existing Bun workspace.

## Upload

Connect the matching ESP-12E board, enter flash mode if your board requires it, and substitute its actual port:

```sh
PLATFORMIO_CORE_DIR="$PWD/.platformio" uv run --group firmware pio run --project-dir bot --environment esp12e_arm64 --target upload --upload-port /dev/cu.usbserial-0001
```

The upload command operates the real board. No upload or motor operation was performed while preparing this code.

## Wi-Fi setup

1. On first boot, or after saved-network connection attempts fail, connect to the existing `Lain_Setup` access point using `BOT_SETUP_AP_PASSWORD` from your local `bot/include/bot_secrets.h`.
2. Open `http://192.168.4.1` and set the control password (4–49 characters). Include it as `password` in MQTT payloads.
3. Scan for a 2.4 GHz network, select it, and save its Wi-Fi password. The ESP restarts and connects to Wi-Fi and MQTT.
4. Reconnect the command-sending device to an internet connection that can reach the same broker.

The setup page keeps the existing Wi-Fi scan/connect and control-password functions. The IR section is removed. The firmware retains the original EEPROM addresses/magic marker, so previously saved Wi-Fi/control credentials on the same board can still be read. Old IR settings are ignored. The setup web page is served in configuration mode, as before.

## Existing wiring

| Function | GPIO |
| --- | --- |
| Left motor PWM / ENA | 2 |
| Right motor PWM / ENB | 1 / TX |
| Left direction / IN1, IN2 | 14, 12 |
| Right direction / IN3, IN4 | 13, 16 |
| Camera servo | 15 |

Serial logging is disabled before GPIO1 is assigned to right motor PWM, including in setup mode. A0 and GPIO3 have no sensor role in this firmware. The existing servo range is 60–180 degrees, initially 90 degrees. Wheel effort keeps the original scaling: a nonzero absolute speed from 1–100 maps to PWM 85–255, while zero disables that wheel.

See [MQTT commands](mqtt.md) before publishing. For the planned frontend/backend → mounted mobile app → ESP flow, see [robot operation and team integration](robot-operation.md). The mounted phone will publish the existing ESP commands after applying gyro feedback.
