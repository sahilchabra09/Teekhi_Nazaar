export type EyeTrackingWorkspaceProps = {
  onSample(sample: { x: number; y: number; time: number } | null): void
  controlling: boolean
  onSetupRequired(): void
  onUse(): void
  onClose(): void
}

export type SetupStepName =
  | "Camera"
  | "Eye region"
  | "Eye model"
  | "Head tracker"
  | "Calibrate"
  | "Live gaze"
