import type { Point } from "./eye-tracking.types"

export type ScreenGazeReading = {
  point: Point | null
  /** Original paired eye-frame time; a UI poll must not refresh it. */
  timestamp?: number
  status:
    | "not-calibrated"
    | "eye-lost"
    | "head-lost"
    | "head-outside-range"
    | "outside-screen"
    | "tracking"
  message: string
}
