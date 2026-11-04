import type { ValidationReading } from "../tracking-calibration/validation-metrics.types"
import { ArrowRight, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import {
  EyeButtonStyles,
  EyeIconButtonStyles,
  EyeSmallStyles,
} from "../tracking-ui/control-styles"
import {
  EyeCalibrationStyles,
  EyeCalibrationTargetStyles,
  EyeCalibrationTopStyles,
  EyeCalibrationWelcomeStyles,
  EyeCalibrationCaptureCancelStyles,
  calibrationCancelTop,
} from "../tracking-ui/calibration-styles"
import { EyeHeadFloatingStyles } from "../tracking-ui/head-tracking-styles"
import { gazeFeature, mapGaze } from "./calibration"
import { CalibrationFeedback } from "./calibration-feedback"
import type { CalibrationOverlayProps } from "./calibration-overlay.types"
import {
  CALIBRATION_READING_MAX_AGE_MS,
  CalibrationSession,
} from "./calibration-session"
import type { CalibrationObservation } from "./calibration-session.types"
import { CalibrationTarget } from "./calibration-target"
import { HeadPreview } from "./head-tracking/head-preview"
import { GazeFrameSynchronizer } from "./head-tracking/head-synchronization"
import {
  SCREEN_CAPTURE_SETTLE_MS,
  screenCalibrationIntroduction,
} from "../tracking-calibration/screen-calibration-protocol"
export function CalibrationOverlay({
  tracker,
  targets,
  repairTargets,
  comfortableHold,
  head,
  calibration,
  validation,
  fitting = false,
  seedSamples,
  orientation,
  onComplete,
  onGridComplete,
  onDiagnosticReading,
  onCancel,
}: CalibrationOverlayProps) {
  const needsHead =
    head.enabled && (!validation || !!calibration?.headCompensation)
  const [session] = useState(
    () =>
      new CalibrationSession({
        screenAspectRatio: window.innerWidth / window.innerHeight,
        headEnabled: needsHead,
        orientation,
        validation: validation ? calibration : null,
        seedSamples,
        targets: repairTargets ?? targets,
        comfortableHold,
      })
  )
  const [snapshot, setSnapshot] = useState(session.snapshot)
  const dialog = useRef<HTMLDivElement | null>(null)
  const complete = useRef(onComplete)
  const submitted = useRef(false)
  const checkpointed = useRef(false)
  const { latest, setSampleTarget, source } = tracker
  const headLatest = head.latest
  const headHistory = head.history
  useEffect(() => {
    complete.current = onComplete
  }, [onComplete])
  useEffect(() => {
    const container = dialog.current
    if (!container || container.contains(document.activeElement)) {
      return
    }
    container
      .querySelector<HTMLButtonElement>("button:not([disabled])")
      ?.focus()
  }, [snapshot.phase])
  useEffect(() => {
    if (snapshot.phase === "intro" || snapshot.phase === "error") {
      setSampleTarget(null)
    } else {
      setSampleTarget(snapshot.target)
    }
    return () => setSampleTarget(null)
  }, [setSampleTarget, snapshot.phase, snapshot.target])
  useEffect(() => {
    const synchronizer = new GazeFrameSynchronizer()
    const attempts: ValidationReading[] = []
    let targetStarted = performance.now()
    let previousTarget = session.snapshot.target
    let previousPhase = session.snapshot.phase
    let lastAttempt = -Infinity
    let lastOutage = -Infinity
    let targetId = -1
    const timer = setInterval(() => {
      if (submitted.current) {
        return
      }
      const now = performance.now()
      const pair = needsHead
        ? synchronizer.read(latest.current, headHistory.current, now)
        : null
      const frame = pair?.eye ?? latest.current
      const feature = frame?.gaze ? gazeFeature(frame.gaze.direction) : null
      let observation: CalibrationObservation | null = null
      if (
        frame &&
        feature &&
        frame.detection.ellipse &&
        frame.detection.ellipse.confidence >= 0.5
      ) {
        observation = {
          id: frame.id,
          timestamp: frame.timestamp,
          feature,
          headPose: pair?.head,
        }
      }
      const before = session.snapshot
      if (
        before.phase === "fixation" &&
        (previousPhase !== "fixation" || previousTarget !== before.target)
      ) {
        targetStarted = now
        targetId++
      }
      previousTarget = before.target
      previousPhase = before.phase
      if (
        validation &&
        calibration &&
        before.phase === "fixation" &&
        frame &&
        frame.timestamp >= targetStarted + SCREEN_CAPTURE_SETTLE_MS &&
        frame.timestamp > lastAttempt &&
        frame.timestamp <= now &&
        attempts.length < 12000
      ) {
        lastAttempt = frame.timestamp
        let point = null
        let reason: string | null = null
        if (!observation || !feature) {
          reason = "eye-lost"
        } else if (now - frame.timestamp > CALIBRATION_READING_MAX_AGE_MS) {
          reason = "stale-eye-reading"
        } else if (needsHead && !pair) {
          reason = "unpaired-head"
        } else {
          point = mapGaze(calibration, feature, pair?.head)
        }
        attempts.push({
          timestamp: frame.timestamp,
          targetId,
          target: [...before.target],
          point,
          reason,
        })
      }
      if (
        validation &&
        before.phase === "fixation" &&
        now >= targetStarted + SCREEN_CAPTURE_SETTLE_MS &&
        (!frame || now - frame.timestamp > CALIBRATION_READING_MAX_AGE_MS) &&
        now - lastOutage >= 200 &&
        attempts.length < 12000
      ) {
        lastOutage = now
        attempts.push({
          timestamp: now,
          targetId,
          target: [...before.target],
          point: null,
          reason: "eye-outage",
        })
      }
      session.observe(observation, now)
      if (
        !validation &&
        needsHead &&
        session.samples.length >= 9 &&
        !checkpointed.current
      ) {
        checkpointed.current = true
        onGridComplete?.(session.samples.slice(0, 9))
      }
      if (before.phase !== "intro" && onDiagnosticReading) {
        let point = null
        if (calibration && feature) {
          point = mapGaze(calibration, feature, pair?.head)
        }
        let status = "paired"
        if (!observation) {
          status = "eye-lost"
        } else if (needsHead && !pair) {
          status = "unpaired"
        }
        onDiagnosticReading({
          mode: validation ? "validation" : "calibration",
          now,
          eye: frame,
          head: headLatest.current,
          pairedHead: pair?.head ?? null,
          point,
          status,
          target: before.target,
          phase: before.phase,
          instruction: session.snapshot.instruction,
        })
      }
      setSnapshot(session.snapshot)
      if (session.snapshot.phase === "complete") {
        submitted.current = true
        complete.current(session.samples, attempts)
      }
    }, 40)
    return () => clearInterval(timer)
  }, [
    needsHead,
    headHistory,
    headLatest,
    latest,
    session,
    onDiagnosticReading,
    calibration,
    validation,
    onGridComplete,
  ])
  function start(): void {
    session.start(performance.now())
    setSnapshot(session.snapshot)
  }
  const intro = snapshot.phase === "intro"
  const failed = snapshot.phase === "error"
  const capturing = !intro && !failed && !fitting
  const waiting =
    snapshot.progress === 0 && snapshot.instruction !== "Look at the dot"
  const headPass = !validation && needsHead && session.samples.length >= 9
  let title = "Look at each dot until it pops"
  let startLabel = "Start calibration"
  let introduction = screenCalibrationIntroduction(needsHead)
  if (seedSamples) {
    title = "Retry head movements"
    startLabel = "Start head pass"
    introduction =
      "Your gaze dots are saved. Watch the center dot while gently moving your head."
  }
  if (validation) {
    title = "Validation test"
    startLabel = "Continue"
    introduction = "Look at each dot until it pops."
  }
  if (failed) {
    title = "Let’s try that again"
  }
  return (
    <div
      ref={dialog}
      className={`eye-calibration ${EyeCalibrationStyles}`}
      role="dialog"
      aria-modal="true"
      aria-label={validation ? "Validate gaze accuracy" : "Calibrate gaze"}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onCancel()
        }
        if (event.key !== "Tab") {
          return
        }
        const buttons = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>(
            "button:not([disabled])"
          )
        )
        const first = buttons[0]
        const last = buttons.at(-1)
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }}
    >
      <div className={`eye-calibration-top ${EyeCalibrationTopStyles}`}>
        <span>{intro || failed || fitting ? snapshot.label : ""}</span>
        <button
          className={`eye-icon-button ${EyeIconButtonStyles} ${capturing ? EyeCalibrationCaptureCancelStyles : ""}`}
          style={{
            top: capturing ? calibrationCancelTop(snapshot.target) : undefined,
          }}
          autoFocus={!intro}
          onClick={onCancel}
          aria-label="Cancel calibration"
          title="Cancel calibration (Esc)"
        >
          <X size={20} />
        </button>
      </div>
      {headPass && !fitting && (
        <button
          className={`eye-button ${EyeButtonStyles}`}
          onClick={() => {
            submitted.current = true
            complete.current(session.samples.slice(0, 9))
          }}
        >
          Finish eye-only calibration
        </button>
      )}
      {head.enabled && (
        <div
          className={`eye-head-floating ${EyeHeadFloatingStyles} ${snapshot.target[0] <= 0.5 ? "on-right" : ""}`}
        >
          <HeadPreview head={head} compact />
        </div>
      )}
      {(intro || failed || fitting) && (
        <div
          className={`eye-calibration-welcome ${EyeCalibrationWelcomeStyles}`}
        >
          <h2>{fitting ? "Fitting calibration…" : title}</h2>
          {intro && !fitting && <p>{introduction}</p>}
          {source?.kind === "sample" && (
            <p className={`eye-small ${EyeSmallStyles}`}>
              Synthetic sample · simulated results
            </p>
          )}
          {failed && (
            <p className="eye-calibration-error" role="alert">
              {snapshot.instruction}
            </p>
          )}
          {!failed && !fitting && (
            <button
              className={`eye-button ${EyeButtonStyles} primary eye-calibration-start`}
              autoFocus
              disabled={!validation && needsHead && head.status !== "tracking"}
              onClick={start}
            >
              {startLabel}
              <ArrowRight size={18} />
            </button>
          )}
          {failed && snapshot.retryable && (
            <button
              className={`eye-button ${EyeButtonStyles} primary`}
              onClick={() => {
                session.retryCurrentTarget(performance.now())
                setSnapshot(session.snapshot)
              }}
            >
              Retry this dot
            </button>
          )}
          {failed && (
            <button
              className={`eye-button ${EyeButtonStyles} primary eye-calibration-start`}
              onClick={onCancel}
            >
              Back to setup
            </button>
          )}
          {intro && needsHead && head.status !== "tracking" && (
            <p className={`eye-small ${EyeSmallStyles}`}>
              Keep your face visible in the front camera to start.
            </p>
          )}
        </div>
      )}
      {!intro && !failed && !fitting && (
        <>
          <div
            className={`eye-calibration-target ${EyeCalibrationTargetStyles}`}
            style={{
              left: `${snapshot.target[0] * 100}%`,
              top: `${snapshot.target[1] * 100}%`,
            }}
          >
            <CalibrationTarget
              key={snapshot.label}
              progress={snapshot.progress}
              bursting={snapshot.phase === "burst"}
            />
          </div>
          <CalibrationFeedback
            target={snapshot.target}
            label={snapshot.label}
            instruction={waiting || headPass ? snapshot.instruction : undefined}
          />
        </>
      )}
    </div>
  )
}
