import { useState } from "react"
import type { Point } from "./eye-tracking.types"
import type { GazeAdjustment } from "./use-gaze-adjustment.types"
const ZERO_OFFSET: Point = [0, 0]
/** Screen and remote corrections last for the current calibration only. */
export function useGazeAdjustment(calibration: object | null) {
  const [adjustment, setAdjustment] = useState<GazeAdjustment>({
    calibration,
    offset: ZERO_OFFSET,
  })
  // Reset during render so a new model never receives an old correction.
  if (adjustment.calibration !== calibration) {
    setAdjustment({ calibration, offset: ZERO_OFFSET })
  }
  const offset =
    adjustment.calibration === calibration ? adjustment.offset : ZERO_OFFSET
  function setOffset(value: Point, model: object | null = calibration): void {
    setAdjustment({ calibration: model, offset: value })
  }
  return { offset, setOffset }
}
