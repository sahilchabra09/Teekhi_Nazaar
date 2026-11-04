import type { ValidationTargetMetrics } from "./validation-metrics.types"

export type AssessableValidation = {
  rmsPixels: number | null
  p95Pixels: number | null
  jitterPixels: number | null
  targetCount: number
  sampleCount: number
  validFraction?: number
  attemptedTargetCount?: number
  targets?: ValidationTargetMetrics[]
}
export type ValidationAssessment = {
  status: "not-checked" | "incomplete" | "limited" | "checked"
  message: string
}
