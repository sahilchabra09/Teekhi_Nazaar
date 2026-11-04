import type { ProfileControlsController } from "./use-calibration-profiles.types"

export type SharedProfileControlsProps = {
  controller: ProfileControlsController
  sceneLabels?: boolean
}

export type ProfileNameDraft = {
  name: string
  profileId: string | null
}
