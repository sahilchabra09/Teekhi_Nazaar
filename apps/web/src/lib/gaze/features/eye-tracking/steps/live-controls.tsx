import {
  ChevronDown,
  Crosshair,
  Download,
  Maximize2,
  RotateCcw,
  UserRound,
} from "lucide-react"
import {
  EyeActionRowStyles,
  EyeButtonStyles,
  EyeDetailsStyles,
  EyeGazeMapStyles,
  EyeLiveCoordinatesStyles,
  EyeStatusIndicatorStyles,
  EyeValidationStyles,
} from "../../tracking-ui/control-styles"
import { EyeActionButton } from "../components/eye-action-button"
import { GazeOffsetControls } from "../components/gaze-offset-controls"
import { HelpTip } from "../components/help-tip"
import type { LiveControlsProps } from "./live-controls.types"
export function LiveControls({
  tracker,
  calibration,
  screenPoint,
  validation,
  measuredValidation = validation,
  validationStatus,
  usable,
  gazeMessage,
  headCompensated,
  onRetryHeadCalibration,
  retryHeadDisabled = false,
  onFocus,
  onCorrect,
  onValidate,
  onQuickCheck,
  onRepair,
  onRecalibrate,
  onExport,
  offset,
  onOffsetChange,
}: LiveControlsProps) {
  const { source, frame } = tracker
  let measurementStatus = validationStatus ?? "Unverified preview"
  if (validation !== null) {
    measurementStatus = "Accuracy checked"
  } else if (measurementStatus === "Accuracy checked") {
    measurementStatus = "Unverified preview · check incomplete"
  }
  const onscreen = screenPoint && screenPoint.every((v) => v >= 0 && v <= 1)
  let positionLabel = "Gaze is outside this view"
  if (!screenPoint) {
    positionLabel = gazeMessage
  } else if (onscreen) {
    positionLabel = "Screen position"
  }
  return (
    <>
      <div className={`eye-gaze-map ${EyeGazeMapStyles}`}>
        <span className="map-center-x" />
        <span className="map-center-y" />
        {onscreen && (
          <i
            style={{
              left: `${screenPoint![0] * 100}%`,
              top: `${screenPoint![1] * 100}%`,
            }}
          />
        )}
        <span>{positionLabel}</span>
      </div>
      <div className={`eye-live-coordinates ${EyeLiveCoordinatesStyles}`}>
        <span>
          X <b>{screenPoint ? `${(screenPoint[0] * 100).toFixed(1)}%` : "—"}</b>
        </span>
        <span>
          Y <b>{screenPoint ? `${(screenPoint[1] * 100).toFixed(1)}%` : "—"}</b>
        </span>
        {headCompensated && (
          <span
            className={`eye-status-indicator ${EyeStatusIndicatorStyles}`}
            role="img"
            aria-label="Head compensation active"
            title="Head compensation active"
            data-tooltip="Head compensation active"
          >
            <UserRound size={16} aria-hidden="true" />
          </span>
        )}
        {!headCompensated && <span>Eye-only</span>}
      </div>
      <div
        className={`eye-action-row ${EyeActionRowStyles}`}
        role="group"
        aria-label="Gaze actions"
      >
        <EyeActionButton
          label="Open gaze view"
          className={`eye-button ${EyeButtonStyles} primary`}
          disabled={!calibration}
          onClick={onFocus}
        >
          <Maximize2 size={17} aria-hidden="true" />
        </EyeActionButton>
        <EyeActionButton
          label="Validate with 5 points"
          disabled={!usable || !calibration}
          onClick={onValidate}
        >
          <Crosshair size={17} aria-hidden="true" />
        </EyeActionButton>
        {onRepair && (
          <EyeActionButton
            label="Trial grid repair · 5 inset dots over this calibration"
            disabled={!usable || !calibration}
            onClick={onRepair}
          >
            <RotateCcw size={17} aria-hidden="true" />
          </EyeActionButton>
        )}
        {onQuickCheck && (
          <EyeActionButton
            label="Quick check · 3 comfortable dots"
            disabled={!usable || !calibration}
            onClick={onQuickCheck}
          >
            <Crosshair size={17} aria-hidden="true" />
          </EyeActionButton>
        )}
        <EyeActionButton label="Recalibrate" onClick={onRecalibrate}>
          <RotateCcw size={17} aria-hidden="true" />
        </EyeActionButton>
        {onRetryHeadCalibration && (
          <EyeActionButton
            label="Retry head movements"
            disabled={!usable || retryHeadDisabled}
            onClick={onRetryHeadCalibration}
          >
            <UserRound size={17} aria-hidden="true" />
          </EyeActionButton>
        )}
        <EyeActionButton
          label="Export result"
          disabled={!frame}
          onClick={onExport}
        >
          <Download size={17} aria-hidden="true" />
        </EyeActionButton>
      </div>
      <GazeOffsetControls
        onCorrect={onCorrect}
        offset={offset}
        width={window.innerWidth}
        height={window.innerHeight}
        disabled={!calibration}
        onChange={onOffsetChange}
      />
      <div
        className={`eye-validation ${EyeValidationStyles}`}
        data-verified={validation !== null}
      >
        <span>
          {source?.kind === "sample" ? "Simulated error" : "Validation error"}
        </span>
        <strong>
          {measuredValidation === null || !Number.isFinite(measuredValidation)
            ? "—"
            : `${measuredValidation.toFixed(0)} px RMS`}
        </strong>
        <span>{measurementStatus}</span>
        <HelpTip
          label="Validation details"
          text={`Five-point validation reports pixel RMS error. Held-out calibration error: ${calibration ? (calibration.validationError * 100).toFixed(1) + "%" : "not measured"}.`}
        />
      </div>
      <details className={`eye-details ${EyeDetailsStyles}`}>
        <summary>
          Gaze vector
          <ChevronDown size={14} />
        </summary>
        <code>
          {frame?.gaze
            ? frame.gaze.direction.map((v) => v.toFixed(4)).join(", ")
            : "No valid gaze"}
        </code>
        <HelpTip
          label="Gaze vector help"
          text="Camera coordinates: right, down, away. Direction is a unit vector; screen position uses your calibration."
        />
      </details>
    </>
  )
}
