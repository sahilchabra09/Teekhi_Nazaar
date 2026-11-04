import type { Calibration, Point } from "../eye-tracking.types"
import type { TrackerController } from "../use-tracker.types"

export type LiveControlsProps = {
  tracker: TrackerController
  calibration: Calibration | null
  screenPoint: Point | null
  validation: number | null
  measuredValidation?: number | null
  validationStatus?: string
  usable: boolean
  gazeMessage: string
  headCompensated: boolean
  onRetryHeadCalibration?: () => void
  retryHeadDisabled?: boolean
  onCorrect: () => void
  onFocus: () => void
  onRepair?: () => void
  onQuickCheck?: () => void
  onValidate: () => void
  onRecalibrate: () => void
  onExport: () => void
  offset: Point
  onOffsetChange: (offset: Point) => void
}
