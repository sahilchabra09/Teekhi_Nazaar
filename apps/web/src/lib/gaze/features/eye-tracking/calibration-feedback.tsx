import {
  EyeCalibrationActionStyles,
  EyeCalibrationCaptionStyles,
  EyeCalibrationFeedbackStyles,
  EyeCalibrationGuidanceStyles,
} from "../tracking-ui/calibration-styles"
import type { CalibrationFeedbackProps } from "./calibration-feedback.types"
/** Keep instructions near fixation without moving the calibrated target coordinates. */
export function CalibrationFeedback({
  target,
  label,
  instruction,
  action,
}: CalibrationFeedbackProps) {
  const above = target[1] > 0.75
  return (
    <div
      className={`eye-calibration-feedback ${EyeCalibrationFeedbackStyles}`}
      style={{
        left: `clamp(12px, calc(${target[0] * 100}% - var(--eye-feedback-width) / 2), calc(100% - var(--eye-feedback-width) - 12px))`,
        top: above
          ? undefined
          : `calc(${target[1] * 100}% + var(--eye-feedback-gap))`,
        bottom: above
          ? `calc(${(1 - target[1]) * 100}% + var(--eye-feedback-gap))`
          : undefined,
      }}
    >
      {label && (
        <span
          className={`eye-calibration-caption ${EyeCalibrationCaptionStyles}`}
        >
          {label}
        </span>
      )}
      <div
        className={`eye-calibration-guidance ${EyeCalibrationGuidanceStyles}`}
      >
        <p role="status">{instruction}</p>
      </div>
      {action && (
        <div
          className={`eye-calibration-action ${EyeCalibrationActionStyles} ${target[0] > 0.5 ? "[transform:translate(-60px,-50%)]" : "[transform:translate(20px,-50%)]"}`}
          style={{
            left: `${target[0] * 100}%`,
            top: `${target[1] * 100}%`,
          }}
        >
          {action}
        </div>
      )}
    </div>
  )
}
