import type { GazeOrientation } from "../calibration.types"

export type CalibrationControlsProps = {
  usable: boolean
  locked: boolean
  headReady: boolean
  headEnabled: boolean
  orientation: GazeOrientation
  onOrientationChange: (orientation: GazeOrientation) => void
  onStart: () => void
  onExportDiagnostics?: () => void
}
