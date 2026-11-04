import type { ScreenCalibrationHold } from "./screen-calibration-protocol.types"

// Screen, webcam, mobile and remote IR share the same capture experience.
// Their eye measurements and fitted gaze models remain camera-specific.
export const SCREEN_CAPTURE_SETTLE_MS = 700
export const SCREEN_TARGET_POP_MS = 260
export const SCREEN_TARGET_TIMEOUT_MS = 20000
export const SCREEN_VALIDATION_TIMEOUT_MS = 8700
export const SCREEN_FRAME_MAX_AGE_MS = 500
export const SCREEN_ACCEPTED_FRAME_MAX_AGE_MS = 1000

export const SCREEN_FIXATION_HOLD: Readonly<ScreenCalibrationHold> = {
  minimumSamples: 18,
  minimumDurationMs: 600,
}
export const SCREEN_HEAD_HOLD: Readonly<ScreenCalibrationHold> = {
  minimumSamples: 48,
  minimumDurationMs: 6000,
}
export const SCREEN_VALIDATION_HOLD: Readonly<ScreenCalibrationHold> = {
  minimumSamples: 18,
  minimumDurationMs: 1000,
}
export const SCREEN_COMFORTABLE_HOLD: Readonly<ScreenCalibrationHold> = {
  minimumSamples: 4,
  minimumDurationMs: 700,
}

export function screenCalibrationIntroduction(headMovement: boolean): string {
  if (headMovement) {
    return "Follow 9 dots, then watch the center dot while gently moving your head."
  }
  return "Follow 9 dots, including the edges. Keep looking until each dot pops."
}
