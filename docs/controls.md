# Patient console controls

The console uses the robot phone for driving and a separate ESP8266 for the two patient-facing appliance controls. Both use the browser's shared MQTT WebSocket connection. Set `NEXT_PUBLIC_MQTT_BROKER_URL` **before building the web app** to the WebSocket listener for your broker. The default demo endpoint is `wss://broker.emqx.io:8084/mqtt`. Configure the phone and appliance board to use the corresponding broker. **Settings** in the patient bar contains microphone and laptop camera selection, and MQTT connection status.

## Drive from the phone camera

1. Open the console on HTTPS or localhost for camera access and Web Crypto. On the mounted phone, enable the robot controller and configure its MQTT settings and ESP password. Start IRIS. Sign in to the laptop console with the same authorized account and choose **Connect phone** inside the robot video. Wait for a live camera picture.
2. On the phone, open **Session settings**, tap **Calibrate**, **Authorize**, then **Enable driving** once the robot is online.
3. In the patient dashboard choose **Setup**. After Screen 1 calibration and the accuracy check, look at or click **Continue to dashboard** to use **Drive**, **Communicate**, and **Appliances** with gaze. If accuracy is still unverified, choose **Check gaze accuracy** to enable selection, or **Open dashboard in preview** to see the gaze cursor with the camera still running. Preview uses touch or a mouse for selection. Reopen **Setup** to finish the check with the same camera. Choose **Drive** to show the directional regions.
4. Fixate on a labelled region of the phone video for 900 ms. Keep looking there to continue. The outer columns turn left and right. The middle column drives forward at the top, stops in the centre and reverses at the bottom. You can also press and hold a region with a pointer or focus it and hold Space or Enter.
5. Look away, release the control, or select **Stop** to end the movement. The red **Stop** target is in the center of the robot picture. While confirmation is pending, it reads **Retry stop**. Select it to send a fresh signed stop. The status below the picture shows when the phone reports that driving is disarmed. A stop disarms the phone. Tap **Enable driving** on the phone and make a new selection before the next movement.

To send a local camera view back to the phone, pick **Shared camera** in **Settings**, then choose **Share camera** in the video panel. If the picture drops during an authorized drive session, the center can still send a stop. Movement requires the robot picture. Controls require recent robot frames, a connected phone and broker, a current grant, and a fresh `ready` status from the calibrated phone with its ESP online. During a hold the phone may report `driving`. The console stops renewing if gaze or feed is lost, the tab loses focus or is hidden, a modal opens, or the grant, connection or mobile status becomes unusable. It attempts a signed stop for an active hold. The phone's intention timeout also disarms it if updates stop arriving.

### Drive protocol

| Path | Payload and delivery |
| --- | --- |
| Authenticated hub → browser | Private `drive_grant` with device, control session, 32-byte hex signing key, server epoch, lease expiry and maximum TTL. The key is held in memory. A matching `session_revoked` cancels the session. |
| Browser → MQTT Topic 1 → phone | `teekhi-nazaar/esp12e_carbot/intent`, `type: "drive_intent"`, QoS 1, retain false. One intention on acceptance and fresh intentions about every 100 ms during the hold. |
| Phone → MQTT Topic 1 → browser | Nonretained `type: "mobile_status"` for the same device and session. The console expires reports after 2.5 seconds. |
| Phone → MQTT Topic 2 → robot ESP | The phone validates signatures, sequence and TTL, computes wheel effort and sends the password-bearing `lain-mobile` motor envelope to `carbot/command`. |

Each intention names the device and control session, has a unique `command_id` and increasing integer `seq`, and uses `forward`, `backward`, `left`, `right` or `stop`. Speed uses a 0–100 scale. This console requests 35 for movement and 0 for stop. `sent_at` is an ISO 8601 UTC timestamp based on the server clock. `ttl_ms` is at most 300 ms and bounded by remaining lease time.

For `signature`, join the following field **values** with a single LF between each, using decimal integers and the exact timestamp string. Compute HMAC-SHA256 over these UTF-8 bytes with the decoded signing key and encode the result as lowercase hex. There is no trailing LF.

```text
device_id
control_session_id
command_id
seq
action
speed
sent_at
ttl_ms
```

The phone enforces authorization and drive readiness locally. A broker PUBACK records broker delivery. Phone `last_command_id` records accepted input. See the [robot operating contract](robot-operation.md) for the phone's wheel translation and the firmware watchdog.

## Navigate by gaze

**Communicate** stays in the middle of the action panel. Select it to open the communication choices. Look away and select it again to return to the main actions. **Quick phrases** works the same way. It opens three phrase cards below the video, and selecting **Quick phrases** again closes them. Choosing a phrase opens a confirmation before anyone hears it.

In **Drive**, select **Drive** again to leave driving. Use the center **Stop** target to disarm the phone while staying in Drive. During eye setup, select an available numbered step to revisit it.

## Approve a listening turn

The person at the robot requests the microphone on the phone. On the paired patient dashboard, open **Communicate → Listen and reply**. Select **Allow microphone** to begin one turn immediately, or **Decline**. A pending request expires after 60 seconds. Requests never open a screen over Drive.

During an approved turn, the phone shows a power-style **Stop microphone** button. Select it to finish early. It disappears when capture ends, including at the 30-second capture limit. Select **Drive** on the dashboard at any point to cancel and discard the turn. Opening Drive leaves movement subject to its usual authorization and directional hold. Speaking a reply returns to the listening page and requires a new request for the next turn.

With no connected phone, **Use laptop microphone** explicitly records one local turn. The camera choice and microphone selection are in **Settings**.

## Switch appliances

Choose **Appliances** to switch either of the two outputs below. Select the highlighted **Back to actions** card to return to the main menu. The signed-in console gets the configured appliance password from the web server automatically. The mounted phone keeps the robot's driving password separately.

| Card | MQTT key | NodeMCU pin | GPIO |
| --- | --- | --- | --- |
| Appliance 1 | `d1` | D0 | 16 |
| Appliance 2 | `d2` | D2 | 4 |

Wait for the board to report its state. Click a card or dwell on it to request the opposite state. The card shows the pending change until the board reports the requested output, or a timeout after five seconds. An incorrect password receives no confirmation.

| Topic | Direction | Example |
| --- | --- | --- |
| `gazeconnect/appliances/control` | Browser → board, QoS 1, retain false | `{"password":"<appliance password>","pins":{"d1":"on"}}` |
| `gazeconnect/appliances/state` | Board → browser, retained | `{"d1":"on","d2":"off","d3":"off"}` |

The appliance password travels inside each MQTT command. Use an access-controlled broker/network for real devices. For the board firmware, provisioning and driver wiring, see the [appliance board guide](../iot/README.md).

## Offline checks

From the repository root, run `cd apps/web && bun test tests`. The drive publisher tests use an in-memory sink, fake clock and synthetic session. They exercise wire signatures, held commands, cancellation during signing, grant changes, replayed readiness after release, stale status and stalled heartbeats. Physical movement and appliance switching need separate device acceptance.
