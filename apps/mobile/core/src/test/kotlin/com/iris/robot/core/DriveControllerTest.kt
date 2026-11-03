package com.iris.robot.core

import java.time.Instant
import kotlin.test.*

class DriveControllerTest {
    private val epoch = 1_700_000_000_000L
    private fun ready(): DriveController = DriveController().apply {
        connectivity(true); backendConnectivity(true); updatePose(Pose(0.0, 0.0, 0.0, 0.0, 1000)); assertTrue(calibrate(1000)); espSeen(1000)
        assertTrue(grant(SessionGrant(deviceId, "session-a", epoch, epoch + 10000), 1000, 20)); assertTrue(enable(1000))
    }
    private fun intent(seq: Long = 1, action: String = "forward", sent: Long = epoch) = DriveIntent(
        "drive_intent", "esp12e_carbot", "session-a", "cmd-$seq", seq, action, 40, Instant.ofEpochMilli(sent).toString(), 300,
    )
    @Test fun `startup and reconnect require grant calibration status and explicit enable`() {
        val c = DriveController()
        assertFalse(c.enable(1000)); assertEquals(DriveOutput(), c.tick(1000))
        val r = ready(); assertTrue(r.accept(intent(), false, 1000))
        r.connectivity(false); r.connectivity(true)
        assertFalse(r.enabled); assertFalse(r.enable(1010)); assertNull(r.sessionId)
    }
    @Test fun `duplicate and older commands do not renew freshness`() {
        val c = ready(); assertTrue(c.accept(intent(), false, 1000))
        c.updatePose(Pose(0.0, 0.0, 0.0, 0.0, 1250))
        assertFalse(c.accept(intent(), false, 1250))
        assertFalse(c.accept(intent(seq = 0), false, 1250))
        assertEquals(DriveOutput(), c.tick(1300)); assertFalse(c.enabled)
    }
    @Test fun `retained misaddressed wrong-session expired future and excessive-TTL movement are rejected`() {
        val c = ready()
        assertFalse(c.accept(intent(), true, 1000))
        assertFalse(c.accept(intent().copy(device_id = "other"), false, 1000))
        assertFalse(c.accept(intent().copy(control_session_id = "unknown"), false, 1000))
        assertFalse(c.accept(intent(sent = epoch - 301), false, 1000))
        assertFalse(c.accept(intent(sent = epoch + 51), false, 1000))
        assertFalse(c.accept(intent().copy(ttl_ms = 301), false, 1000))
        assertFalse(c.accept(intent().copy(type = "mobile_status"), false, 1000))
        assertEquals(DriveOutput(), c.output)
    }
    @Test fun `held forward renewals preserve heading and reverse uses the same yaw convention`() {
        val c = ready(); c.accept(intent(), false, 1000)
        c.updatePose(Pose(5.0, 0.0, 0.0, 0.0, 1100))
        assertTrue(c.accept(intent(2, sent = epoch + 100), false, 1100))
        assertEquals(0.0, c.targetHeading); assertEquals(35, c.output.left); assertEquals(45, c.output.right)
        assertTrue(c.accept(intent(3, "backward", epoch + 100), false, 1100))
        c.updatePose(Pose(10.0, 0.0, 0.0, 0.0, 1150)); c.tick(1150)
        assertEquals(-45, c.output.left); assertEquals(-35, c.output.right)
    }
    @Test fun `turns use opposing wheel signs and capture a new heading afterward`() {
        val c = ready(); c.accept(intent(action = "left"), false, 1000)
        assertTrue(c.output.left < 0); assertTrue(c.output.right > 0)
        c.updatePose(Pose(80.0, 0.0, 0.0, 0.0, 1100))
        c.accept(intent(2, "forward", epoch + 100), false, 1100)
        assertEquals(80.0, c.targetHeading)
    }
    @Test fun `stop zero speed background and sensor loss disarm without gyro creep`() {
        for (stop in listOf(intent(2, "stop"), intent(2).copy(speed = 0))) {
            val c = ready(); c.accept(intent(), false, 1000); assertTrue(c.accept(stop, false, 1000))
            assertEquals(DriveOutput(), c.tick(1000)); assertFalse(c.enabled)
            assertFalse(c.accept(intent(3), false, 1000))
        }
        val background = ready(); background.accept(intent(), false, 1000); background.active(false)
        assertEquals(DriveOutput(), background.tick(1100)); assertFalse(background.calibrated); assertNull(background.sessionId)
        val stale = ready(); stale.accept(intent(), false, 1000)
        assertEquals(DriveOutput(), stale.tick(1251)); assertFalse(stale.enabled)
    }
    @Test fun `session replacement and invalid grant disarm immediately`() {
        val c = ready(); c.accept(intent(), false, 1000)
        assertTrue(c.grant(SessionGrant(c.deviceId, "session-b", epoch + 100, epoch + 10000), 1100, 20))
        assertFalse(c.enabled); assertEquals(DriveOutput(), c.output)
        assertFalse(c.grant(SessionGrant("other", "session-c", epoch, epoch + 10000), 1100, 0))
        assertNull(c.sessionId)
    }
    @Test fun `full ESP status and grant lease expire independently`() {
        val c = ready(); c.updatePose(Pose(0.0, 0.0, 0.0, 0.0, 7101))
        assertFalse(c.enable(7101)); assertEquals("Waiting for full ESP status", c.reason)
        c.espSeen(11000); c.updatePose(Pose(0.0, 0.0, 0.0, 0.0, 11000))
        assertFalse(c.enable(11000)); assertTrue(c.reason.contains("session"))
    }
    @Test fun `angle wrap takes the shortest path and output is bounded`() {
        assertEquals(2.0, DriveController.angle(-358.0))
        assertEquals(-2.0, DriveController.angle(358.0))
        val c = ready(); c.accept(intent().copy(speed = 100), false, 1000)
        c.updatePose(Pose(-150.0, 0.0, 0.0, 0.0, 1100)); c.tick(1100)
        assertTrue(c.output.left in -100..100); assertTrue(c.output.right in -100..100)
    }
    @Test fun `network clock uncertainty shortens TTL and an expired renewed lease needs enable`() {
        val c = ready()
        c.grant(SessionGrant(c.deviceId, "session-a", epoch, epoch + 10000), 1000, 200)
        assertFalse(c.accept(intent(sent = epoch - 200), false, 1000))
        c.updatePose(Pose(0.0, 0.0, 0.0, 0.0, 11000)); c.espSeen(11000)
        assertTrue(c.grant(SessionGrant(c.deviceId, "session-a", epoch + 10000, epoch + 20000), 11000, 20))
        assertFalse(c.enabled)
    }
    @Test fun `backend WebSocket loss disarms even when MQTT is healthy`() {
        val c = ready(); assertTrue(c.accept(intent(), false, 1000))
        c.backendConnectivity(false)
        assertTrue(c.connected); assertFalse(c.enabled); assertNull(c.sessionId)
        assertEquals(DriveOutput(), c.tick(1100)); assertFalse(c.enable(1100))
        c.backendConnectivity(true)
        assertFalse(c.enabled); assertFalse(c.enable(1100))
    }
}
