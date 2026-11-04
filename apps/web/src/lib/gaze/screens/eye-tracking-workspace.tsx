import { useDwell } from "@/components/console/use-dwell"
import { assessValidation } from "@/lib/gaze/features/tracking-calibration/validation-assessment"
import { cameraGeometryIdentity } from "@/lib/gaze/features/tracking-calibration/camera-geometry"
import { useScreenGeometry } from "@/lib/gaze/features/tracking-calibration/use-screen-geometry"
import type {
  ValidationMetrics,
  ValidationReading,
} from "@/lib/gaze/features/tracking-calibration/validation-metrics.types"
import { evaluateValidation } from "@/lib/gaze/features/tracking-calibration/validation-metrics"
import { useSessionAlignment } from "@/lib/gaze/features/tracking-calibration/use-session-alignment"
import {
  RETURN_CHECK_TARGETS,
  PERSONAL_RESIDUAL_TARGETS,
  alignGazePoint,
  evaluatePersonalResidual,
  evaluateReturnCheck,
} from "@/lib/gaze/features/tracking-calibration/session-alignment"
import { CalibrationProfileControls } from "@/lib/gaze/features/tracking-calibration/calibration-profile-controls"
import { useSavedCalibration } from "@/lib/gaze/features/tracking-calibration/use-calibration-profiles"
import { useCameraIdentity } from "@/lib/gaze/features/tracking-calibration/use-camera-identity"
import type {
  CalibrationContext,
  CalibrationPayload,
} from "@/lib/gaze/features/tracking-calibration/calibration-profiles.types"
import { IrisMark } from "@/components/iris/logo"
import {
  evaluateScreenValidation,
  screenValidationReadings,
} from "@/lib/gaze/features/eye-tracking/calibration"
import { CalibrationDiagnostics } from "@/lib/gaze/features/eye-tracking/calibration-diagnostics"
import type { DiagnosticReadingInput } from "@/lib/gaze/features/eye-tracking/calibration-diagnostics.types"
import { fitCalibrationInWorker } from "@/lib/gaze/features/eye-tracking/calibration-fit"
import {
  DEFAULT_GAZE_ORIENTATION,
  SAMPLE_GAZE_ORIENTATION,
} from "@/lib/gaze/features/eye-tracking/calibration-orientation"
import { CalibrationOverlay } from "@/lib/gaze/features/eye-tracking/calibration-overlay"
import type { CalibrationFitResult } from "@/lib/gaze/features/eye-tracking/calibration-result.types"
import type { GazeOrientation } from "@/lib/gaze/features/eye-tracking/calibration.types"
import { EyePreview } from "@/lib/gaze/features/eye-tracking/components/eye-preview"
import type { ManualCornerMode } from "@/lib/gaze/features/eye-tracking/components/eye-preview.types"
import { EyeTooltipLayer } from "@/lib/gaze/features/eye-tracking/components/eye-tooltip-layer"
import { PipelinePreviews } from "@/lib/gaze/features/eye-tracking/components/pipeline-previews"
import { SetupStepNavigation } from "@/lib/gaze/features/eye-tracking/components/setup-step-navigation"
import { SetupStepPanel } from "@/lib/gaze/features/eye-tracking/components/setup-step-panel"
import { getTrackerModelLockStatus } from "@/lib/gaze/features/eye-tracking/eye-model"
import type {
  Calibration,
  CalibrationSample,
  FrameSettings,
  Point,
  Rect,
} from "@/lib/gaze/features/eye-tracking/eye-tracking.types"
import { applyGazeOffset } from "@/lib/gaze/features/eye-tracking/gaze-offset"
import { HeadControls } from "@/lib/gaze/features/eye-tracking/head-tracking/head-controls"
import { HeadPreview } from "@/lib/gaze/features/eye-tracking/head-tracking/head-preview"
import { useHeadTracking } from "@/lib/gaze/features/eye-tracking/head-tracking/use-head-tracking"
import { LiveGazeOverlay } from "@/lib/gaze/features/eye-tracking/live-gaze-overlay"
import { CalibrationControls } from "@/lib/gaze/features/eye-tracking/steps/calibration-controls"
import { LiveControls } from "@/lib/gaze/features/eye-tracking/steps/live-controls"
import { ModelControls } from "@/lib/gaze/features/eye-tracking/steps/model-controls"
import { RegionControls } from "@/lib/gaze/features/eye-tracking/steps/region-controls"
import { SourceControls } from "@/lib/gaze/features/eye-tracking/steps/source-controls"
import { ThresholdControls } from "@/lib/gaze/features/eye-tracking/threshold-controls"
import { useCalibratedGaze } from "@/lib/gaze/features/eye-tracking/use-calibrated-gaze"
import { useGazeAdjustment } from "@/lib/gaze/features/eye-tracking/use-gaze-adjustment"
import { useTracker } from "@/lib/gaze/features/eye-tracking/use-tracker"
import { ArrowRight, Eye, ScanEye } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  EyeAppStyles,
  EyeBottomBarStyles,
  EyeFormatsStyles,
  EyePreviewCardStyles,
  EyePreviewColumnStyles,
  EyeTitleRowStyles,
  EyeWorkspaceStyles,
} from "../features/tracking-ui/layout-styles"
import {
  EyeButtonStyles,
  EyeDetailsStyles,
} from "../features/tracking-ui/control-styles"
import {
  EyeModelLockStatusStyles,
  EyePipelineDetailsStyles,
} from "../features/tracking-ui/camera-styles"
import type {
  EyeTrackingWorkspaceProps,
  SetupStepName,
} from "./eye-tracking-workspace.types"
const STEPS: readonly SetupStepName[] = [
  "Camera",
  "Eye region",
  "Eye model",
  "Head tracker",
  "Calibrate",
  "Live gaze",
]
const STEP_TITLES = ["Connect your eye camera", "Frame your eye", "Build your eye model", "Add a head camera", "Calibrate your gaze", "Check your gaze"]
const STEP_HELP: readonly string[] = [
  "Choose the camera that faces your eye, then connect it to see a live preview.",
  "Frame one eye. Keep the pupil’s full movement inside the box, with dark frame edges outside.",
  "Look left, right, up and down, then around the edges to build the eye model.",
  "Optional: connect a front camera. Calibration includes a short head-movement pass.",
  "Look at each dot until it pops, then follow the next one. Keep your face visible if head tracking is enabled.",
  "Check your gaze, validate accuracy, recalibrate, or export a result.",
]
export function EyeTrackingWorkspace({
  onSample, onUse, onClose, controlling, onSetupRequired,
}: EyeTrackingWorkspaceProps) {
  const steps = STEPS
  const stepHelp = STEP_HELP
  const [diagnostics] = useState(() => new CalibrationDiagnostics())
  const [diagnosticsAvailable, setDiagnosticsAvailable] = useState(false)
  const recordDiagnosticReading = useCallback(
    (reading: DiagnosticReadingInput) => {
      diagnostics.recordReading(reading)
      setDiagnosticsAvailable(true)
    },
    [diagnostics]
  )
  const pendingFit = useRef<AbortController | null>(null)
  const [fitting, setFitting] = useState(false)
  useEffect(() => () => pendingFit.current?.abort(), [])
  const screenGeometry = useScreenGeometry()
  const tracker = useTracker()
  const { settings, configure, source, frame, setPreviewMasksEnabled } = tracker
  const head = useHeadTracking(!!source || settings.locked)
  const [orientation, setOrientation] = useState<GazeOrientation>(
    DEFAULT_GAZE_ORIENTATION
  )
  let activeOrientation = orientation
  if (source?.kind === "sample") {
    activeOrientation = SAMPLE_GAZE_ORIENTATION
  }
  const [step, setStep] = useState(0)
  const [regionStepComplete, setRegionStepComplete] = useState(false)
  const [pipelineOpen, setPipelineOpen] = useState(false)
  const [thresholdViewOpen, setThresholdViewOpen] = useState(false)
  const [corner, setCorner] = useState<Point | null>(null)
  const [manualCornerMode, setManualCornerMode] =
    useState<ManualCornerMode | null>(null)
  const [calibration, setCalibration] = useState<Calibration | null>(null)
  const [previewCandidate, setPreviewCandidate] = useState<Calibration | null>(
    null
  )
  const [validation, setValidation] = useState<number | null>(null)
  const [validationMetrics, setValidationMetrics] =
    useState<ValidationMetrics | null>(null)
  const [capture, setCapture] = useState<
    "calibration" | "validation" | "check" | "repair" | null
  >(null)
  const [focusCorrection, setFocusCorrection] = useState(false)
  const [focus, setFocus] = useState(false)
  const [notice, setNotice] = useState("")
  const [savedGazeGrid, setSavedGazeGrid] = useState<CalibrationSample[]>([])
  const [retryHeadPass, setRetryHeadPass] = useState(false)
  let activeCornerMode: ManualCornerMode | null = null
  if (step === 2 && settings.format === "classic" && !settings.locked) {
    activeCornerMode = manualCornerMode
    if (activeCornerMode === null) {
      if (settings.corners) {
        activeCornerMode = "edit"
      } else {
        activeCornerMode = "create"
      }
    }
  }
  const resetCalibrationState = useCallback(() => {
    setFitting(false)
    setCalibration(null)
    setPreviewCandidate(null)
    setValidation(null)
    setValidationMetrics(null)
    setCapture(null)
    setFocus(false)
    setNotice("")
    setSavedGazeGrid([])
    setRetryHeadPass(false)
    setDiagnosticsAvailable(false)
  }, [])
  const clearCalibration = useCallback(() => {
    pendingFit.current?.abort()
    diagnostics.clear()
    resetCalibrationState()
  }, [diagnostics, resetCalibrationState])
  if (calibration && !settings.locked) {
    resetCalibrationState()
    if (!source) setStep(0)
  }
  if (validation !== null && tracker.connection !== "live") {
    setValidation(null)
    setValidationMetrics(null)
  }
  useEffect(() => {
    if (!settings.locked) {
      pendingFit.current?.abort()
      diagnostics.clear()
    }
  }, [settings.locked, diagnostics])
  const measuredGeometry = cameraGeometryIdentity(source, tracker.dimensions)
  const [calibrationGeometry, setCalibrationGeometry] =
    useState(measuredGeometry)
  const geometry = measuredGeometry ?? calibrationGeometry
  if (calibrationGeometry !== geometry) {
    setCalibrationGeometry(geometry)
    resetCalibrationState()
  }
  useEffect(() => {
    pendingFit.current?.abort()
    diagnostics.clear()
  }, [diagnostics, geometry])
  useEffect(() => {
    setPreviewMasksEnabled(
      !controlling && !!source &&
        (thresholdViewOpen || (pipelineOpen && step >= 2))
    )
  }, [
    controlling,
    pipelineOpen,
    setPreviewMasksEnabled,
    source,
    step,
    thresholdViewOpen,
  ])
  const update = useCallback(
    (next: Partial<FrameSettings>) => {
      configure(next)
      clearCalibration()
    },
    [configure, clearCalibration]
  )
  const resetSource = () => {
    head.stop()
    clearCalibration()
    setRegionStepComplete(false)
    setCorner(null)
    setManualCornerMode(null)
  }
  const usable =
    !!frame?.detection.ellipse &&
    (settings.format === "classic" || frame.detection.tracking === "tracking")
  const modelLockStatus = getTrackerModelLockStatus(
    settings,
    tracker.dimensions,
    frame?.model ?? null
  )
  const gazeReading = useCalibratedGaze({
    calibration: settings.locked ? calibration : null,
    eye: tracker.latest,
    head: head.latest,
    headHistory: head.history,
    onDiagnosticReading: recordDiagnosticReading,
  })
  const { offset, setOffset } = useGazeAdjustment(calibration)
  const { alignment, setAlignment } = useSessionAlignment(calibration)
  const cameraIdentity = useCameraIdentity(
    source?.deviceId ?? source?.url ?? ""
  )
  const headDeviceId =
    head.stream?.getVideoTracks()[0]?.getSettings().deviceId ?? ""
  const headIdentity = useCameraIdentity(
    head.enabled ? headDeviceId : "eye-only"
  )
  let eyeModelKey = ""
  if (frame?.model?.ready && settings.locked) {
    eyeModelKey = JSON.stringify({
      center: frame.model.center,
      radius: frame.model.radius,
    })
  }
  const profileContext = useMemo<CalibrationContext | null>(() => {
    if (
      source?.kind === "sample" ||
      source?.kind === "video" ||
      !eyeModelKey ||
      !cameraIdentity ||
      !headIdentity ||
      tracker.dimensions.width <= 0 ||
      !settings.locked
    ) {
      return null
    }
    return {
      version: 1,
      tracker: "screen",
      featureVersion: "near-eye-v1",
      cameraIdentity,
      width: tracker.dimensions.width,
      height: tracker.dimensions.height,
      inputTransform: JSON.stringify(tracker.transform),
      outputSpace: "screen",
      screenAspect: screenGeometry.aspectRatio,
      setupKey: JSON.stringify({
        eyeModel: eyeModelKey,
        viewport: [screenGeometry.width, screenGeometry.height],
        format: settings.format,
        roi: settings.roi,
        corners: settings.corners,
        fov: settings.fov,
        radius: settings.radiusMm,
        orientation: activeOrientation,
        headIdentity,
        headTransform: head.enabled ? head.transform : null,
      }),
      geometryId: null,
    }
  }, [
    source?.kind,
    screenGeometry.width,
    screenGeometry.height,
    screenGeometry.aspectRatio,
    cameraIdentity,
    eyeModelKey,
    headIdentity,
    tracker.dimensions,
    tracker.transform,
    settings,
    activeOrientation,
    head.enabled,
    head.transform,
  ])
  const profilePayload = useMemo<CalibrationPayload | null>(
    () => (calibration ? { kind: "screen", model: calibration } : null),
    [calibration]
  )
  const profiles = useSavedCalibration({
    context: profileContext,
    payload: profilePayload,
    offset,
    alignment,
    ready: !!source && settings.locked,
    disabled: !!capture || fitting,
    onIncompatible: clearCalibration,
    onLoaded: (payload, savedOffset, savedAlignment) => {
      if (payload.kind !== "screen") {
        return
      }
      setPreviewCandidate(null)
      setCalibration(payload.model)
      setOffset(savedOffset, payload.model)
      setAlignment(savedAlignment, payload.model)
      setValidation(null)
      setValidationMetrics(null)
      setSavedGazeGrid([])
      setRetryHeadPass(false)
      setStep(5)
    },
  })
  const screenPoint = applyGazeOffset(
    alignGazePoint(gazeReading.point, alignment),
    offset
  )
  const onscreen = screenPoint && screenPoint.every((v) => v >= 0 && v <= 1)
  const verified = !!calibration && validation !== null && settings.locked && !!source &&
    tracker.connection === "live" && source.kind !== "sample" && source.kind !== "video" &&
    !capture && !fitting && step === 5
  const showHandoff = step === 5 && !capture && !focus && !controlling
  const canContinueWithGaze = showHandoff && verified
  const dashboard = useDwell(onUse, { disabled: !canContinueWithGaze })
  useEffect(() => {
    if (showHandoff) dashboard.ref.current?.focus()
  }, [showHandoff, dashboard.ref])
  useEffect(() => {
    if (controlling && !verified) onSetupRequired()
  }, [controlling, verified, onSetupRequired])
  const x = screenPoint?.[0], y = screenPoint?.[1]
  useEffect(() => {
    const time = gazeReading.timestamp
    if (verified && gazeReading.status === "tracking" && onscreen && x !== undefined && y !== undefined && time !== undefined) {
      onSample({ x, y, time })
    } else {
      onSample(null)
    }
  }, [verified, gazeReading.status, gazeReading.timestamp, onscreen, x, y, onSample])
  const allowed = [
    true,
    !!source,
    regionStepComplete && !!source,
    settings.locked && !!source,
    settings.locked &&
      !!source &&
      (!head.enabled || head.status === "tracking"),
    !!calibration && !!source,
  ]
  let eyeDeviceId = ""
  if (source?.kind === "camera") {
    const activeCamera = tracker.devices.find(
      (device) => device.label === source.name
    )
    eyeDeviceId = source.deviceId || activeCamera?.deviceId || ""
  }
  let continueDisabled = false
  if (step === 0) {
    continueDisabled = !source
  } else if (step === 2) {
    continueDisabled = !modelLockStatus.ready
  } else if (step === 3) {
    continueDisabled = head.enabled && head.status !== "tracking"
  }
  const headRangeSupported = gazeReading.status !== "head-outside-range"
  let focusTitle = "Gaze outside this view"
  let stepDescription = stepHelp[step]
  if (!screenPoint || !headRangeSupported) {
    focusTitle = gazeReading.message
  } else if (onscreen) {
    focusTitle = "Look around."
  }
  if (step === 2 && settings.format === "classic") {
    stepDescription =
      "Create two eye-corner points, then use Edit to adjust their spacing."
  }
  const go = (index: number) => {
    if (allowed[index]) {
      setStep(index)
      setNotice("")
    }
  }
  const finishCapture = useCallback(
    async (samples: CalibrationSample[], attempts?: ValidationReading[]) => {
      if (capture === "repair" && calibration) {
        setCapture(null)
        const repaired = evaluatePersonalResidual(
          attempts?.length
            ? attempts
            : screenValidationReadings(calibration, samples),
          { width: window.innerWidth, height: window.innerHeight },
          !!profileContext
        )
        if (!repaired.alignment) {
          setNotice(repaired.issue)
          return
        }
        setAlignment(repaired.alignment)
        setOffset([0, 0])
        setValidation(null)
        setValidationMetrics(null)
        setNotice("Grid repaired · validate before use")
        return
      }
      if (capture === "check" && calibration) {
        setCapture(null)
        const currentReadings = attempts?.length
          ? attempts.map((reading) => ({
              ...reading,
              point: applyGazeOffset(
                alignGazePoint(reading.point, alignment),
                offset
              ),
            }))
          : screenValidationReadings(calibration, samples, offset, alignment)
        const viewport = {
          width: window.innerWidth,
          height: window.innerHeight,
        }
        const baselineMetrics = evaluateValidation(currentReadings, viewport)
        const checked = evaluateReturnCheck(currentReadings, viewport)
        if (!checked.offset || checked.metrics.rmsPixels === null) {
          setValidation(null)
          setValidationMetrics(baselineMetrics)
          setNotice(checked.issue)
          return
        }
        const correctedOffset: Point = [
          offset[0] + checked.offset[0],
          offset[1] + checked.offset[1],
        ]
        if (correctedOffset.some((value) => Math.abs(value) > 1)) {
          setValidation(null)
          setValidationMetrics(baselineMetrics)
          setNotice("Correction is outside the supported range. Recalibrate.")
          return
        }
        setOffset(correctedOffset)
        setValidationMetrics(checked.metrics)
        const assessment = assessValidation(
          checked.metrics,
          { width: window.innerWidth, height: window.innerHeight },
          3,
          4
        )
        setValidation(
          assessment.status === "checked" ? checked.metrics.rmsPixels : null
        )
        setNotice(assessment.message)
        setStep(5)
        return
      }
      if (capture === "validation" && calibration) {
        setCapture(null)
        const measured = attempts?.length
          ? evaluateValidation(
              attempts.map((reading) => ({
                ...reading,
                point: applyGazeOffset(
                  alignGazePoint(reading.point, alignment),
                  offset
                ),
              })),
              { width: window.innerWidth, height: window.innerHeight }
            )
          : evaluateScreenValidation(
              calibration,
              samples,
              { width: window.innerWidth, height: window.innerHeight },
              offset,
              alignment
            )
        setValidationMetrics(measured)
        const assessment = assessValidation(
          measured,
          { width: window.innerWidth, height: window.innerHeight },
          5
        )
        setValidation(
          assessment.status === "checked" ? measured.rmsPixels : null
        )
        setNotice(assessment.message)
        setStep(5)
        return
      }
      pendingFit.current?.abort()
      const controller = new AbortController()
      pendingFit.current = controller
      setFitting(true)
      const request = {
        samples,
        orientation: activeOrientation,
        screenAspectRatio: window.innerWidth / window.innerHeight,
      }
      const attempt = diagnostics.startFit(request)
      setDiagnosticsAvailable(true)
      let result: CalibrationFitResult
      try {
        result = await fitCalibrationInWorker(request, controller.signal)
      } catch (error) {
        if (controller.signal.aborted) {
          diagnostics.finishFit(attempt, null, "Calibration cancelled.")
          return
        }
        let message = "Calibration failed. Please retry."
        if (error instanceof Error) {
          message = error.message
        }
        diagnostics.finishFit(attempt, null, message)
        setNotice(message)
        setCapture(null)
        setFitting(false)
        pendingFit.current = null
        return
      }
      if (controller.signal.aborted) {
        return
      }
      diagnostics.finishFit(attempt, result)
      pendingFit.current = null
      setCapture(null)
      setFitting(false)
      setRetryHeadPass(false)
      if (!result.calibration) {
        setNotice(result.issue?.message ?? "Calibration could not be fitted.")
        return
      }
      if (result.issue && calibration) {
        setPreviewCandidate(result.calibration)
        setSavedGazeGrid(samples.slice(0, 9))
        setNotice(
          "Previous calibration retained. The new fit is available as an unverified preview."
        )
        return
      }
      setPreviewCandidate(null)
      setCalibration(result.calibration)
      setSavedGazeGrid(samples.slice(0, 9))
      setValidation(null)
      setValidationMetrics(null)
      setStep(5)
      setCapture("validation")
      if (result.issue) {
        setNotice(`Unverified eye-only preview. ${result.issue.message}`)
      } else {
        setNotice("Calibration saved for this session.")
      }
    },
    [
      capture,
      calibration,
      activeOrientation,
      diagnostics,
      offset,
      alignment,
      profileContext,
      setAlignment,
      setOffset,
    ]
  )
  const canRetryHead =
    head.enabled &&
    savedGazeGrid.length === 9 &&
    savedGazeGrid.every(
      (sample) => !!sample.headPose && sample.feature.every(Number.isFinite)
    )
  function retryHeadCalibration(): void {
    setFocus(false)
    setNotice("")
    setRetryHeadPass(true)
    setCapture("calibration")
  }
  useEffect(() => {
    const width = window.innerWidth
    const height = window.innerHeight
    const resized = () => {
      if (width === window.innerWidth && height === window.innerHeight) return
      if (!calibration && !capture && !focus) {
        return
      }
      setStep((current) => Math.min(current, 4))
      clearCalibration()
      setNotice("Window size changed. Calibrate again for this view.")
    }
    window.addEventListener("resize", resized)
    return () => window.removeEventListener("resize", resized)
  }, [calibration, capture, focus, clearCalibration])
  function chooseRegion(roi: Rect) {
    if (
      roi.x === settings.roi.x &&
      roi.y === settings.roi.y &&
      roi.width === settings.roi.width &&
      roi.height === settings.roi.height
    ) {
      return
    }
    update({ roi, corners: null })
    setStep(1)
    setRegionStepComplete(false)
    setCorner(null)
    setManualCornerMode(null)
  }
  function chooseCorner(point: Point) {
    if (!corner) {
      setCorner(point)
      setNotice("")
      return
    }
    if (Math.hypot(point[0] - corner[0], point[1] - corner[1]) < 12) {
      setNotice("Place the corners farther apart.")
      return
    }
    update({ corners: [corner, point] })
    setCorner(null)
    setManualCornerMode("edit")
  }
  function changeManualCornerMode(mode: ManualCornerMode) {
    if (mode === "edit" && !settings.corners) {
      return
    }
    setCorner(null)
    setNotice("")
    setManualCornerMode(mode)
  }
  function moveCorners(corners: [Point, Point]) {
    update({ corners })
  }
  function exportResult() {
    if (!frame && !diagnosticsAvailable) {
      return
    }
    const data = {
      format: settings.format === "classic" ? "Eye Tracker 1" : "Eye Tracker 2",
      simulated: source?.kind === "sample",
      timestamp: new Date().toISOString(),
      coordinates:
        "camera: +x right, +y down, +z away; screen: normalized viewport",
      settings,
      pupil: frame?.detection.ellipse ?? null,
      eyeModel: frame?.model ?? null,
      gaze: frame?.gaze ?? null,
      screenPosition: screenPoint,
      gazeOffset: offset,
      sessionAlignment: alignment,
      calibration,
      headPose: head.latest.current,
      validationErrorPixels: validation,
      validationMetrics,
      headCameraTransform: head.transform,
      eyeCameraOrientation: activeOrientation,
      eyeSourceKind: source?.kind ?? null,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      diagnostics: diagnostics.snapshot(),
    }
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
    )
    const a = document.createElement("a")
    a.href = url
    a.download = "iris-v2-result.json"
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  // The camera, worker and calibration belong to this workspace. Only its
  // setup views are removed while the dashboard consumes measured frames.
  if (controlling) return null

  return (
    <main
      className={`eye-app ${EyeAppStyles}`}
    >
      <EyeTooltipLayer />
      <header className={EyeTitleRowStyles}>
        <IrisMark size={44} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-pine-soft">Patient dashboard</p>
          <h1 className="font-display text-2xl font-bold leading-tight sm:text-3xl">Eye tracking setup</h1>
        </div>
        <button type="button" aria-label={verified ? "Stop tracking" : "Close tracker"} className={`eye-button secondary ${EyeButtonStyles}`} onClick={onClose}>{verified ? "Stop tracking" : "Close"}</button>
      </header>
      {showHandoff && (
        <section aria-labelledby="dashboard-handoff-title" className="mx-auto w-full max-w-6xl px-4 pb-5 sm:px-8">
          <div className="clay flex flex-col gap-4 rounded-3xl bg-surface p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div>
              <h2 id="dashboard-handoff-title" className="font-display text-2xl font-bold">
                {verified ? "Your gaze is ready" : "Gaze control is off"}
              </h2>
              <p className="mt-1 text-pine-soft">
                {verified
                  ? "Look at the button for a moment, or click it to open your dashboard."
                  : "You can open the dashboard with touch or a mouse. To use gaze, complete the accuracy check with a live eye camera."}
              </p>
            </div>
            <button
              type="button"
              ref={dashboard.ref}
              {...(canContinueWithGaze ? dashboard.props : { onClick: onClose })}
              data-gaze-continue={canContinueWithGaze ? "" : undefined}
              className="relative flex min-h-16 shrink-0 items-center justify-center gap-2 overflow-hidden rounded-2xl bg-pine px-6 text-lg font-bold text-white"
            >
              <span className="dwell-fill" />
              <span className="relative">Continue to dashboard</span>
              <ArrowRight className="relative size-5" aria-hidden="true" />
            </button>
          </div>
        </section>
      )}
      <SetupStepNavigation
        steps={steps}
        activeStep={step}
        completedSteps={
          new Set(
            allowed.flatMap((canSelect, index) =>
              canSelect && index < step ? [index] : []
            )
          )
        }
        availableSteps={
          new Set(
            allowed.flatMap((canSelect, index) => (canSelect ? [index] : []))
          )
        }
        onSelectStep={go}
      />
      <div
        className={`eye-workspace ${EyeWorkspaceStyles}`}
      >
        {(
          <SetupStepPanel
            stepName={STEP_TITLES[step]}
            description={stepDescription}
            error={tracker.error}
            message={notice}
          >
            {previewCandidate && (
              <button
                className={`eye-button ${EyeButtonStyles} secondary`}
                onClick={() => {
                  setCalibration(previewCandidate)
                  setPreviewCandidate(null)
                  setValidation(null)
                  setValidationMetrics(null)
                  setNotice("Unverified preview · accuracy needs checking")
                  setStep(5)
                }}
              >
                Use unverified preview
              </button>
            )}
            {head.enabled && step !== 3 && !capture && !focus && (
              <HeadPreview head={head} inline />
            )}
            {step === 0 && (
              <SourceControls
                tracker={tracker}
                role="eye"
                resetSource={resetSource}
              />
            )}
            {step === 1 && (
              <RegionControls tracker={tracker} chooseRegion={chooseRegion} />
            )}
            {step === 2 && (
              <ModelControls
                tracker={tracker}
                corner={corner}
                update={update}
                setNotice={setNotice}
              />
            )}
            {step === 3 && (
              <HeadControls
                head={head}
                devices={tracker.devices}
                eyeDeviceId={eyeDeviceId}
                simulated={source?.kind === "sample"}
                onConfigurationChange={clearCalibration}
                onSkip={() => {
                  head.stop()
                  clearCalibration()
                  setStep(4)
                }}
              />
            )}
            {(step === 4 || step === 5) && (
              <CalibrationProfileControls
                controller={profiles}
                sceneLabels={false}
              />
            )}
            {step === 4 && canRetryHead && (
              <button
                className={`eye-button ${EyeButtonStyles} secondary`}
                disabled={head.status !== "tracking"}
                onClick={retryHeadCalibration}
              >
                Resume head movements from saved gaze dots
              </button>
            )}
            {step === 4 && (
              <CalibrationControls
                usable={usable}
                locked={settings.locked}
                headReady={!head.enabled || head.status === "tracking"}
                headEnabled={head.enabled}
                onExportDiagnostics={
                  diagnosticsAvailable ? exportResult : undefined
                }
                orientation={activeOrientation}
                onOrientationChange={(next) => {
                  clearCalibration()
                  setOrientation(next)
                }}
                onStart={() => {
                  setPreviewCandidate(null)
                  setNotice("")
                  setRetryHeadPass(false)
                  setCapture("calibration")
                }}
              />
            )}
            {step === 5 && (
              <LiveControls
                tracker={tracker}
                calibration={calibration}
                screenPoint={screenPoint}
                validation={
                  gazeReading.status === "tracking" ? validation : null
                }
                measuredValidation={validationMetrics?.rmsPixels ?? null}
                validationStatus={
                  !headRangeSupported
                    ? gazeReading.message
                    : assessValidation(
                        validationMetrics,
                        {
                          width: window.innerWidth,
                          height: window.innerHeight,
                        },
                        validationMetrics?.attemptedTargetCount === 3 ? 3 : 5,
                        validationMetrics?.attemptedTargetCount === 3 ? 4 : 12
                      ).message
                }
                usable={usable}
                gazeMessage={gazeReading.message}
                headCompensated={!!calibration?.headCompensation}
                onRetryHeadCalibration={
                  canRetryHead ? retryHeadCalibration : undefined
                }
                retryHeadDisabled={head.status !== "tracking"}
                onFocus={() => {
                  setFocusCorrection(false)
                  setFocus(true)
                }}
                onCorrect={() => {
                  setFocusCorrection(true)
                  setFocus(true)
                }}
                onRepair={
                  profileContext ? () => setCapture("repair") : undefined
                }
                onQuickCheck={() => setCapture("check")}
                onValidate={() => setCapture("validation")}
                onRecalibrate={() => {
                  setRetryHeadPass(false)
                  setStep(4)
                }}
                offset={offset}
                onOffsetChange={(value) => {
                  setOffset(value)
                  setValidation(null)
                  setValidationMetrics(null)
                }}
                onExport={exportResult}
              />
            )}
            {step <= 3 && (step > 0 || source) && (
              <footer
                className={`eye-bottom-bar ${EyeBottomBarStyles} ${step === 2 ? "has-model-status" : ""}`}
              >
                <div>
                  {step === 2 && (
                    <span
                      className={`eye-model-lock-status ${EyeModelLockStatusStyles}`}
                      id="eye-model-lock-status"
                      role="status"
                      aria-live="polite"
                    >
                      {modelLockStatus.blocker === "waiting" && "Waiting for pupil"}
                      {modelLockStatus.blocker === "corners" &&
                        "Place two separate eye corners"}
                      {modelLockStatus.blocker === "samples" &&
                        `Stable samples ${frame?.model?.samples ?? 0}/30`}
                      {modelLockStatus.blocker === "coverage" &&
                        `Coverage ${modelLockStatus.coveredDirections}/8 · needs ${modelLockStatus.requiredDirections}`}
                      {modelLockStatus.blocker === "radius" &&
                        "Check the eye region, then rebuild"}
                      {modelLockStatus.blocker === "fit" && "Keep gaze steady"}
                      {modelLockStatus.blocker === "ready" && "Model ready"}
                    </span>
                  )}
                  <button
                    className={`eye-button ${EyeButtonStyles} primary`}
                    disabled={continueDisabled}
                    aria-describedby={
                      step === 2 ? "eye-model-lock-status" : undefined
                    }
                    onClick={() => {
                      if (step === 1) {
                        setRegionStepComplete(true)
                      }
                      if (step === 2) {
                        configure({ locked: true }, false)
                      }
                      setStep((s) => s + 1)
                    }}
                  >
                    {step === 2 ? "Lock model" : "Continue"}
                    <ArrowRight size={16} />
                  </button>
                </div>
              </footer>
            )}
            <details className="mt-5 border-t border-pine/10 pt-3">
              <summary className="cursor-pointer py-2 text-sm font-semibold text-teal">Camera tuning</summary>
              <p className="mb-2 mt-3 text-sm font-semibold text-pine">Eye model</p>
              <div
                className={`eye-formats ${EyeFormatsStyles}`}
                aria-label="Tracker format"
              >
                {(["classic", "spatial"] as const).map((format, i) => (
                  <button
                    key={format}
                    aria-label={`Eye Tracker ${i + 1}: ${i === 0 ? "Manual" : "Auto"} tracking`}
                    title={i === 0 ? "Manual eye model" : "Automatic eye model"}
                    aria-pressed={settings.format === format}
                    onClick={() => {
                      if (format === settings.format) {
                        return
                      }
                      update({ format })
                      setStep(0)
                      setRegionStepComplete(false)
                      setCorner(null)
                      setManualCornerMode(null)
                    }}
                  >
                    {i === 0 ? (
                      <Eye size={16} aria-hidden="true" />
                    ) : (
                      <ScanEye size={16} aria-hidden="true" />
                    )}
                    <span>{i === 0 ? "Manual" : "Auto"}</span>
                  </button>
                ))}
              </div>
              <div className="mt-4"><ThresholdControls tracker={tracker} update={update} /></div>
            </details>
          </SetupStepPanel>
        )}
        <section
          className={`eye-preview-column ${EyePreviewColumnStyles}`}
          aria-label="Eye camera preview"
        >
          <div
            className={`eye-preview-card ${EyePreviewCardStyles} ${source ? "has-source" : "is-empty"}`}
          >
            <EyePreview
              tracker={tracker}
              showModel={step >= 2}
              selectRegion={step === 1}
              cornerMode={activeCornerMode}
              pendingCorner={corner}
              onRegion={chooseRegion}
              onCorner={chooseCorner}
              onCornerModeChange={changeManualCornerMode}
              onMoveCorners={moveCorners}
              onMovePendingCorner={setCorner}
              onEditRegion={() => {
                setStep(1)
                setNotice("")
              }}
              onThresholdViewChange={setThresholdViewOpen}
              onTransformChange={() => {
                resetSource()
                setStep(1)
                setNotice(
                  "Camera orientation changed. Select the eye region and rebuild the eye model."
                )
              }}
            />
            <details
              className={`eye-details ${EyeDetailsStyles} eye-pipeline-details ${EyePipelineDetailsStyles}`}
              hidden={!source || step < 2}
              onToggle={(event) => setPipelineOpen(event.currentTarget.open)}
            >
              <summary>
                {settings.format === "spatial"
                  ? "Threshold comparison"
                  : "Pupil segmentation"}
                <span>
                  {frame?.detection.ellipse
                    ? Math.round(frame.detection.ellipse.confidence * 100) +
                      "% fit"
                    : "No pupil"}
                </span>
              </summary>
              {pipelineOpen && source && step >= 2 && (
                <PipelinePreviews frame={frame} />
              )}
            </details>
          </div>
        </section>
      </div>
      {capture && (
        <CalibrationOverlay
          key={capture}
          tracker={tracker}
          head={head}
          calibration={calibration}
          validation={capture !== "calibration"}
          targets={capture === "check" ? RETURN_CHECK_TARGETS : undefined}
          repairTargets={
            capture === "repair" ? PERSONAL_RESIDUAL_TARGETS : undefined
          }
          comfortableHold={capture === "check" || capture === "repair"}
          fitting={fitting}
          seedSamples={retryHeadPass ? savedGazeGrid : undefined}
          orientation={activeOrientation}
          onGridComplete={setSavedGazeGrid}
          onComplete={finishCapture}
          onDiagnosticReading={recordDiagnosticReading}
          onCancel={() => {
            pendingFit.current?.abort()
            setFitting(false)
            setCapture(null)
          }}
        />
      )}
      {focus && (
        <LiveGazeOverlay
          initiallyCorrecting={focusCorrection}
          onOffsetChange={(value) => {
            setOffset(value)
            setValidation(null)
            setValidationMetrics(null)
          }}
          point={screenPoint}
          timestamp={gazeReading.timestamp ?? null}
          validationErrorPixels={validationMetrics?.rmsPixels ?? null}
          verified={validation !== null && gazeReading.status === "tracking"}
          resetKey={calibration}
          offset={offset}
          title={focusTitle}
          simulated={source?.kind === "sample"}
          head={head}
          onClose={() => setFocus(false)}
        />
      )}
    </main>
  )
}
