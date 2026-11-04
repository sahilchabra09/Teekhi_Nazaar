import type {
  Calibration,
  CalibrationSample,
  GazeOrientation,
} from "./calibration.types"
import type { Point } from "./eye-tracking.types"
import type { HeadPose } from "./head-tracking/head-pose.types"

export type CalibrationObservation = {
  id: number
  timestamp: number
  feature: Point
  headPose?: HeadPose
}
export type CalibrationSessionOptions = {
  screenAspectRatio?: number
  targets?: Point[]
  comfortableHold?: boolean
  headEnabled: boolean
  orientation?: GazeOrientation
  validation?: Calibration | null
  seedSamples?: CalibrationSample[]
}
export type CalibrationSessionSnapshot = {
  retryable?: boolean
  phase: "intro" | "fixation" | "burst" | "complete" | "error"
  target: Point
  progress: number
  instruction: string
  label: string
}
