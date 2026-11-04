import type { ReactNode } from "react"

export type CalibrationFeedbackProps = {
  target: readonly [number, number]
  label: string
  instruction?: string
  action?: ReactNode
}
