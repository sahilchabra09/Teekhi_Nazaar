package com.iris.robot.core

import java.time.Instant
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import kotlin.test.*

class DriveControllerTest {
    private val key = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
    private fun DriveIntent.signed(): DriveIntent {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(ByteArray(32) { it.toByte() }, "HmacSHA256"))
        val payload = "$device_id\n$control_session_id\n$command_id\n$seq\n$action\n$speed\n$sent_at\n$ttl_ms"
        return copy(signature = mac.doFinal(payload.toByteArray()).joinToString("") { "%02x".format(it) })
    }
    private val epoch = 1_700_000_000_000L
    private fun ready(): DriveController = DriveController().apply {
        connectivity(true); backendConnectivity(true); updatePose(Pose(0.0, 0.0, 0.0, 0.0, 1000)); assertTrue(calibrate(1000)); espSeen(1000)
        assertTrue(grant(SessionGrant(deviceId, "session-a", epoch, epoch + 10000, signing_key = key), 1000, 20)); assertTrue(enable(1000))
    }
    private fun intent(seq: Long = 1, action: String = "forward", sent: Long = epoch) = DriveIntent(
        "drive_intent", "esp12e_carbot", "session-a", "cmd-$seq", seq, action, 40, Instant.ofEpochMilli(sent).toString(), 300,
    ).signed()
    @Test fun `signed letters decode on Topic 1 and keep the word client's gyro behavior`() {
        for ((letter, word) in mapOf("F" to "forward", "B" to "backward", "R" to "right", "L" to "left", "S" to "stop")) {
            val numeric = ready()
            val legacy = ready()
            val json = Protocol.json.encodeToString(DriveIntent.serializer(), intent(action = letter))
            assertTrue(numeric.accept(Protocol.json.decodeFromString<DriveIntent>(json), false, 1000))
            assertTrue(legacy.accept(intent(action = word), false, 1000))
            val pose = Pose(7.0, 2.0, -1.0, 4.0, 1100)
            numeric.updatePose(pose); legacy.updatePose(pose)
            assertEquals(legacy.tick(1100), numeric.tick(1100))
            assertEquals(letter, numeric.output.cmd)
        }
        val c = ready()
        assertTrue(c.accept(intent(action = "F"), false, 1000))
        c.updatePose(Pose(10.0, 0.0, 0.0, 0.0, 1100))
        assertTrue(c.accept(intent(2, "forward", epoch + 100), false, 1100))
        assertEquals(0.0, c.targetHeading)
        assertFalse(c.accept(intent(3, "F", epoch + 100).copy(action = "forward"), false, 1100))
    }

    @Test fun `signed patient console gaze commands yield the expected wheels and legacy stop disarms`() {
        // Captured from the production TypeScript DrivePublisher at the fixed grant time and test key.
        // Keep the browser's millisecond ISO timestamp and signature verbatim.
        data class Sample(val action: String, val proof: String, val wheels: DriveOutput)
        val samples = listOf(
            Sample("forward", "095771b4195979a6c3d5affaebd088fa385f8cc0aa99dd2c0945fb2be3732f1d", DriveOutput(35, 35, true, "F")),
            Sample("backward", "b3468448111215844444276cde9c7c61821149ff37c2525ae02e9769de436c67", DriveOutput(-35, -35, true, "B")),
            Sample("left", "e31dfedf036c2dfd6248af3bc42bae99fb3f5122184a94aa81a56241a94a533e", DriveOutput(-38, 38, true, "L")),
            Sample("right", "863a7cd7a38edb1619e358ab5a948fe9487da06c9573b072d6955b438c72f0ad", DriveOutput(38, -38, true, "R")),
        )
        fun wire(number: Int, action: String, proof: String, seq: Int, speed: Int): DriveIntent {
            val commandId = "00000000-0000-4000-8000-" + number.toString().padStart(12, '0')
            return Protocol.json.decodeFromString<DriveIntent>("""{"type":"drive_intent","device_id":"esp12e_carbot","control_session_id":"session-a","command_id":"$commandId","seq":$seq,"action":"$action","speed":$speed,"sent_at":"2023-11-14T22:13:20.000Z","ttl_ms":300,"signature":"$proof"}""")
        }
        val legacyStop = wire(5, "stop", "f5ee823de8694287b700c53e839da85b0fd9d7ecdd4a4b7006ed21ed8190b02b", seq = 2, speed = 0)
        for ((index, sample) in samples.withIndex()) {
            val controller = ready()
            assertTrue(controller.accept(wire(index + 1, sample.action, sample.proof, seq = 1, speed = 35), false, 1000))
            assertEquals(sample.wheels, controller.tick(1000))
            assertTrue(controller.accept(legacyStop, false, 1000))
            assertEquals(DriveOutput(), controller.tick(1000))
            assertFalse(controller.enabled)
        }
    }

    private fun neutral(seq: Long, sent: Long) = intent(seq, "neutral", sent).copy(speed = 0).signed()

    @Test fun `neutral stops and acknowledges readiness for the next direction`() {
        val c = ready()
        assertTrue(c.accept(intent(), false, 1000))
        assertFalse(c.accept(intent(2, "neutral", epoch + 100), false, 1100)) // nonzero neutral
        assertFalse(c.accept(neutral(2, epoch + 100).copy(signature = ""), false, 1100))
        assertFalse(c.accept(neutral(2, epoch + 100), true, 1100))
        assertTrue(c.output.armed)
        assertTrue(c.accept(neutral(2, epoch + 100), false, 1100))
        assertEquals(DriveOutput(), c.tick(1100))
        assertEquals("ready", c.status(1100).state)
        assertEquals("cmd-2", c.status(1100).last_command_id)
        assertTrue(c.status(1100).supports_neutral)
        assertFalse(c.accept(neutral(2, epoch + 100), false, 1100))
        c.updatePose(Pose(0.0, 0.0, 0.0, 0.0, 2100))
        assertTrue(c.accept(neutral(3, epoch + 1100), false, 2100))
        assertEquals(DriveOutput(), c.tick(2100))
        assertEquals("cmd-3", c.status(2100).last_command_id)
        assertTrue(c.accept(intent(4, "right", epoch + 1100), false, 2100))
        assertEquals("R", c.output.cmd)
    }

    @Test fun `neutral cannot rescue expired motion or reenable a stopped controller`() {
        val c = ready()
        assertTrue(c.accept(intent(), false, 1000))
        c.updatePose(Pose(0.0, 0.0, 0.0, 0.0, 1400))
        c.accept(neutral(2, epoch + 400), false, 1400)
        assertFalse(c.enabled)
        assertEquals(DriveOutput(), c.output)
        assertTrue(c.enable(1400))
        assertTrue(c.accept(intent(3, "stop", epoch + 400), false, 1400))
        c.accept(neutral(4, epoch + 400), false, 1400)
        assertFalse(c.enabled)
        c.backendConnectivity(false)
        assertFalse(c.accept(neutral(5, epoch + 400), false, 1400))
    }

    @Test fun `camera steps use reported angle stop wheels and resist repeated or expired frames`() {
        val c = ready()
        c.espSeen(1000, 172)
        assertTrue(c.accept(intent(action = "F"), false, 1000))
        assertTrue(c.output.armed)
        assertTrue(c.accept(intent(2, "U"), false, 1000))
        assertEquals(DriveOutput(servo = 177), c.output)
        assertFalse(c.accept(intent(2, "U"), false, 1010))
        c.espSeen(1050, 172) // a delayed status must not rewind an active tilt
        assertTrue(c.accept(intent(3, "U", epoch + 100), false, 1100))
        assertEquals(177, c.output.servo)
        c.updatePose(Pose(0.0, 0.0, 0.0, 0.0, 1200))
        assertTrue(c.accept(intent(4, "U", epoch + 200), false, 1200))
        assertEquals(180, c.output.servo)
        assertTrue(c.accept(intent(5, "D", epoch + 400), false, 1400))
        assertEquals(175, c.output.servo)
        assertEquals("""{"password":"unit-only","servo":175}""",
            Protocol.json.encodeToString(ServoCommand.serializer(), ServoCommand("unit-only", c.output.servo!!)))
        c.updatePose(Pose(0.0, 0.0, 0.0, 0.0, 1700))
        assertEquals(DriveOutput(), c.tick(1700))
        assertFalse(c.enabled)
    }

    @Test fun `down stops at lower limit and rejected tilt cannot move the camera`() {
        val c = ready()
        c.espSeen(1000, 62)
        assertFalse(c.accept(intent(action = "D"), true, 1000))
        assertFalse(c.accept(intent(action = "up").copy(action = "D"), false, 1000))
        assertNull(c.output.servo)
        assertTrue(c.accept(intent(action = "D"), false, 1000))
        assertEquals(60, c.output.servo)
        val missing = ready()
        assertTrue(missing.accept(intent(action = "U"), false, 1000))
        assertEquals(DriveOutput(), missing.output)
        assertFalse(missing.enabled)
    }

    @Test fun `signed grants reject missing proof and altered fields without advancing sequence`() {
        val c = ready()
        val value = Protocol.json.decodeFromString<SessionGrant>("""{"device_id":"esp12e_carbot","control_session_id":"session-a","server_time_ms":$epoch,"expires_at_ms":${epoch + 10000},"signing_key":"000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"}""")
        assertTrue(c.grant(value, 1000, 20))
        assertTrue(c.enable(1000))
        val proof = "8be3265ae93fff846cb5aad35b5f53296f29afaefb76673b0b67c88ff3078fa9"
        val signed = Protocol.json.decodeFromString<DriveIntent>("""{"type":"drive_intent","device_id":"esp12e_carbot","control_session_id":"session-a","command_id":"cmd-1","seq":1,"action":"forward","speed":40,"sent_at":"2023-11-14T22:13:20Z","ttl_ms":300,"signature":"$proof"}""")
        assertFalse(c.accept(signed.copy(signature = proof.uppercase()), false, 1000))
        assertFalse(c.accept(signed.copy(speed = 60), false, 1000))
        assertFalse(c.accept(signed.copy(action = "stop"), false, 1000))
        assertFalse(c.accept(intent(seq = 500).copy(signature = ""), false, 1000))
        assertTrue(c.accept(signed, false, 1000))
        assertFalse(c.accept(signed, false, 1000))
        assertFalse(c.grant(value.copy(signing_key = ""), 1001, 0))
        assertEquals(DriveOutput(), c.output)
        assertNull(c.sessionId)
    }
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
    @Test fun `fresh movement after a missed watchdog tick cannot revive an expired hold`() {
        val c = ready()
        assertTrue(c.accept(intent(), false, 1000))
        c.updatePose(Pose(0.0, 0.0, 0.0, 0.0, 1400))
        // A delayed main loop delivers the new MQTT message before its next periodic tick.
        assertFalse(c.accept(intent(2, "forward", epoch + 400), false, 1400))
        assertEquals(DriveOutput(), c.output)
        assertFalse(c.enabled)
        assertTrue(c.enable(1400))
        assertTrue(c.accept(intent(3, "forward", epoch + 400), false, 1400))
    }

    @Test fun `retained misaddressed wrong-session expired future and excessive-TTL movement are rejected`() {
        val c = ready()
        assertFalse(c.accept(intent(), true, 1000))
        assertFalse(c.accept(intent().copy(device_id = "other").signed(), false, 1000))
        assertFalse(c.accept(intent().copy(control_session_id = "unknown").signed(), false, 1000))
        assertFalse(c.accept(intent(sent = epoch - 301), false, 1000))
        assertFalse(c.accept(intent(sent = epoch + 51), false, 1000))
        assertFalse(c.accept(intent().copy(ttl_ms = 301).signed(), false, 1000))
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
        for (stop in listOf(intent(2, "stop"), intent(2).copy(speed = 0).signed())) {
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
        assertTrue(c.grant(SessionGrant(c.deviceId, "session-b", epoch + 100, epoch + 10000, signing_key = key), 1100, 20))
        assertFalse(c.enabled); assertEquals(DriveOutput(), c.output)
        assertFalse(c.grant(SessionGrant("other", "session-c", epoch, epoch + 10000, signing_key = key), 1100, 0))
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
        val c = ready(); c.accept(intent().copy(speed = 100).signed(), false, 1000)
        c.updatePose(Pose(-150.0, 0.0, 0.0, 0.0, 1100)); c.tick(1100)
        assertTrue(c.output.left in -100..100); assertTrue(c.output.right in -100..100)
    }
    @Test fun `network clock uncertainty shortens TTL and an expired renewed lease needs enable`() {
        val c = ready()
        c.grant(SessionGrant(c.deviceId, "session-a", epoch, epoch + 10000, signing_key = key), 1000, 200)
        assertFalse(c.accept(intent(sent = epoch - 200), false, 1000))
        c.updatePose(Pose(0.0, 0.0, 0.0, 0.0, 11000)); c.espSeen(11000)
        assertTrue(c.grant(SessionGrant(c.deviceId, "session-a", epoch + 10000, epoch + 20000, signing_key = key), 11000, 20))
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
