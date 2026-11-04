import type { MutableRefObject } from "react"
import type { DiagnosticReadingInput } from "./calibration-diagnostics.types"
import type { Calibration, TrackingFrame } from "./eye-tracking.types"
import type { HeadPose } from "./head-tracking/head-pose.types"

export type UseCalibratedGazeOptions = {
  calibration: Calibration | null
  eye: MutableRefObject<TrackingFrame | null>
  head: MutableRefObject<HeadPose | null>
  headHistory?: MutableRefObject<HeadPose[]>
  onDiagnosticReading?: (reading: DiagnosticReadingInput) => void
}
