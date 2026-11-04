import type { TrackingFrame, Vector3 } from "../eye-tracking.types"
import { HEAD_POSE_MAX_AGE_MS } from "./head-pose"
import type { HeadPose } from "./head-pose.types"
import type {
  Quaternion,
  SynchronizedGazeFrame,
} from "./head-synchronization.types"
const MAXIMUM_BRACKET_MS = 80
const MAXIMUM_ROTATION_STEP = 0.35
function quaternion(rotation: Vector3): Quaternion {
  const [pitch, yaw, roll] = rotation.map((value) => value / 2)
  const cx = Math.cos(pitch)
  const sx = Math.sin(pitch)
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const cz = Math.cos(roll)
  const sz = Math.sin(roll)
  return [
    sx * cy * cz - cx * sy * sz,
    cx * sy * cz + sx * cy * sz,
    cx * cy * sz - sx * sy * cz,
    cx * cy * cz + sx * sy * sz,
  ]
}
function interpolateRotation(
  left: Vector3,
  right: Vector3,
  fraction: number
): Vector3 | null {
  const first = quaternion(left)
  let second = quaternion(right)
  let cosine = first.reduce((sum, value, axis) => sum + value * second[axis], 0)
  if (cosine < 0) {
    second = second.map((value) => -value) as Quaternion
    cosine = -cosine
  }
  const angle = Math.acos(Math.min(1, cosine))
  if (2 * angle > MAXIMUM_ROTATION_STEP) {
    return null
  }
  let a = 1 - fraction
  let b = fraction
  if (angle > 0.0001) {
    a = Math.sin((1 - fraction) * angle) / Math.sin(angle)
    b = Math.sin(fraction * angle) / Math.sin(angle)
  }
  const blended = first.map((value, axis) => a * value + b * second[axis])
  const norm = Math.hypot(...blended)
  const [x, y, z, w] = blended.map((value) => value / norm)
  return [
    Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)),
    Math.asin(Math.max(-1, Math.min(1, 2 * (w * y - z * x)))),
    Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)),
  ]
}
/** Interpolate only between actual observations. Do not extrapolate a stale head pose. */
export function interpolateHeadPose(
  history: HeadPose[],
  timestamp: number,
  now: number
): HeadPose | null {
  if (!Number.isFinite(now)) {
    return null
  }
  if (
    !Number.isFinite(timestamp) ||
    now < timestamp ||
    now - timestamp > HEAD_POSE_MAX_AGE_MS
  ) {
    return null
  }
  const exact = history.find((pose) => pose.timestamp === timestamp)
  if (exact) {
    return exact
  }
  for (let index = 1; index < history.length; index++) {
    const left = history[index - 1]
    const right = history[index]
    if (right.timestamp > now) {
      continue
    }
    if (left.timestamp > timestamp || right.timestamp < timestamp) {
      continue
    }
    const interval = right.timestamp - left.timestamp
    if (interval <= 0 || interval > MAXIMUM_BRACKET_MS) {
      return null
    }
    const fraction = (timestamp - left.timestamp) / interval
    const rotation = interpolateRotation(
      left.rotation,
      right.rotation,
      fraction
    )
    if (!rotation) {
      return null
    }
    return {
      ...right,
      timestamp,
      rotation,
      position: left.position.map(
        (value, axis) => value + fraction * (right.position[axis] - value)
      ) as Vector3,
    }
  }
  return null
}
/** A short bounded eye buffer lets the next head observation bracket its timestamp. */
export class GazeFrameSynchronizer {
  private frames: TrackingFrame[] = []
  read(
    frame: TrackingFrame | null,
    history: HeadPose[],
    now: number
  ): SynchronizedGazeFrame | null {
    if (!frame || history.length === 0) {
      this.frames = []
      return null
    }
    if (frame.id !== this.frames.at(-1)?.id) {
      this.frames.push(frame)
    }
    this.frames = this.frames
      .filter((eye) => now - eye.timestamp <= HEAD_POSE_MAX_AGE_MS)
      .slice(-16)
    for (let index = this.frames.length - 1; index >= 0; index--) {
      const eye = this.frames[index]
      const head = interpolateHeadPose(history, eye.timestamp, now)
      if (head) {
        return { eye, head }
      }
    }
    return null
  }
}
