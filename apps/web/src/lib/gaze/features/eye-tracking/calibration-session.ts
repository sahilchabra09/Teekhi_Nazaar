import {
  CALIBRATION_TARGETS,
  VALIDATION_TARGETS,
  fitInitialCalibration,
} from "./calibration"
import {
  ScreenCalibrationGuide,
  isScreenCalibrationGrid,
} from "../tracking-calibration/screen-calibration"
import { DEFAULT_GAZE_ORIENTATION } from "./calibration-orientation"
import type {
  CalibrationObservation,
  CalibrationSessionOptions,
  CalibrationSessionSnapshot,
} from "./calibration-session.types"
import type { CalibrationSample, GazeOrientation } from "./calibration.types"
import type { Point } from "./eye-tracking.types"
import {
  relativeHeadPose,
  synchronizedHeadPose,
} from "./head-tracking/head-pose"
import type { HeadPose } from "./head-tracking/head-pose.types"
import {
  SCREEN_CAPTURE_SETTLE_MS,
  SCREEN_TARGET_POP_MS,
  SCREEN_TARGET_TIMEOUT_MS,
  SCREEN_VALIDATION_TIMEOUT_MS,
  SCREEN_FRAME_MAX_AGE_MS,
  SCREEN_ACCEPTED_FRAME_MAX_AGE_MS,
  SCREEN_FIXATION_HOLD,
  SCREEN_HEAD_HOLD,
  SCREEN_VALIDATION_HOLD,
  SCREEN_COMFORTABLE_HOLD,
} from "../tracking-calibration/screen-calibration-protocol"
export const CALIBRATION_READING_MAX_AGE_MS = SCREEN_FRAME_MAX_AGE_MS
const SPATIAL_HEAD_MOTION_LIMITS = [0.025, 0.025, 0.04, 0.04, 0.04, 0.04]
const HEAD_HOLD_INSTRUCTION =
  "Keep watching. Gently turn, nod, tilt and shift nearer or farther."
function averageFeature(points: Point[]): Point {
  const mean: Point = [0, 0]
  for (const point of points) {
    mean[0] += point[0] / points.length
    mean[1] += point[1] / points.length
  }
  return mean
}
function averagePose(
  observations: CalibrationObservation[]
): HeadPose | undefined {
  const last = observations.at(-1)?.headPose
  if (!last) {
    return undefined
  }
  const position: HeadPose["position"] = [0, 0, 0]
  const rotation: HeadPose["rotation"] = [0, 0, 0]
  for (let axis = 0; axis < 3; axis++) {
    let sine = 0
    let cosine = 0
    for (const observation of observations) {
      const pose = observation.headPose!
      position[axis] += pose.position[axis] / observations.length
      sine += Math.sin(pose.rotation[axis])
      cosine += Math.cos(pose.rotation[axis])
    }
    rotation[axis] = Math.atan2(sine, cosine)
  }
  return { ...last, position, rotation }
}
function calibrationSample(
  observations: CalibrationObservation[],
  target: Point,
  headEnabled: boolean
): CalibrationSample {
  const sample: CalibrationSample = {
    feature: averageFeature(observations.map((reading) => reading.feature)),
    target: [...target],
    measurements: observations.map((reading) => ({
      feature: [...reading.feature],
      timestamp: reading.timestamp,
      headPose: reading.headPose,
    })),
  }
  if (headEnabled && observations.every((reading) => reading.headPose)) {
    sample.headPose = averagePose(observations)
    sample.headMeasurements = observations.map((reading) => ({
      feature: [...reading.feature],
      pose: reading.headPose!,
    }))
  }
  return sample
}
export class CalibrationSession {
  readonly samples: CalibrationSample[] = []
  snapshot: CalibrationSessionSnapshot = {
    phase: "intro",
    target: [0.5, 0.5],
    progress: 0,
    instruction: "Look at each dot until it pops",
    label: "CALIBRATION",
  }
  private pointIndex = 0
  private observations: CalibrationObservation[] = []
  private lastEyeId = -1
  private targetStarted = 0
  private burstStarted = 0
  private readonly guide: ScreenCalibrationGuide
  private readonly orientation: GazeOrientation
  private readonly options: CalibrationSessionOptions
  constructor(options: CalibrationSessionOptions) {
    this.options = options
    this.orientation = options.orientation ?? DEFAULT_GAZE_ORIENTATION
    this.guide = new ScreenCalibrationGuide([
      this.orientation.horizontal,
      this.orientation.vertical,
    ])
    if (options.validation) {
      this.snapshot.label = "VALIDATION"
    }
    if (options.seedSamples) {
      this.resumeHeadPass(options.seedSamples)
    }
  }
  private resumeHeadPass(grid: CalibrationSample[]): void {
    const valid =
      this.options.headEnabled &&
      !this.options.validation &&
      isScreenCalibrationGrid(grid.map((sample) => sample.target)) &&
      grid.every(
        (sample) => sample.headPose && sample.feature.every(Number.isFinite)
      )
    const mapping = fitInitialCalibration(grid, this.orientation)
    if (!valid || !mapping) {
      this.updateSnapshot({
        phase: "error",
        instruction:
          "The saved gaze grid is unavailable. Start a new calibration.",
      })
      return
    }
    this.samples.push(...grid)
    this.pointIndex = CALIBRATION_TARGETS.length
    this.updateSnapshot({
      label: "Head compensation",
      instruction: "Keep looking at the center dot while moving your head",
    })
  }
  private get targets(): Point[] {
    if (this.options.validation) {
      return this.options.targets ?? VALIDATION_TARGETS
    }
    if (this.options.headEnabled) {
      return [...CALIBRATION_TARGETS, [0.5, 0.5]]
    }
    return CALIBRATION_TARGETS
  }
  private get headHold(): boolean {
    return (
      this.options.headEnabled &&
      !this.options.validation &&
      this.pointIndex === CALIBRATION_TARGETS.length
    )
  }
  private get hold() {
    if (this.headHold) {
      return SCREEN_HEAD_HOLD
    }
    if (this.options.comfortableHold) {
      return SCREEN_COMFORTABLE_HOLD
    }
    if (this.options.validation) {
      return SCREEN_VALIDATION_HOLD
    }
    return SCREEN_FIXATION_HOLD
  }
  start(now: number): void {
    if (this.snapshot.phase === "intro") {
      this.beginFixation(now)
    }
  }
  retryCurrentTarget(now: number): void {
    if (this.snapshot.phase === "error" && this.snapshot.retryable) {
      this.beginFixation(now)
    }
  }
  private updateSnapshot(next: Partial<CalibrationSessionSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...next }
  }
  private resetCollection(instruction: string): void {
    this.observations = []
    this.updateSnapshot({ progress: 0, instruction })
  }
  private interruptCollection(instruction: string): void {
    if (this.headHold) {
      this.updateSnapshot({ instruction })
      return
    }
    this.resetCollection(instruction)
  }
  private beginFixation(now: number): void {
    this.targetStarted = now
    this.lastEyeId = -1
    this.resetCollection("Look at the dot")
    if (this.headHold) {
      this.resetCollection(HEAD_HOLD_INSTRUCTION)
    }
    let label = "CALIBRATION"
    if (this.options.validation) {
      label = "VALIDATION"
    }
    if (this.headHold) {
      label = "Head compensation"
    }
    let position = this.pointIndex + 1
    let count = this.targets.length
    if (this.options.headEnabled && !this.options.validation) {
      count = CALIBRATION_TARGETS.length
    }
    if (this.headHold) {
      position -= CALIBRATION_TARGETS.length
      count = 1
    }
    this.updateSnapshot({
      phase: "fixation",
      retryable: false,
      target: this.targets[this.pointIndex],
      label: `${label} · ${position} / ${count}`,
    })
  }
  observe(observation: CalibrationObservation | null, now: number): void {
    const phase = this.snapshot.phase
    if (phase === "intro" || phase === "complete" || phase === "error") {
      return
    }
    if (phase === "burst") {
      if (now - this.burstStarted < SCREEN_TARGET_POP_MS) {
        return
      }
      if (this.pointIndex === this.targets.length) {
        this.updateSnapshot({ phase: "complete" })
      } else {
        this.beginFixation(now)
      }
      return
    }
    if (
      !this.options.validation &&
      now - this.targetStarted >= SCREEN_TARGET_TIMEOUT_MS
    ) {
      if (this.headHold) {
        // Missing motion must not erase an accepted nine-dot calibration.
        this.finishHeadHold(now)
        return
      }
      this.updateSnapshot({
        phase: "error",
        retryable: true,
        instruction:
          "This dot could not be captured. Check the eye reading and retry this dot; your completed dots are saved.",
      })
      return
    }
    if (this.options.validation) {
      this.collectValidation(observation, now)
      return
    }
    if (
      !observation ||
      now - observation.timestamp > SCREEN_ACCEPTED_FRAME_MAX_AGE_MS ||
      now < observation.timestamp
    ) {
      this.interruptCollection("Eye lost. Keep your pupil visible.")
      return
    }
    if (!observation.feature.every(Number.isFinite)) {
      this.interruptCollection("Waiting for a clear eye reading")
      return
    }
    // Like remote capture, polling an accepted frame never restarts its hold.
    if (observation.id === this.lastEyeId) {
      return
    }
    if (now - observation.timestamp > SCREEN_FRAME_MAX_AGE_MS) {
      this.interruptCollection("Waiting for a fresh eye reading")
      return
    }
    if (
      this.options.headEnabled &&
      !synchronizedHeadPose(
        observation.headPose ?? null,
        observation.timestamp,
        now
      )
    ) {
      this.interruptCollection("Face lost. Face the front camera.")
      return
    }
    this.lastEyeId = observation.id
    if (observation.timestamp < this.targetStarted + SCREEN_CAPTURE_SETTLE_MS) {
      return
    }
    const previous = this.observations.at(-1)?.timestamp
    if (previous !== undefined && observation.timestamp <= previous) {
      return
    }
    if (
      previous !== undefined &&
      observation.timestamp - previous > SCREEN_FRAME_MAX_AGE_MS
    ) {
      this.resetCollection("Keep looking")
    }
    if (this.headHold) {
      this.observations.push(observation)
      const progress = this.collectionProgress()
      this.updateSnapshot({
        progress,
        instruction: HEAD_HOLD_INSTRUCTION,
      })
      if (progress >= 1) {
        this.finishHeadHold(now)
      }
      return
    }
    this.collectFixation(observation, now)
  }
  private collectValidation(
    observation: CalibrationObservation | null,
    now: number
  ): void {
    const elapsed = now - this.targetStarted
    if (elapsed < SCREEN_CAPTURE_SETTLE_MS) {
      return
    }
    const previousTimestamp = this.observations.at(-1)?.timestamp ?? -Infinity
    if (
      observation &&
      observation.id !== this.lastEyeId &&
      observation.timestamp > previousTimestamp &&
      observation.timestamp >= this.targetStarted + SCREEN_CAPTURE_SETTLE_MS &&
      now >= observation.timestamp &&
      now - observation.timestamp <= CALIBRATION_READING_MAX_AGE_MS &&
      observation.feature.every(Number.isFinite)
    ) {
      this.lastEyeId = observation.id
      if (observation.timestamp - previousTimestamp > SCREEN_FRAME_MAX_AGE_MS) {
        this.observations = []
      }
      this.observations.push(observation)
    }
    const progress = this.collectionProgress()
    const ready = progress >= 1
    this.updateSnapshot({
      progress,
      instruction: "Keep looking",
    })
    if (!ready && elapsed < SCREEN_VALIDATION_TIMEOUT_MS) {
      return
    }
    if (this.observations.length) {
      this.saveFixation(now)
    } else {
      this.pointIndex++
      this.burstStarted = now
      this.updateSnapshot({ phase: "burst", progress: 1 })
    }
  }
  private collectFixation(
    observation: CalibrationObservation,
    now: number
  ): void {
    const feature = observation.feature
    if (!this.guide.matches(feature, this.snapshot.target)) {
      this.resetCollection("Look toward the dot from the center")
      return
    }
    const recent = this.observations.slice(-5).map((reading) => reading.feature)
    recent.push(feature)
    const mean = averageFeature(recent)
    const variance =
      recent.reduce(
        (sum, point) =>
          sum + (point[0] - mean[0]) ** 2 + (point[1] - mean[1]) ** 2,
        0
      ) / recent.length
    let headMoved = false
    const firstPose = this.observations[0]?.headPose
    if (firstPose && observation.headPose) {
      const relative = relativeHeadPose(observation.headPose, firstPose)
      headMoved =
        !relative ||
        relative.some(
          (value, axis) => Math.abs(value) > SPATIAL_HEAD_MOTION_LIMITS[axis]
        )
    }
    if (Math.sqrt(variance) > 0.025 || headMoved) {
      this.resetCollection(
        headMoved ? "Hold your head steady" : "Hold your gaze steady"
      )
      return
    }
    this.observations.push(observation)
    const progress = this.collectionProgress()
    this.updateSnapshot({ progress, instruction: "Keep looking" })
    if (progress < 1) {
      return
    }
    this.saveFixation(now)
  }
  private collectionProgress(): number {
    const first = this.observations[0]?.timestamp ?? 0
    const last = this.observations.at(-1)?.timestamp ?? 0
    return Math.min(
      1,
      (last - first) / this.hold.minimumDurationMs,
      this.observations.length / this.hold.minimumSamples
    )
  }
  private finishHeadHold(now: number): void {
    // One visible hold, independent temporal groups for the existing model's
    // whole-group validation. Every synchronized measurement stays paired.
    const count = Math.min(
      12,
      Math.max(1, Math.floor(this.observations.length / 4))
    )
    for (let index = 0; index < count; index++) {
      const start = Math.floor((index * this.observations.length) / count)
      const end = Math.floor(((index + 1) * this.observations.length) / count)
      const group = this.observations.slice(start, end)
      if (group.length) {
        this.samples.push(calibrationSample(group, [0.5, 0.5], true))
      }
    }
    this.pointIndex++
    this.burstStarted = now
    this.updateSnapshot({ phase: "burst", progress: 1 })
  }
  private saveFixation(now: number): void {
    const sample = calibrationSample(
      this.observations,
      this.snapshot.target,
      this.options.headEnabled
    )
    this.samples.push(sample)
    if (!this.options.validation) {
      this.guide.record(
        this.snapshot.target,
        this.observations.map((reading) => reading.feature)
      )
    }
    this.pointIndex++
    if (
      !this.options.validation &&
      this.pointIndex === CALIBRATION_TARGETS.length
    ) {
      const mapping = fitInitialCalibration(this.samples, this.orientation)
      if (!mapping) {
        this.updateSnapshot({
          phase: "error",
          instruction:
            "The samples did not cover the screen. Check camera orientation and follow each dot.",
        })
        return
      }
    }
    this.burstStarted = now
    this.updateSnapshot({ phase: "burst", progress: 1 })
  }
}
