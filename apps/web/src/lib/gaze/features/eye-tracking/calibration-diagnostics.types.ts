import type { CalibrationFitResult } from "./calibration-result.types"
import type { CalibrationFitRequest } from "./calibration.worker.types"
import type { Point, TrackingFrame } from "./eye-tracking.types"
import type { HeadPose } from "./head-tracking/head-pose.types"

export type DiagnosticReadingInput = {
  mode: "calibration" | "validation" | "live"
  now: number
  eye: TrackingFrame | null
  head: HeadPose | null
  pairedHead: HeadPose | null
  point: Point | null
  status: string
  target?: Point
  phase?: string
  instruction?: string
}

export type DiagnosticEyeReading = {
  id: number
  timestamp: number
  feature: Point | null
  confidence: number | null
}

export type DiagnosticReading = {
  mode: DiagnosticReadingInput["mode"]
  now: number
  eye: DiagnosticEyeReading | null
  head: HeadPose | null
  pairedHead: HeadPose | null
  point: Point | null
  status: string
  target?: Point
  phase?: string
  instruction?: string
}

export type DiagnosticFitAttempt = CalibrationFitRequest & {
  id: number
  result: CalibrationFitResult | null
  error: string | null
}

export type CalibrationDiagnosticReport = {
  version: 1
  coordinates: {
    eyeFeature: string
    headPose: string
    screenPoint: string
    timing: string
  }
  attempts: DiagnosticFitAttempt[]
  readings: DiagnosticReading[]
}
