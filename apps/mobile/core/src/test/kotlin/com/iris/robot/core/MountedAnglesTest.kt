package com.iris.robot.core

import kotlin.test.*

class MountedAnglesTest {
    @Test fun `calibration uses a fresh stationary window and filters across north`() {
        val angles = MountedAngles()
        repeat(23) { i -> angles.observe(Pose(if (i % 2 == 0) 179.0 else -179.0, 2.0, -4.0, 0.0, 1000L + 50 * i), true) }
        assertNull(angles.calibrate(2100))
        angles.observe(Pose(-179.0, 2.0, -4.0, 0.0, 2150), true)
        assertNull(angles.calibrate(2500))
        assertEquals(0.0, angles.calibrate(2150)?.heading)
        val pose = angles.observe(Pose(-170.0, 2.1, -4.0, 7.0, 2200), false)
        assertEquals(2.0, pose.heading, 1e-6)
        assertEquals(0.0, pose.pitch)
        assertEquals(7.0, pose.yawRate)
        assertEquals(2200L, pose.atMs)
        assertNull(angles.calibrate(2200))
    }
}
