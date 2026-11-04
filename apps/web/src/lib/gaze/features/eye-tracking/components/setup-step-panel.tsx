import { useId } from "react"
import {
  EyeControlsBodyStyles,
  EyeControlsHeadingStyles,
  EyeControlsStyles,
} from "../../tracking-ui/layout-styles"
import { EyeMessageStyles } from "../../tracking-ui/control-styles"
import type { SetupStepPanelProps } from "./setup-step-panel.types"
export function SetupStepPanel({
  stepName,
  description,
  error,
  message,
  stage,
  children,
}: SetupStepPanelProps) {
  const headingId = useId()
  const statusMessage = error || message
  return (
    <aside
      className={
        stage
          ? `eye-controls ${EyeControlsStyles} has-stage`
          : `eye-controls ${EyeControlsStyles}`
      }
      aria-labelledby={headingId}
    >
      <div className={`eye-controls-heading ${EyeControlsHeadingStyles}`}>
        <h2 id={headingId}>{stepName}</h2>
        <p className="mt-2 text-base leading-relaxed text-pine-soft">{description}</p>
      </div>
      {stage}
      <div className={`eye-controls-body ${EyeControlsBodyStyles}`}>
        {statusMessage && (
          <p
            className={
              error
                ? `eye-message ${EyeMessageStyles} error`
                : `eye-message ${EyeMessageStyles}`
            }
            role={error ? "alert" : "status"}
          >
            {statusMessage}
          </p>
        )}
        {children}
      </div>
    </aside>
  )
}
