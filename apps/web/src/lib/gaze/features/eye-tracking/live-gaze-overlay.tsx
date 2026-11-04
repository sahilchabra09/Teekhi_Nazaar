import { X } from "lucide-react"
import { GazeBubbleOverlay } from "../gaze-bubble/gaze-bubble-overlay"
import { EyeEyebrowStyles } from "../tracking-ui/layout-styles"
import {
  EyeFocusCaptionStyles,
  EyeFocusViewStyles,
} from "../tracking-ui/calibration-styles"
import { EyeHeadFloatingStyles } from "../tracking-ui/head-tracking-styles"
import { EyeIconButtonStyles } from "../tracking-ui/control-styles"
import { HeadPreview } from "./head-tracking/head-preview"
import type { LiveGazeOverlayProps } from "./live-gaze-overlay.types"
/** Uses the same full-viewport origin and normalized coordinates as calibration. */
export function LiveGazeOverlay({
  point,
  onOffsetChange,
  initiallyCorrecting = false,
  timestamp,
  validationErrorPixels,
  verified = false,
  resetKey,
  offset,
  title,
  simulated,
  head,
  onClose,
}: LiveGazeOverlayProps) {
  return (
    <div
      className={`eye-focus-view ${EyeFocusViewStyles}`}
      role="dialog"
      aria-modal="true"
      aria-label="Live gaze view"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onClose()
        }
      }}
    >
      <button
        autoFocus
        className={`eye-icon-button z-[110] ${EyeIconButtonStyles}`}
        onClick={onClose}
        aria-label="Close gaze view"
        title="Close gaze view (Esc)"
      >
        <X />
      </button>
      <div className={`eye-focus-caption ${EyeFocusCaptionStyles}`}>
        <span className={`eye-eyebrow ${EyeEyebrowStyles}`}>
          {simulated ? "SYNTHETIC SAMPLE" : "LIVE GAZE"}
        </span>
        <h2>{title}</h2>
        <p>
          Use the crosshair to correct a steady offset. The ring shows measured
          error when available.
        </p>
      </div>
      {head.enabled && (
        <div className={`eye-head-floating ${EyeHeadFloatingStyles}`}>
          <HeadPreview head={head} compact />
        </div>
      )}
      <GazeBubbleOverlay
        correction={{
          onChange: onOffsetChange,
          initiallyActive: initiallyCorrecting,
        }}
        stabilize={false}
        point={point}
        timestamp={timestamp}
        errorRadiusPx={validationErrorPixels}
        verified={verified}
        resetKey={resetKey}
        offset={offset}
        markerClassName="eye-live-dot"
      />
    </div>
  )
}
