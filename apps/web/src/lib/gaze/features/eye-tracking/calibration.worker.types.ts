import type { CalibrationFitResult } from "./calibration-result.types"
import type { CalibrationSample, GazeOrientation } from "./calibration.types"

export type CalibrationFitRequest = {
  samples: CalibrationSample[]
  orientation: GazeOrientation
  screenAspectRatio: number
}
export type CalibrationFitResponse = CalibrationFitResult & {
  error: string
}
