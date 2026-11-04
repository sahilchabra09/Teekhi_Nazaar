import type { ReactNode } from "react"

export type SetupStepPanelProps = {
  stepName: string
  description: string
  error?: string | null
  message?: string
  stage?: ReactNode
  children: ReactNode
}
