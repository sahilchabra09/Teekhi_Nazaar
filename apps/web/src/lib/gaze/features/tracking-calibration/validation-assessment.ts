import type {
  AssessableValidation,
  ValidationAssessment,
} from "./validation-assessment.types"
import type { ValidationViewport } from "./validation-metrics.types"

/** Measurement quality is separate from whether a finite mapping can be previewed. */
export function assessValidation(
  metrics: AssessableValidation | null,
  viewport: ValidationViewport,
  expectedTargetCount: number,
  minimumSamplesPerTarget = 12
): ValidationAssessment {
  if (!metrics) {
    return {
      status: "not-checked",
      message: "Unverified preview · accuracy not checked",
    }
  }
  const readings = metrics.targets ?? []
  const missingReadings = readings.some(
    (target) =>
      target.rmsPixels === null ||
      target.p95Pixels === null ||
      target.jitterPixels === null ||
      target.sampleCount < minimumSamplesPerTarget ||
      (target.validFraction ?? 0) < 0.9
  )
  if (
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    !Number.isFinite(viewport.width + viewport.height) ||
    metrics.targetCount !== expectedTargetCount ||
    metrics.attemptedTargetCount !== expectedTargetCount ||
    readings.length !== expectedTargetCount ||
    (metrics.validFraction ?? 0) < 0.9 ||
    missingReadings
  ) {
    return {
      status: "incomplete",
      message: "Unverified preview · check incomplete",
    }
  }
  const diagonal = Math.hypot(viewport.width, viewport.height)
  const errorLimit = Math.max(12, diagonal * 0.025)
  const jitterLimit = Math.max(8, diagonal * 0.015)
  const limited = readings.some(
    (target) =>
      !Number.isFinite(target.rmsPixels) ||
      !Number.isFinite(target.p95Pixels) ||
      !Number.isFinite(target.jitterPixels) ||
      target.rmsPixels! > errorLimit ||
      target.p95Pixels! > errorLimit * 1.5 ||
      target.jitterPixels! > jitterLimit
  )
  if (limited) {
    return {
      status: "limited",
      message: "Unverified preview · accuracy is limited",
    }
  }
  return { status: "checked", message: "Accuracy checked" }
}
