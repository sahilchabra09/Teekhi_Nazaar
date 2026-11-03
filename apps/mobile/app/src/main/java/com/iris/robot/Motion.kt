package com.iris.robot

import android.content.Context
import android.hardware.*
import android.os.SystemClock
import com.iris.robot.core.*
import kotlin.math.*

/** Upright portrait mount: screen normal faces robot forward; phone top faces robot up. */
class Motion(
    context: Context,
    private val send: (Msg) -> Boolean,
    private val pose: (Pose) -> Unit,
    private val bump: (String) -> Unit,
) : SensorEventListener, AutoCloseable {
    private val manager = context.getSystemService(SensorManager::class.java)
    private val rotation = manager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
    private val gyro = manager.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
    private val acceleration = manager.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION)
    private val matrix = FloatArray(9)
    private var hasRotation = false
    private var rotationAt = 0L
    private var gyroAt = 0L
    private var yawRate = 0.0
    private var heading = 0.0
    private var pitch = 0.0
    private var roll = 0.0
    private var accel = 0.0
    private var lastSend = 0L
    private var lastBump = -2000L
    private var restUp: DoubleArray? = null
    private var restHeading = 0.0
    private var restPitch = 0.0
    private var restRoll = 0.0
    val available get() = rotation != null && gyro != null
    fun start() {
        rotation?.let { manager.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
        gyro?.let { manager.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
        acceleration?.let { manager.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
    }
    fun calibrate(): Boolean {
        val now = SystemClock.elapsedRealtime()
        if (!hasRotation || now - rotationAt > 250 || now - gyroAt > 250) return false
        // A flat phone has no stable forward projection. Require an upright mount.
        if (hypot(matrix[2].toDouble(), matrix[5].toDouble()) < 0.5 || matrix[7] < 0.5 || abs(yawRate) > 5 || accel > 1.5) return false
        restUp = doubleArrayOf(matrix[6].toDouble(), matrix[7].toDouble(), matrix[8].toDouble())
        restHeading = heading; restPitch = pitch; restRoll = roll
        return true
    }
    override fun onSensorChanged(event: SensorEvent) {
        val now = SystemClock.elapsedRealtime()
        when (event.sensor.type) {
            Sensor.TYPE_ROTATION_VECTOR -> {
                SensorManager.getRotationMatrixFromVector(matrix, event.values)
                hasRotation = true; rotationAt = now
                heading = Math.toDegrees(atan2(matrix[2].toDouble(), matrix[5].toDouble()))
                pitch = Math.toDegrees(atan2(matrix[8].toDouble(), matrix[7].toDouble()))
                roll = Math.toDegrees(atan2(matrix[6].toDouble(), matrix[7].toDouble()))
                restUp?.let { baseline ->
                    val dot = baseline[0] * matrix[6] + baseline[1] * matrix[7] + baseline[2] * matrix[8]
                    val tilt = Math.toDegrees(acos(dot.coerceIn(-1.0, 1.0)))
                    if (tilt > 35) trigger("tilt", tilt, now)
                }
            }
            Sensor.TYPE_GYROSCOPE -> {
                gyroAt = now
                if (hasRotation) yawRate = -Math.toDegrees((matrix[6] * event.values[0] + matrix[7] * event.values[1] + matrix[8] * event.values[2]).toDouble())
            }
            Sensor.TYPE_LINEAR_ACCELERATION -> {
                accel = sqrt(event.values.take(3).sumOf { it.toDouble().pow(2) })
                if (accel > 15) trigger("impact", accel, now)
            }
        }
        if (hasRotation && gyroAt > 0 && now - lastSend >= 100) {
            lastSend = now
            val value = Pose(DriveController.angle(heading - restHeading), DriveController.angle(pitch - restPitch),
                DriveController.angle(roll - restRoll), yawRate, minOf(rotationAt, gyroAt))
            pose(value)
            send(MotionMessage(value.heading, value.pitch, value.roll, accel))
        }
    }
    private fun trigger(kind: String, magnitude: Double, now: Long) {
        if (now - lastBump < 1500) return
        lastBump = now; send(Bump(kind, magnitude)); bump(kind)
    }
    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
    override fun close() { manager.unregisterListener(this); restUp = null }
}
