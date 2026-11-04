import { CALIBRATION_TARGETS, fitCalibration } from "./calibration"
import type {
  CalibrationFitIssue,
  CalibrationFitResult,
} from "./calibration-result.types"
import type { CalibrationSample, GazeOrientation } from "./calibration.types"
import { fitHeadCompensationWithDiagnostics } from "./head-tracking/head-calibration"
export function evaluateCalibration(
  samples: CalibrationSample[],
  orientation: GazeOrientation,
  screenAspectRatio: number
): CalibrationFitResult {
  // The first nine fixations are the screen grid. Center-only movement holds
  // must never be mixed into an eye-only mapping.
  const grid = samples.slice(0, CALIBRATION_TARGETS.length)
  const screenCalibration = fitCalibration(
    grid.map((sample) => ({ feature: sample.feature, target: sample.target })),
    orientation,
    screenAspectRatio
  )
  let headIssue: CalibrationFitIssue | null = null
  if (samples.some((sample) => sample.headPose)) {
    const headFit = fitHeadCompensationWithDiagnostics(
      samples,
      orientation,
      true,
      screenAspectRatio
    )
    if (headFit.model) {
      return {
        calibration: {
          coefficients: headFit.model.coefficients,
          validationError: headFit.model.validationError,
          headCompensation: headFit.model,
        },
        issue: null,
      }
    }
    headIssue = headFit.issue
  }
  if (!screenCalibration || screenCalibration.validationError > 0.16) {
    return {
      calibration: screenCalibration,
      issue: {
        code: "screen-fit",
        message:
          "The gaze dots did not give a consistent screen mapping. A finite mapping can be used as an unverified preview; accuracy needs checking.",
        measuredError: screenCalibration?.validationError,
      },
    }
  }
  return { calibration: screenCalibration, issue: headIssue }
}
