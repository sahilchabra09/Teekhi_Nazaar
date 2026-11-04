# IRIS appliance board

A second ESP8266 runs three active-high outputs for the IRIS console’s appliance cards. Install this firmware on the appliance board. The robot uses the separate `bot/` project.

## Wiring

| Console / MQTT | NodeMCU label | ESP8266 pin | Function |
| --- | --- | --- | --- |
| `d1` | D1 | GPIO5 | Appliance 1 driver input |
| `d2` | D2 | GPIO4 | Appliance 2 driver input |
| `d3` | **D5** | **GPIO14** | Appliance 3 driver input |
| Setup | D6 | GPIO12 | Optional momentary switch to GND, sampled at boot |

Use 3.3 V-compatible active-high driver inputs, a common signal ground, and an external pull-down on each input to keep it off during reset. GPIOs only supply logic signals. A relay coil needs a suitable driver and separate power. Once the firmware starts, all three outputs are LOW (off). An `on` command drives the selected output HIGH, and a reboot returns all outputs to off.

The logical `d3` channel uses physical **D5**, so move its signal wire if it was connected to D3. Leave the boot-strap pins at their normal reset levels (D3/GPIO0 high, D4/GPIO2 high, D8/GPIO15 low).

## Build

From the repository root, select one PlatformIO environment.

```sh
uv sync --group firmware
# Apple Silicon
PLATFORMIO_CORE_DIR="$PWD/.platformio" uv run --group firmware pio run -d iot -e esp12e_arm64
# Intel macOS or Linux
PLATFORMIO_CORE_DIR="$PWD/.platformio" uv run --group firmware pio run -d iot -e esp12e
```

To install, select the appliance board’s USB port and add `-t upload --upload-port <port>` to its build command.

## Provision

1. Open the USB serial monitor at 115200 baud and reset the board. A new board starts setup automatically. To change saved settings, hold D6 to GND while resetting, then release D6. A failed Wi-Fi connection during boot also opens setup.
2. Join the `IRIS-Appliances-…` Wi-Fi network using the temporary key shown on USB. Open `http://192.168.4.1/`. The setup key changes each time setup starts.
3. Enter the 2.4 GHz Wi-Fi network and passphrase (blank for open Wi-Fi), MQTT TCP host and port, and a dedicated 8–63 byte appliance control password. Save to restart. Saved credentials stay in the board’s flash. The form does not display them.
4. Set the same appliance control password in the web console. The board and `NEXT_PUBLIC_MQTT_BROKER_URL` must point to the same broker, using its respective TCP and WebSocket listeners.

The board uses plain MQTT TCP (typically port 1883) without broker login. Use an access-controlled local network and broker for real devices. To match the console’s public demo endpoint, enter `broker.emqx.io` and `1883`. Anyone on that public topic can read the appliance password, replay commands, or publish state. Use a throwaway password and disconnected loads for public tests.

## MQTT contract

| Topic | Direction | Delivery |
| --- | --- | --- |
| `gazeconnect/appliances/control` | Console → board | QoS 1, retain false |
| `gazeconnect/appliances/state` | Board → console | QoS 0, retained |

A command accepts one or more channels. A wrong password, unknown channel or unsupported value rejects the whole command. Use lowercase `on` or `off` (`high` and `low` are also accepted).

```json
{"password":"<dedicated appliance password>","pins":{"d1":"on","d3":"off"}}
```

The board reports all three GPIO levels after connecting and after each accepted command. A retained report is the last observation and can outlive the board’s connection.

```json
{"d1":"on","d2":"off","d3":"off"}
```
