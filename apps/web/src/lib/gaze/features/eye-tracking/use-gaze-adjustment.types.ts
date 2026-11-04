import type { Point } from "./eye-tracking.types"

export type GazeAdjustment = {
  calibration: object | null
  offset: Point
}
