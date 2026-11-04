# IRIS appliance board

The patient dashboard controls two appliances on a second ESP8266. The firmware supports three active-high outputs. Install this firmware on the appliance board. The robot uses the separate `bot/` project.

## Wiring

| Console / MQTT | NodeMCU label | ESP8266 pin | Function |
| --- | --- | --- | --- |
| `d1` | **D0** | **GPIO16** | Appliance 1 driver input |
| `d2` | D2 | GPIO4 | Appliance 2 driver input |
| `d3` | **D5** | **GPIO14** | Spare output |
| Setup | D6 | GPIO12 | Optional momentary switch to GND, sampled at boot |

Use 3.3 V-compatible active-high driver inputs, a common signal ground, and an external pull-down on each input to keep it off during reset. GPIOs only supply logic signals. A relay coil needs a suitable driver and separate power. Once the firmware starts, all three outputs are LOW (off). An `on` command drives the selected output HIGH, and a reboot returns all outputs to off.

The logical `d3` channel uses physical **D5**, so move its signal wire if it was connected to D3. Leave the boot-strap pins at their normal reset levels (D3/GPIO0 high, D4/GPIO2 high, D8/GPIO15 low).

## Build

Copy `iot/src/local_credentials.h.example` to `iot/src/local_credentials.h`. Set `setupPassword` to the setup network’s 8–63 byte passphrase and `appliancePassword` to the control password. Set `APPLIANCE_CONTROL_PASSWORD` to the same control value in `apps/web/.env.local` or the web server environment. Git ignores both local files.

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

1. Join the board’s `IRIS-Appliances-…` setup network with the configured setup passphrase. A new board opens setup automatically. To change saved Wi-Fi, hold D6 to GND while resetting and then release it.
2. Open `http://192.168.4.1/`, select your 2.4 GHz network (or enter its name manually), and enter its Wi-Fi password. Leave the password blank for open Wi-Fi.
3. Select **Save network and connect**. The board keeps the portal open while checking the connection. A successful connection saves the Wi-Fi settings and restarts the board. Existing appliance Wi-Fi credentials are read from the same flash layout on upgrade.
4. Rejoin your usual network and open **Appliances** in the console. The firmware connects to `broker.emqx.io:1883` and accepts the configured appliance password. The web server supplies this value to the console. No appliance password entry is needed.

The console defaults to the same broker’s WebSocket listener. For a custom deployment, keep the firmware broker and credential constants in sync with the web app’s `NEXT_PUBLIC_MQTT_BROKER_URL` and `APPLIANCE_CONTROL_PASSWORD`. These demo commands are visible to subscribers on the public broker.

## MQTT contract

| Topic | Direction | Delivery |
| --- | --- | --- |
| `gazeconnect/appliances/control` | Console → board | QoS 1, retain false |
| `gazeconnect/appliances/state` | Board → console | QoS 0, retained |

A command accepts one or more channels. A wrong password, unknown channel or unsupported value rejects the whole command. Use lowercase `on` or `off` (`high` and `low` are also accepted).

```json
{"password":"<appliance password>","pins":{"d1":"on","d3":"off"}}
```

The board reports all three GPIO levels after connecting and after each accepted command. A retained report is the last observation and can outlive the board’s connection.

```json
{"d1":"on","d2":"off","d3":"off"}
```
