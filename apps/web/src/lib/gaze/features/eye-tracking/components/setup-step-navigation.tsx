import { Check, ChevronRight } from "lucide-react"
import {
  EyeBreadcrumbsStyles,
  EyeStepChevronStyles,
  EyeStepNavStyles,
  EyeStepNumberStyles,
  EyeStepStyles,
  EyeStepTextStyles,
} from "../../tracking-ui/layout-styles"
import type { SetupStepNavigationProps } from "./setup-step-navigation.types"
export function SetupStepNavigation({
  steps,
  activeStep,
  completedSteps,
  availableSteps,
  onSelectStep,
}: SetupStepNavigationProps) {
  return (
    <nav
      className={`eye-step-nav ${EyeStepNavStyles}`}
      aria-label="Setup steps"
    >
      <ol className={`eye-breadcrumbs ${EyeBreadcrumbsStyles}`}>
        {steps.map((name, index) => {
          const isActive = index === activeStep
          const isComplete = completedSteps.has(index)
          const classNames = ["eye-step", EyeStepStyles]
          if (isActive) {
            classNames.push("active")
          }
          if (isComplete) {
            classNames.push("done")
          }
          return (
            <li key={name}>
              <button
                className={classNames.join(" ")}
                aria-current={isActive ? "step" : undefined}
                disabled={!availableSteps.has(index)}
                onClick={() => onSelectStep(index)}
              >
                <span className={`eye-step-number ${EyeStepNumberStyles}`}>
                  {isComplete ? (
                    <Check size={13} />
                  ) : (
                    String(index + 1).padStart(2, "0")
                  )}
                </span>
                <span className={`eye-step-text ${EyeStepTextStyles}`}>
                  {name}
                </span>
              </button>
              {index < steps.length - 1 && (
                <ChevronRight
                  className={`eye-step-chevron ${EyeStepChevronStyles}`}
                  size={14}
                  aria-hidden="true"
                />
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
