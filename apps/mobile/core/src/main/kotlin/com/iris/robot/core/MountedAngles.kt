package com.iris.robot.core

import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin

/** Calibrate from fresh, stationary samples. Filter angles along the short arc across ±180°. */
class MountedAngles {
    private val samples = ArrayDeque<Pose>(24)
    private var baseline: Pose? = null
    private var previous: Pose? = null

    fun observe(raw: Pose, stationary: Boolean): Pose {
        if (!stationary || samples.lastOrNull()?.let { raw.atMs - it.atMs !in 1..250 } == true) samples.clear()
        if (stationary) {
            if (samples.size == 24) samples.removeFirst()
            samples.addLast(raw)
        }
        val zero = baseline ?: return raw
        val last = previous?.takeIf { raw.atMs - it.atMs in 1..250 }
        fun filter(value: Double, origin: Double, old: Double?): Double {
            val relative = DriveController.angle(value - origin)
            if (old == null) return relative
            val delta = DriveController.angle(relative - old)
            return if (abs(delta) < 0.2) old else DriveController.angle(old + 0.2 * delta)
        }
        return raw.copy(heading = filter(raw.heading, zero.heading, last?.heading),
            pitch = filter(raw.pitch, zero.pitch, last?.pitch), roll = filter(raw.roll, zero.roll, last?.roll)).also { previous = it }
    }

    fun calibrate(now: Long): Pose? {
        if (samples.size < 24 || now - samples.last().atMs !in 0..250 || now - samples.first().atMs > 2000) return null
        fun mean(axis: (Pose) -> Double): Double {
            val sine = samples.sumOf { sin(Math.toRadians(axis(it))) }
            val cosine = samples.sumOf { cos(Math.toRadians(axis(it))) }
            return Math.toDegrees(atan2(sine, cosine))
        }
        val latest = samples.last()
        baseline = latest.copy(heading = mean(Pose::heading), pitch = mean(Pose::pitch), roll = mean(Pose::roll))
        return latest.copy(heading = 0.0, pitch = 0.0, roll = 0.0).also { previous = it }
    }
}
