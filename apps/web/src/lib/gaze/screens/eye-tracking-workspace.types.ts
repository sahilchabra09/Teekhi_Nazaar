export type EyeTrackingWorkspaceProps = {
  onSample(sample: { x: number; y: number; time: number } | null): void
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
