package com.iris.robot.core

import kotlin.math.roundToInt

data class Pose(val heading: Double, val pitch: Double, val roll: Double, val yawRate: Double, val atMs: Long)
data class DriveOutput(val left: Int = 0, val right: Int = 0, val armed: Boolean = false, val cmd: String = "S")

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
    private var grantAt = 0L
    private var grantExpires = 0L
    private var clockUpperBound = 0L
    private var sequence = -1L
    private val commandIds = LinkedHashSet<String>()
    private var intent: DriveIntent? = null
    private var intentExpires = 0L
    private var foreground = true

    fun connectivity(value: Boolean) {
        connected = value
        if (!value) { espAt = Long.MIN_VALUE; revoke("Broker disconnected") }
        else disarm("Connected; calibrate and fetch a session")
    }
    fun backendConnectivity(value: Boolean) {
        backendConnected = value
        if (!value) revoke("Backend hub disconnected")
    }
    fun espSeen(now: Long) { espAt = now }
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
            value.max_ttl_ms !in 1..300 || roundTripMs !in 0..2000 ||
            value.expires_at_ms <= value.server_time_ms + roundTripMs ||
            value.expires_at_ms - value.server_time_ms > 60_000) {
            revoke("Invalid session grant or clock uncertainty")
            return false
        }
        if (value.control_session_id != sessionId) revoke("Session changed; enable explicitly")
        else if (grant != null && receivedAt >= grantExpires) disarm("Session lease expired; enable explicitly")
        grant = value
        sessionId = value.control_session_id
        grantAt = receivedAt
        clockUpperBound = value.server_time_ms + roundTripMs
        // Conservatively subtract the full request RTT from usable grant lifetime.
        grantExpires = receivedAt + value.expires_at_ms - value.server_time_ms - roundTripMs
        return true
    }
    fun revoke(why: String) {
        disarm(why); grant = null; sessionId = null; sequence = -1; commandIds.clear()
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
        enabled = true; intent = null; output = DriveOutput(); reason = "Ready; waiting for fresh intention"
        return true
    }
    fun accept(value: DriveIntent, retained: Boolean, now: Long): Boolean {
        val g = grant ?: return false
        val sentAt = value.sentAtMs() ?: return false
        // Server epoch is anchored to elapsed time; changing the phone wall clock cannot revive a command.
        // Include the full network RTT so clock uncertainty can shorten, never extend, a command's TTL.
        val trustedNow = clockUpperBound + (now - grantAt)
        val age = trustedNow - sentAt
        if (retained || value.type != "drive_intent" || value.device_id != deviceId ||
            value.control_session_id != sessionId || value.command_id.isBlank() || value.command_id.length > 128 ||
            value.seq < 0 || value.seq <= sequence || value.command_id in commandIds ||
            value.action !in setOf("forward", "backward", "left", "right", "stop") ||
            value.speed !in 0..100 || value.ttl_ms !in 1..g.max_ttl_ms ||
            age < 0 || age >= value.ttl_ms || now >= grantExpires) return false
        sequence = value.seq
        commandIds.add(value.command_id)
        if (commandIds.size > 256) commandIds.remove(commandIds.first())
        lastCommandId = value.command_id
        if (value.action == "stop" || value.speed == 0) { disarm("Controller stopped"); return true }
        if (!enabled || readiness(now) != null) { disarm(readiness(now) ?: "Enable required"); return false }
        if (intent?.action != value.action) targetHeading = pose!!.heading
        intent = value
        intentExpires = now + (value.ttl_ms - age.coerceAtLeast(0))
        tick(now)
        return true
    }
    fun tick(now: Long): DriveOutput {
        if (!enabled) return output
        readiness(now)?.let { disarm(it); return output }
        val command = intent ?: return output
        if (now >= intentExpires) { disarm("Intention expired"); return output }
        val p = pose!!
        val speed = command.speed.toDouble()
        val (left, right) = when (command.action) {
            "forward", "backward" -> {
                val base = if (command.action == "forward") speed else -speed
                // Same yaw sign while reversing. Low initial gains require chassis tuning.
                val correction = (1.0 * angle(targetHeading - p.heading) - 0.12 * p.yawRate).coerceIn(-15.0, 15.0)
                (base + correction) to (base - correction)
            }
            else -> {
                val sign = if (command.action == "right") 1 else -1
                val requestedRate = sign * speed * 0.9
                val effort = (speed + sign * 0.1 * (requestedRate - p.yawRate)).coerceIn(0.0, speed + 15.0)
                sign * effort to -sign * effort
            }
        }
        output = DriveOutput(left.roundToInt().coerceIn(-100, 100), right.roundToInt().coerceIn(-100, 100), true,
            when (command.action) { "forward" -> "F"; "backward" -> "B"; "left" -> "L"; else -> "R" })
        reason = "Driving"
        return output
    }
    fun disarm(why: String) { enabled = false; intent = null; output = DriveOutput(); reason = why }
    fun status(now: Long) = MobileStatus(
        device_id = deviceId, control_session_id = sessionId, last_command_id = lastCommandId,
        state = if (output.armed) "driving" else if (enabled) "ready" else if (readiness(now) != null) "fault" else "disarmed",
        reason = reason, esp_online = espAt != Long.MIN_VALUE && now - espAt in 0..6000,
        calibrated = calibrated, heading_deg = pose?.heading ?: 0.0, target_heading_deg = targetHeading,
        left = output.left, right = output.right,
    )
    companion object { fun angle(value: Double): Double = ((value + 180) % 360 + 360) % 360 - 180 }
}
