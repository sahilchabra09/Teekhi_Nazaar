package com.iris.robot.core

import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import kotlin.math.roundToInt

data class Pose(val heading: Double, val pitch: Double, val roll: Double, val yawRate: Double, val atMs: Long)
data class DriveOutput(val left: Int = 0, val right: Int = 0, val armed: Boolean = false, val cmd: String = "S", val servo: Int? = null)

/** All entry points are called on one controller thread. Times are monotonic milliseconds. */
class DriveController(val deviceId: String = "esp12e_carbot") {
    var connected = false; private set
    var backendConnected = false; private set
    var calibrated = false; private set
    var enabled = false; private set
    var reason = "Connect the robot"; private set
    var pose: Pose? = null; private set
    var targetHeading = 0.0; private set
    var output = DriveOutput(); private set
    var sessionId: String? = null; private set
    var lastCommandId: String? = null; private set
    private var espAt = Long.MIN_VALUE
    private var grant: SessionGrant? = null
    private var intentMac: Mac? = null
    private var grantAt = 0L
    private var grantExpires = 0L
    private var clockUpperBound = 0L
    private var sequence = -1L
    private val commandIds = LinkedHashSet<String>()
    private var command: String? = null
    private var requestedSpeed = 0
    private var servoTarget: Int? = null
    private var servoReportedAt: Long? = null
    private var nextServoStepAt = 0L
    private var intentExpires = 0L
    private var foreground = true

    fun connectivity(value: Boolean) {
        connected = value
        if (!value) { espAt = Long.MIN_VALUE; servoTarget = null; servoReportedAt = null; revoke("Broker disconnected") }
        else disarm("Connected; calibrate and fetch a session")
    }
    fun backendConnectivity(value: Boolean) {
        backendConnected = value
        if (!value) revoke("Backend hub disconnected")
    }
    fun espSeen(now: Long, servoAngle: Int? = null) {
        espAt = now
        if (servoAngle == null || servoAngle !in 60..180) {
            servoReportedAt = null
            servoTarget = null
        } else {
            // During a hold the ESP may still be reporting our previous target.
            if (servoTarget == null || (command != "U" && command != "D")) servoTarget = servoAngle
            servoReportedAt = now
        }
    }
    fun updatePose(value: Pose) {
        if (listOf(value.heading, value.pitch, value.roll, value.yawRate).all { it.isFinite() }) pose = value
        else { calibrated = false; disarm("Invalid orientation") }
    }
    fun calibrate(now: Long): Boolean {
        disarm("Calibration changed; enable explicitly")
        calibrated = pose?.let { now - it.atMs in 0..250 } == true
        if (calibrated) targetHeading = pose!!.heading
        else reason = "Fresh orientation and gyro required"
        return calibrated
    }
    fun grant(value: SessionGrant, receivedAt: Long, roundTripMs: Long): Boolean {
        if (value.device_id != deviceId || value.control_session_id.isBlank() ||
            !HEX_256.matches(value.signing_key) || value.max_ttl_ms !in 1..300 || roundTripMs !in 0..2000 ||
            value.expires_at_ms <= value.server_time_ms + roundTripMs ||
            value.expires_at_ms - value.server_time_ms > 60_000) {
            revoke("Invalid session grant or clock uncertainty")
            return false
        }
        if (value.control_session_id != sessionId || grant?.signing_key != value.signing_key) revoke("Session changed; enable explicitly")
        else if (grant != null && receivedAt >= grantExpires) disarm("Session lease expired; enable explicitly")
        intentMac = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(decodeHex(value.signing_key), "HmacSHA256")) }
        grant = value
        sessionId = value.control_session_id
        grantAt = receivedAt
        clockUpperBound = value.server_time_ms + roundTripMs
        // Conservatively subtract the full request RTT from usable grant lifetime.
        grantExpires = receivedAt + value.expires_at_ms - value.server_time_ms - roundTripMs
        return true
    }
    fun revoke(why: String) {
        disarm(why); grant = null; intentMac = null; sessionId = null; sequence = -1; commandIds.clear()
    }
    fun active(value: Boolean) {
        foreground = value
        if (!value) { calibrated = false; pose = null; revoke("App inactive") }
    }
    fun fault(why: String, loseCalibration: Boolean = false) {
        if (loseCalibration) calibrated = false
        disarm(why)
    }
    fun readiness(now: Long): String? = when {
        !foreground -> "App inactive"
        !connected -> "Broker disconnected"
        !backendConnected -> "Backend hub disconnected"
        !calibrated -> "Calibrate the mounted phone"
        pose == null || now - pose!!.atMs !in 0..250 -> "Orientation or gyro stale"
        espAt == Long.MIN_VALUE || now - espAt !in 0..6000 -> "Waiting for full ESP status"
        grant == null || now >= grantExpires -> "Fetch an authorized backend session"
        else -> null
    }
    fun enable(now: Long): Boolean {
        val problem = readiness(now)
        if (problem != null) { disarm(problem); return false }
        enabled = true; command = null; output = DriveOutput(); reason = "Ready; waiting for fresh intention"
        return true
    }
    fun accept(value: DriveIntent, retained: Boolean, now: Long): Boolean {
        val code = when (value.action) {
            "F", "forward" -> "F"
            "B", "backward" -> "B"
            "L", "left" -> "L"
            "R", "right" -> "R"
            "U", "up" -> "U"
            "D", "down" -> "D"
            "S", "stop" -> "S"
            "neutral" -> if (value.speed == 0) "neutral" else return false
            else -> return false
        }
        val g = grant ?: return false
        val sentAt = value.sentAtMs() ?: return false
        // Server epoch is anchored to elapsed time; changing the phone wall clock cannot revive a command.
        // Include the full network RTT so clock uncertainty can shorten, never extend, a command's TTL.
        val trustedNow = clockUpperBound + (now - grantAt)
        val age = trustedNow - sentAt
        if (retained || value.type != "drive_intent" || value.device_id != deviceId ||
            value.control_session_id != sessionId || value.command_id.isBlank() || value.command_id.length > 128 ||
            '\n' in value.command_id || '\r' in value.command_id ||
            value.seq < 0 || value.seq <= sequence || value.command_id in commandIds ||
            value.speed !in 0..100 || value.ttl_ms !in 1..g.max_ttl_ms ||
            age < 0 || age >= value.ttl_ms || now >= grantExpires || !hasValidSignature(value)) return false
        sequence = value.seq
        commandIds.add(value.command_id)
        if (commandIds.size > 256) commandIds.remove(commandIds.first())
        lastCommandId = value.command_id
        if (code == "S" || (value.speed == 0 && code != "neutral")) { disarm("Controller stopped"); return true }
        // A fresh packet can reach the main thread before a delayed watchdog tick.
        if (command != null && now >= intentExpires) {
            disarm("Intention expired")
            return code == "neutral"
        }
        val fault = readiness(now)
        if (!enabled || fault != null) {
            disarm(fault ?: reason)
            return code == "neutral"
        }
        if (code == "neutral") {
            command = null
            output = DriveOutput()
            reason = "Ready; waiting for fresh intention"
            return true
        }
        if (command != code) targetHeading = pose!!.heading
        command = code
        requestedSpeed = value.speed
        intentExpires = now + (value.ttl_ms - age.coerceAtLeast(0))
        if (code == "U" || code == "D") {
            val base = servoTarget
            val reportAt = servoReportedAt
            if (base == null || reportAt == null || now - reportAt !in 0..6000) {
                disarm("Waiting for ESP servo angle")
                return true
            }
            if (now >= nextServoStepAt) {
                servoTarget = (base + if (code == "U") 5 else -5).coerceIn(60, 180)
                nextServoStepAt = now + 200
            }
            output = DriveOutput(servo = servoTarget)
            reason = "Aiming camera"
        }
        tick(now)
        return true
    }
    private fun hasValidSignature(value: DriveIntent): Boolean {
        val mac = intentMac ?: return false
        if (!HEX_256.matches(value.signature)) return false
        val canonical = listOf(value.device_id, value.control_session_id, value.command_id, value.seq,
            value.action, value.speed, value.sent_at, value.ttl_ms).joinToString("\n")
        return MessageDigest.isEqual(mac.doFinal(canonical.toByteArray(Charsets.UTF_8)), decodeHex(value.signature))
    }
    fun tick(now: Long): DriveOutput {
        if (!enabled) return output
        readiness(now)?.let { disarm(it); return output }
        val code = command ?: return output
        if (now >= intentExpires) { disarm("Intention expired"); return output }
        if (code == "U" || code == "D") return output
        val p = pose!!
        val speed = requestedSpeed.toDouble()
        val (left, right) = when (code) {
            "F", "B" -> {
                val base = if (code == "F") speed else -speed
                // Same yaw sign while reversing. Low initial gains require chassis tuning.
                val correction = (1.0 * angle(targetHeading - p.heading) - 0.12 * p.yawRate).coerceIn(-15.0, 15.0)
                (base + correction) to (base - correction)
            }
            else -> {
                val sign = if (code == "R") 1 else -1
                val requestedRate = sign * speed * 0.9
                val effort = (speed + sign * 0.1 * (requestedRate - p.yawRate)).coerceIn(0.0, speed + 15.0)
                sign * effort to -sign * effort
            }
        }
        output = DriveOutput(left.roundToInt().coerceIn(-100, 100), right.roundToInt().coerceIn(-100, 100), true,
            code)
        reason = "Driving"
        return output
    }
    fun disarm(why: String) { enabled = false; command = null; output = DriveOutput(); reason = why }
    fun status(now: Long) = MobileStatus(
        device_id = deviceId, control_session_id = sessionId, last_command_id = lastCommandId,
        state = if (output.armed) "driving" else if (enabled) "ready" else if (readiness(now) != null) "fault" else "disarmed",
        reason = reason, esp_online = espAt != Long.MIN_VALUE && now - espAt in 0..6000,
        calibrated = calibrated, heading_deg = pose?.heading ?: 0.0, target_heading_deg = targetHeading,
        left = output.left, right = output.right,
    )
    companion object {
        private val HEX_256 = Regex("[0-9a-f]{64}")
        private fun decodeHex(value: String) = ByteArray(value.length / 2) { i -> value.substring(2 * i, 2 * i + 2).toInt(16).toByte() }
        fun angle(value: Double): Double = ((value + 180) % 360 + 360) % 360 - 180
    }
}
