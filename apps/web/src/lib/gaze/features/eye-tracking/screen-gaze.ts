import { gazeFeature, mapGaze } from "./calibration"
import type { Calibration, TrackingFrame } from "./eye-tracking.types"
import { headPoseInRange } from "./head-tracking/head-calibration"
import { synchronizedHeadPose } from "./head-tracking/head-pose"
import type { HeadPose } from "./head-tracking/head-pose.types"
import type { ScreenGazeReading } from "./screen-gaze.types"
export function getScreenGaze(
  calibration: Calibration | null,
  frame: TrackingFrame | null,
  pose: HeadPose | null,
  now: number
): ScreenGazeReading {
  if (!calibration) {
    return {
      point: null,
      status: "not-calibrated",
      message: "Calibrate your screen first.",
    }
  }
  if (!frame?.gaze || now - frame.timestamp > 350 || now < frame.timestamp) {
    return {
      point: null,
      status: "eye-lost",
      message: "Pupil lost. Keep your eye visible.",
    }
  }
  const feature = gazeFeature(frame.gaze.direction)
  if (!feature) {
    return {
      point: null,
      status: "eye-lost",
      message: "Waiting for a clear eye reading.",
    }
  }
  const head = synchronizedHeadPose(pose, frame.timestamp, now)
  if (calibration.headCompensation) {
    if (!head) {
      return {
        point: null,
        status: "head-lost",
        message: "Face lost. Face the front camera to resume.",
      }
    }
  }
  const point = mapGaze(calibration, feature, head)
  if (!point) {
    return {
      point: null,
      status: "eye-lost",
      message: "Waiting for a valid gaze reading.",
    }
  }
  if (point.some((value) => value < 0 || value > 1)) {
    return {
      point,
      status: "outside-screen",
      message: "Gaze is outside this view.",
    }
  }
  if (
    calibration.headCompensation &&
    head &&
    !headPoseInRange(calibration.headCompensation, head)
  ) {
    return {
      point,
      status: "head-outside-range",
      message: "Outside measured head range; accuracy may be lower.",
    }
  }
  return { point, status: "tracking", message: "Screen position" }
}
