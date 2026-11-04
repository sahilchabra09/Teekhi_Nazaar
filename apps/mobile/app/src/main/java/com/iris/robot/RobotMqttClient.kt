package com.iris.robot

import android.os.SystemClock
import com.iris.robot.core.*
import kotlinx.coroutines.*
import kotlinx.serialization.encodeToString
import org.eclipse.paho.client.mqttv3.*
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence
import java.net.URI
import java.util.UUID

class RobotMqttClient(
    private val settings: RobotSettings,
    private val controller: DriveController,
    private val scope: CoroutineScope,
    private val changed: (MobileStatus) -> Unit,
    private val error: (String) -> Unit,
) : AutoCloseable {
    private val intentTopic = "teekhi-nazaar/${controller.deviceId}/intent"
    private var client: MqttAsyncClient? = null
    private var retry: Job? = null
    private var loop: Job? = null
    private var closed = false
    private var online = false
    private var connecting = false
    private var attempts = 0
    private var lastOutput = DriveOutput()
    private var lastStatus = 0L
    private var lastState = ""

    fun start() {
        require(settings.espPassword.length in 4..49) { "ESP password must have 4–49 characters" }
        val uri = URI(settings.broker)
        require(uri.scheme in setOf("tcp", "ssl", "ws", "wss") && !uri.host.isNullOrBlank() && uri.userInfo == null) { "Enter an MQTT tcp, ssl, ws or wss broker URL" }
        client = MqttAsyncClient(settings.broker, "iris-${UUID.randomUUID().toString().take(12)}", MemoryPersistence()).also { mqtt ->
            mqtt.setCallback(object : MqttCallback {
                override fun connectionLost(cause: Throwable?) { scope.launch(Dispatchers.Main.immediate) { disconnected() } }
                override fun messageArrived(topic: String, message: MqttMessage) {
                    if (message.payload.size > 16_384) return
                    val raw = message.payload.toString(Charsets.UTF_8)
                    scope.launch(Dispatchers.Main.immediate) {
                        if (closed || !online) return@launch
                        if (topic == intentTopic) {
                            val intent = runCatching { Protocol.json.decodeFromString<DriveIntent>(raw) }.getOrNull() ?: return@launch
                            val now = SystemClock.elapsedRealtime()
                            val wasEnabled = controller.enabled
                            val accepted = controller.accept(intent, message.isRetained, now)
                            val neutral = accepted && intent.action == "neutral"
                            if (neutral || (!controller.enabled && (accepted || wasEnabled))) {
                                stopOutput()
                                publishStatus(controller.status(now), now, 1)
                            }
                        } else if (topic == "carbot/status" && !message.isRetained) {
                            val status = runCatching { Protocol.json.decodeFromString<EspStatus>(raw) }.getOrNull() ?: return@launch
                            // Minimal online and malformed/other-device status do not satisfy readiness.
                            if (status.device_id == controller.deviceId && status.status == "online" && status.left_speed in -100..100 &&
                                status.right_speed in -100..100 && status.uptime != null && status.phone_control_active != null) {
                                controller.espSeen(SystemClock.elapsedRealtime(), status.servo_angle)
                            }
                        }
                    }
                }
                override fun deliveryComplete(token: IMqttDeliveryToken?) = Unit
            })
        }
        connect()
        loop = scope.launch {
            while (isActive) {
                val now = SystemClock.elapsedRealtime()
                val output = controller.tick(now)
                if (online) {
                    if (output.armed) publishOutput(output, 0)
                    else if (lastOutput.armed || (output.servo != null && lastOutput.servo == null)) stopOutput()
                    // Wheel disarm goes first when changing from driving to camera tilt.
                    // The ESP handles servo only in a separate, non-phone-control packet.
                    val angle = output.servo
                    if (online && angle != null && angle != lastOutput.servo) {
                        publish("carbot/command", Protocol.json.encodeToString(ServoCommand(settings.espPassword, angle)), 1)
                    }
                    val status = controller.status(now)
                    if (now - lastStatus >= 1000 || status.state != lastState) {
                        publishStatus(status, now, 0)
                    }
                }
                lastOutput = output
                changed(controller.status(now))
                delay(100)
            }
        }
    }
    private fun connect() {
        if (closed || connecting) return
        val mqtt = client ?: return
        connecting = true
        val options = MqttConnectOptions().apply {
            isCleanSession = true; isAutomaticReconnect = false; connectionTimeout = 5; keepAliveInterval = 5; maxInflight = 5
            isHttpsHostnameVerificationEnabled = true
            if (settings.brokerUser.isNotBlank()) { userName = settings.brokerUser; password = settings.brokerPassword.toCharArray() }
            val stop = WheelCommand(settings.espPassword, 0, 0, false, "S")
            setWill("carbot/command", Protocol.json.encodeToString(stop).toByteArray(), 1, false)
        }
        try { mqtt.connect(options, null, object : IMqttActionListener {
            override fun onSuccess(token: IMqttToken?) { scope.launch(Dispatchers.Main.immediate) {
                if (closed) return@launch
                connecting = false; online = true; attempts = 0
                controller.connectivity(true); stopOutput()
                mqtt.subscribe(arrayOf(intentTopic, "carbot/status"), intArrayOf(1, 0), null, object : IMqttActionListener {
                    override fun onSuccess(token: IMqttToken?) = Unit
                    override fun onFailure(token: IMqttToken?, exception: Throwable?) { scope.launch { disconnected() } }
                })
            } }
            override fun onFailure(token: IMqttToken?, exception: Throwable?) { scope.launch(Dispatchers.Main.immediate) { disconnected() } }
        }) } catch (_: Exception) { disconnected() }
    }
    private fun disconnected() {
        if (closed) return
        online = false; connecting = false; controller.connectivity(false)
        changed(controller.status(SystemClock.elapsedRealtime()))
        retry?.cancel()
        retry = scope.launch {
            delay((500L shl attempts.coerceAtMost(6)).coerceAtMost(30_000)); attempts++
            withContext(Dispatchers.IO) { runCatching { if (client?.isConnected == true) client?.disconnectForcibly(0, 0, false) } }
            connect()
        }
    }
    private fun publishStatus(status: MobileStatus, now: Long, qos: Int) {
        publish(intentTopic, Protocol.json.encodeToString(status), qos)
        lastStatus = now
        lastState = status.state
    }
    private fun publishOutput(output: DriveOutput, qos: Int) {
        val pose = controller.pose
        val body = WheelCommand(settings.espPassword, output.left, output.right, output.armed, output.cmd,
            pitch_deg = pose?.pitch ?: 0.0, roll_deg = pose?.roll ?: 0.0, yaw_deg = pose?.heading ?: 0.0)
        publish("carbot/command", Protocol.json.encodeToString(body), qos)
    }
    fun stopOutput() { publishOutput(DriveOutput(), 1); lastOutput = DriveOutput() }
    fun stop(reason: String) { controller.disarm(reason); stopOutput(); changed(controller.status(SystemClock.elapsedRealtime())) }
    private fun publish(topic: String, raw: String, qos: Int) {
        if (!online || closed) return
        try { client?.publish(topic, raw.toByteArray(), qos, false) }
        catch (_: Exception) { controller.disarm("MQTT publish failed"); error("Robot publish failed; disarmed"); disconnected() }
    }
    override fun close() {
        if (closed) return
        controller.active(false); stopOutput()
        online = false; closed = true; retry?.cancel(); loop?.cancel()
        val mqtt = client; client = null
        // Independent scope lets the stop packet drain even when the app session scope is cancelled.
        CoroutineScope(Dispatchers.IO).launch {
            runCatching { mqtt?.disconnectForcibly(150, 250, true) }; runCatching { mqtt?.close(true) }
        }
    }
}
