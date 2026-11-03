# Backend AI and web control contract

**Owner:** Sahil. **Paths:** `apps/server/`, `apps/web/`, and planned `packages/protocol/`. Arunya owns the gaze module; Harnoor owns the mounted Android app and media hook.

Use [shared MQTT interfaces](interfaces.md), [robot operation](robot-operation.md), and [team plan](PLAN.md). The backend owns authorization, active controller sessions, AI services, and application event handling. The mounted phone owns gyro translation and publishes wheel commands to the ESP8266.

## Backend responsibilities

| Deliverable | Expected behavior |
| --- | --- |
| MQTT integration | Publish/subscribe typed application events on Topic 1 and reject malformed, expired, or incorrectly targeted intentions. No direct motor publication to Topic 2. |
| Session ownership | Select one authenticated controller per robot. Give the phone a trusted session grant; a JSON session ID cannot grant itself access. |
| Shared schemas | Define proposed Topic 1 fields from [robot operation](robot-operation.md#mqtt-channels-and-message-contracts); mirror them in the phone app. Keep firmware fields unchanged. |
| Simulation | Provide a simulated phone consuming `drive_intent` and emitting `mobile_status`, with an output sink that does not operate motors. |
| Status | Consume mobile status and expose connection/calibration/session state to the frontend. Do not treat broker delivery as proof of motion. |
| Speech and AI | Accept utterance uploads, perform recognition, publish transcript and three candidate replies, and provide a canned fallback. |
| Diagnostics | Log IDs, message types, state transitions, and timings; redact credentials and avoid recording private speech without consent. |

Every normal movement intention goes to the mounted phone. Gaze loss, released input, revoked ownership, and backend automation cancellation stop the relevant intention stream and issue an authorized stop. The phone independently expires stale input, even if the backend fails to send a final message.

Broker authentication and topic permissions must protect the application and ESP command topics. Keep backend provider keys in ignored environment configuration. Existing auth/database wiring remains in place; implementation changes to it require a separate task.

## Frontend responsibilities

The web UI connects to MQTT using the broker browser transport and consumes only the application events relevant to its robot/session. It publishes high-level directions and speed, not signed wheel effort or the ESP password. Keep the drive toggle off until deliberate enable, fresh readiness, calibrated phone orientation, and valid ownership are present.

Navigation zones use dwell to select a direction. A dedicated timer renews the intention every 100 ms while that zone is active; proposed TTL is 300 ms. On leaving, gaze becoming uncertain/lost, page inactivity, disabled driving, or session loss, stop the timer and publish a stop. Do not resume an old movement after reconnect. The 300 ms TTL is a proposed upstream rule; it is not an ESP movement-duration guarantee.

Maintain a live-video area and three large vertically stacked response cards. The center of the video has no movement action. Show broker, phone, ESP, calibration, gaze, and session state separately. ESP status is periodic, so do not promise a one-second physical disconnect indication or invent obstacle telemetry.

## Conversation and confirmation

```text
phone utterance → backend HTTPS upload → speech recognition
               → transcript on Topic 1 → three reply suggestions on Topic 1
user selection → explicit confirmation → speak on Topic 1 → phone TTS
```

Keep the user's choice in control: the model produces candidate replies and never emits motor commands or speaks on its own. Validate structured output, show uncertain recognition clearly, and provide Repeat/Ignore and a custom-response option. Keep API/model selection in local backend configuration rather than coupling protocol schemas to one provider.

| Card state | Behavior |
| --- | --- |
| Home | Talk, quick phrases, and Help/recalibration entry points. |
| Suggestions | Three candidate responses; selection enters confirmation. |
| Low confidence | Repeat, Ignore, or compose another response. |
| Confirm | Preview, Speak, or Cancel. New suggestions do not replace the selected text. |
| Speaking | Display current speech and wait for matching `tts_status`; queue new suggestions. |

Speech uploads and media callbacks must not block intention publication or stop handling. Measure actual speech-to-card latency, gaze-selection reliability, and stale-control stopping behavior.

## Dependencies and acceptance

Use a mouse implementation behind the gaze API until Arunya's module is ready. Use the simulated phone for application events until the Android app is ready. The media hook receives an MQTT signalling adapter, not a separate application command connection. Reuse the gaze module's existing camera stream for optional outbound laptop video.

Demonstrate target filtering, one controller per robot, duplicate/expired intention rejection, explicit stop, missing-heartbeat disarm, stale ESP state, reconnect without resuming movement, and confirmed speech. Current firmware has no obstacle sensor or per-command execution acknowledgement. The exact ESP timeout and payload limits are documented in [MQTT commands](mqtt.md).
