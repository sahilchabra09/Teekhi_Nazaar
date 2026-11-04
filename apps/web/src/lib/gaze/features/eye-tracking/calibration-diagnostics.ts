import { gazeFeature } from "./calibration"
import type {
  CalibrationDiagnosticReport,
  DiagnosticFitAttempt,
  DiagnosticReading,
  DiagnosticReadingInput,
} from "./calibration-diagnostics.types"
import type { CalibrationFitResult } from "./calibration-result.types"
import type { CalibrationSample } from "./calibration.types"
import type { CalibrationFitRequest } from "./calibration.worker.types"
import type { Point } from "./eye-tracking.types"
import type { HeadPose } from "./head-tracking/head-pose.types"
const MAX_READINGS = 1500
const MAX_ATTEMPTS = 3
const MAX_FIXATIONS = 32
const MAX_FIXATION_READINGS = 60
function copyPoint(point: Point): Point {
  return [point[0], point[1]]
}
/** Select numeric pose fields explicitly. Never retain camera images or source credentials. */
function copyPose(pose: HeadPose | null): HeadPose | null {
  if (!pose) {
    return null
  }
  const result: HeadPose = {
    id: pose.id,
    timestamp: pose.timestamp,
    position: [...pose.position],
    rotation: [...pose.rotation],
  }
  if (pose.measurement) {
    result.measurement = {
      timestamp: pose.measurement.timestamp,
      scale: pose.measurement.scale,
      matrix: pose.measurement.matrix.slice(0, 16),
    }
  }
  return result
}
function copySample(sample: CalibrationSample): CalibrationSample {
  const result: CalibrationSample = {
    feature: copyPoint(sample.feature),
    target: copyPoint(sample.target),
  }
  if (sample.headPose) {
    result.headPose = copyPose(sample.headPose)!
  }
  if (sample.headMeasurements) {
    result.headMeasurements = sample.headMeasurements
      .slice(0, MAX_FIXATION_READINGS)
      .map((measurement) => ({
        feature: copyPoint(measurement.feature),
        pose: copyPose(measurement.pose)!,
      }))
  }
  return result
}
/** Bounded, session-only evidence. Export is explicit; nothing is uploaded or written to storage. */
export class CalibrationDiagnostics {
  private readings: DiagnosticReading[] = []
  private attempts: DiagnosticFitAttempt[] = []
  private nextAttemptId = 0
  private lastReadingKey = ""
  recordReading(input: DiagnosticReadingInput): void {
    const key = JSON.stringify([
      input.mode,
      input.eye?.id,
      input.eye?.timestamp,
      input.head?.id,
      input.head?.timestamp,
      input.pairedHead?.timestamp,
      input.status,
      input.phase,
      input.target,
      input.instruction,
    ])
    if (key === this.lastReadingKey) {
      return
    }
    this.lastReadingKey = key
    const reading: DiagnosticReading = {
      mode: input.mode,
      now: input.now,
      eye: null,
      head: copyPose(input.head),
      pairedHead: copyPose(input.pairedHead),
      point: null,
      status: input.status,
    }
    if (input.eye) {
      let feature: Point | null = null
      if (input.eye.gaze) {
        feature = gazeFeature(input.eye.gaze.direction)
      }
      reading.eye = {
        id: input.eye.id,
        timestamp: input.eye.timestamp,
        feature,
        confidence: input.eye.detection.ellipse?.confidence ?? null,
      }
    }
    if (input.point) {
      reading.point = copyPoint(input.point)
    }
    if (input.target) {
      reading.target = copyPoint(input.target)
    }
    if (input.phase) {
      reading.phase = input.phase
    }
    if (input.instruction) {
      reading.instruction = input.instruction
    }
    this.readings.push(reading)
    if (this.readings.length > MAX_READINGS) {
      this.readings.shift()
    }
  }
  startFit(request: CalibrationFitRequest): number {
    const id = ++this.nextAttemptId
    this.attempts.push({
      id,
      samples: request.samples.slice(0, MAX_FIXATIONS).map(copySample),
      orientation: { ...request.orientation },
      screenAspectRatio: request.screenAspectRatio,
      result: null,
      error: null,
    })
    if (this.attempts.length > MAX_ATTEMPTS) {
      this.attempts.shift()
    }
    return id
  }
  finishFit(
    id: number,
    result: CalibrationFitResult | null,
    error: string | null = null
  ): void {
    const attempt = this.attempts.find((attempt) => attempt.id === id)
    if (!attempt) {
      return
    }
    attempt.result = structuredClone(result)
    attempt.error = error
  }
  clear(): void {
    this.readings = []
    this.attempts = []
    this.lastReadingKey = ""
  }
  snapshot(): CalibrationDiagnosticReport {
    return structuredClone({
      version: 1,
      coordinates: {
        eyeFeature:
          "Eye-camera ratios: direction.x / -direction.z, direction.y / -direction.z",
        headPose:
          "Oriented front-camera frame: +x right, +y up, -z into scene; rotation Rz(roll) Ry(yaw) Rx(pitch)",
        screenPoint:
          "Normalized browser viewport: +x right, +y down; unclamped, before display smoothing",
        timing:
          "Milliseconds on the browser performance clock. Network-camera exposure time is unknown. A measurement timestamp refers to the original face transform, not its interpolated pose.",
      },
      attempts: this.attempts,
      readings: this.readings,
    })
  }
}
