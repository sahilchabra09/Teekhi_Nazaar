# Patient console controls

The console uses the robot phone for driving and a separate ESP8266 for the two patient-facing appliance controls. Both use the browser's shared MQTT WebSocket connection. Set `NEXT_PUBLIC_MQTT_BROKER_URL` **before building the web app** to the WebSocket listener for your broker. The default demo endpoint is `wss://broker.emqx.io:8084/mqtt`. Configure the phone and appliance board to use the corresponding broker. **Settings** in the patient bar contains microphone and laptop camera selection, and MQTT connection status.

## Drive from the phone camera

For a shared robot, set `IRIS_ROBOT_OWNER_ID="*"` in the API server’s local environment. Any signed-in patient can pair a phone and dashboard under their own account. One pair holds the car at a time. A competing pair receives HTTP 409 while the current pair is renewing its grant. Disconnect that pair to hand over the car. The API reserves up to 10 seconds at startup or handoff for an earlier grant to expire. A specific user ID restricts driving to one owner. An empty setting disables drive grants.

1. Open the console on HTTPS or localhost for camera access and Web Crypto. On the mounted phone, enable the robot controller and configure its MQTT settings and ESP password. Start IRIS. Sign in to the laptop console with the same authorized account and choose **Connect phone** inside the robot video. Wait for a live camera picture.
2. On the phone, open **Session settings**, tap **Calibrate**, **Authorize**, then **Enable driving** once the robot is online.
3. In the patient dashboard choose **Setup**. After Screen 1 calibration and the accuracy check, look at or click **Continue to dashboard** to use **Drive**, **Communicate**, and **Appliances** with gaze. If accuracy is still unverified, choose **Open dashboard in preview** to navigate with the camera still running. Choose **Check gaze accuracy** in Setup to enable gaze control of actions such as answering calls, speaking messages, driving and switching appliances. Choose **Drive** to show the directional regions.
4. For mouse testing, go to **Settings → Use mouse gaze**. Move the mouse over the same card or video region and leave it there for 1.2 seconds. **Turn off mouse gaze** restores ordinary clicking. Both mouse gaze and validated eye input use the same drive controls and phone authorization.
5. Select **Drive**. Hold the top box to move forward, the bottom to reverse, or a side box to turn. Movement continues while you stay in that box. Leaving it brings the wheels to zero. After a 1.2-second hold in the next box, the robot moves in the new direction. The center **Stop** box leaves the wheels at zero, ready for another direction.
6. Select **Drive** again to exit and disarm. A connection, video, or tracking fault also stops the drive session. After a hard stop, explicitly enable driving on the phone before starting again. Phones older than IRIS 0.8.1 use a hard stop on each release.

To send a local camera view back to the phone, pick **Shared camera** in **Settings**, then choose **Share camera** in the video panel. If the picture drops during an authorized drive session, the center can still send a stop. Movement requires the robot picture. Controls require recent robot frames, a connected phone and broker, a current grant, and a fresh `ready` status from the calibrated phone with its ESP online. During a hold the phone may report `driving`. The console stops renewing if gaze or feed is lost, the tab loses focus or is hidden, a modal opens, or the grant, connection or mobile status becomes unusable. It attempts a signed stop for an active hold. The phone's intention timeout also disarms it if updates stop arriving.

### Drive protocol

| Path | Payload and delivery |
| --- | --- |
| Authenticated hub → browser | Private `drive_grant` with device, control session, 32-byte hex signing key, server epoch, lease expiry and maximum TTL. The key is held in memory. A matching `session_revoked` cancels the session. |
| Browser → MQTT Topic 1 → phone | `teekhi-nazaar/esp12e_carbot/intent`, `type: "drive_intent"`, QoS 1, retain false. One intention on acceptance and fresh intentions about every 100 ms during the hold. |
| Phone → MQTT Topic 1 → browser | Nonretained `type: "mobile_status"` for the same device and session. The console expires reports after 2.5 seconds. |
| Phone → MQTT Topic 2 → robot ESP | The phone validates signatures, sequence and TTL, computes wheel effort and sends the password-bearing `lain-mobile` motor envelope to `carbot/command`. |

Each intention names the device and control session, has a unique `command_id` and increasing integer `seq`, and uses `forward`, `backward`, `left`, `right`, `neutral` or `stop`. Speed uses a 0–100 scale. This console requests 35 for movement and 0 for neutral or stop. `sent_at` is an ISO 8601 UTC timestamp based on the server clock. `ttl_ms` is at most 300 ms and bounded by remaining lease time.

A phone advertising `supports_neutral: true` accepts signed `neutral` with speed 0. It immediately sends a QoS 1 zero-wheel command to the ESP and reports `ready` with the matching `last_command_id` if its enabled session is healthy. The browser waits for that acknowledgement before sending another direction. A missing acknowledgement escalates to a hard stop. `neutral` never enables a disabled or faulted phone.

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

Look at **Communicate** or **Quick phrases** for 1.2 seconds. The ring around the cursor and the fill on the card show measured progress. Looking away or losing tracking resets an incomplete selection. In dashboard preview, gaze can open navigation cards and choose a phrase to review. Every target shows dwell progress. The patient bar explains when an action needs verified gaze or when a board or phone is unavailable. Sample and prerecorded inputs show **Demo preview** and use the same navigation restrictions.

**Communicate** stays in the middle of the action panel. Select it to open the communication choices. Look away and select it again to return to the main actions. **Quick phrases** works the same way. It opens three phrase cards below the video, and selecting **Quick phrases** again closes them. Choosing a phrase opens a confirmation before anyone hears it.

In **Drive**, select **Drive** again to leave driving. Use the center **Stop** target to hold the wheels at zero while staying in Drive. During eye setup, select an available numbered step to revisit it.

## Answer a conversation request

The person at the robot taps **Request conversation** on the phone. One card in the patient’s **Actions** section becomes **Answer call** for up to 60 seconds. Select it once to answer. With gaze, look away and back if the new card appeared where you were already looking. Ignoring the request keeps the current screen and driving controls available.

The visitor speaks into the phone. The patient reads the transcribed speech and selects a reply or quick phrase. **Speak it** plays the message on the phone. Later messages wait while the patient chooses a reply. **Message options** includes quick phrases and choices for the current message.

The call stays open through silence, transcription and playback. **End call** closes it and releases the microphone. **Drive** also closes communication before opening the drive controls. If either device disconnects or loses authorization, starting again requires a fresh phone request and patient approval.

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
