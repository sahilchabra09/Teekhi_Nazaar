import type { Point } from "./eye-tracking.types"
import type { HeadTrackingController } from "./head-tracking/use-head-tracking.types"

export type LiveGazeOverlayProps = {
  onOffsetChange: (offset: Point) => void
  initiallyCorrecting?: boolean
  point: Point | null
  timestamp: number | null
  validationErrorPixels: number | null
  verified?: boolean
  resetKey?: unknown
  offset?: Point
  title: string
  simulated: boolean
  head: HeadTrackingController
  onClose: () => void
}
