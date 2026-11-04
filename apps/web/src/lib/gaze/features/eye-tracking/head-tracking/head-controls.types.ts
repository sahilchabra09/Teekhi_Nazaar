import type { HeadTrackingController } from "./use-head-tracking.types"

export type HeadControlsProps = {
  onSkip: () => void
  head: HeadTrackingController
  devices: MediaDeviceInfo[]
  eyeDeviceId: string
  simulated: boolean
  onConfigurationChange: () => void
}
