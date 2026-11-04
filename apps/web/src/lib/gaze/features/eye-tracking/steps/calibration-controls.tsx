import {
  Crosshair,
  Download,
  FlipHorizontal2,
  FlipVertical2,
  UserRound,
} from "lucide-react"
import {
  EyeActionRowStyles,
  EyeButtonStyles,
  EyeGuidanceRowStyles,
  EyeSmallStyles,
  EyeStatusIndicatorStyles,
} from "../../tracking-ui/control-styles"
import { EyeCameraOrientationStyles } from "../../tracking-ui/head-tracking-styles"
import { EyeActionButton } from "../components/eye-action-button"
import { HelpTip } from "../components/help-tip"
import type { CalibrationControlsProps } from "./calibration-controls.types"
export function CalibrationControls({
  usable,
  locked,
  headReady,
  headEnabled,
  orientation,
  onOrientationChange,
  onStart,
  onExportDiagnostics,
}: CalibrationControlsProps) {
  return (
    <>
      <div className={`eye-guidance-row ${EyeGuidanceRowStyles}`}>
        <span className={`eye-small ${EyeSmallStyles}`}>9 points · 20–30s</span>
        {headEnabled && (
          <span
            className={`eye-status-indicator ${EyeStatusIndicatorStyles}`}
            role="img"
            aria-label="Head camera enabled"
            title="Head camera enabled"
            data-tooltip="Head camera enabled"
          >
            <UserRound size={16} aria-hidden="true" />
          </span>
        )}
      </div>
      <div className={`eye-action-row ${EyeActionRowStyles}`}>
        <button
          className={`eye-button ${EyeButtonStyles} primary`}
          disabled={!usable || !locked || !headReady}
          onClick={onStart}
        >
          Start calibration
          <Crosshair size={17} aria-hidden="true" />
        </button>
        {onExportDiagnostics && (
          <EyeActionButton
            label="Export calibration diagnostics"
            onClick={onExportDiagnostics}
          >
            <Download size={17} aria-hidden="true" />
          </EyeActionButton>
        )}
      </div>
      <div className={`eye-camera-orientation ${EyeCameraOrientationStyles}`}>
        <div className={`eye-guidance-row ${EyeGuidanceRowStyles}`}>
          <span className={`eye-small ${EyeSmallStyles}`}>Orientation</span>
          <HelpTip
            label="Eye camera orientation help"
            text="Mount the eye camera upright. Toggle horizontal or vertical mirroring if eye movement responds in the opposite direction."
          />
        </div>
        <div
          className={`eye-action-row ${EyeActionRowStyles}`}
          role="group"
          aria-label="Eye camera orientation"
        >
          <EyeActionButton
            label="Mirror horizontal eye motion"
            aria-pressed={orientation.horizontal === -1}
            onClick={() =>
              onOrientationChange({
                ...orientation,
                horizontal: orientation.horizontal === -1 ? 1 : -1,
              })
            }
          >
            <FlipHorizontal2 size={17} aria-hidden="true" />
          </EyeActionButton>
          <EyeActionButton
            label="Reverse vertical eye motion"
            aria-pressed={orientation.vertical === -1}
            onClick={() =>
              onOrientationChange({
                ...orientation,
                vertical: orientation.vertical === -1 ? 1 : -1,
              })
            }
          >
            <FlipVertical2 size={17} aria-hidden="true" />
          </EyeActionButton>
        </div>
      </div>
    </>
  )
}
