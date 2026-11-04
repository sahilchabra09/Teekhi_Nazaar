export type SetupStepNavigationProps = {
  steps: readonly string[]
  activeStep: number
  completedSteps: ReadonlySet<number>
  availableSteps: ReadonlySet<number>
  onSelectStep: (index: number) => void
}
