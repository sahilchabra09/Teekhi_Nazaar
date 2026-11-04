import type { MutableRefObject } from "react"
import type { HeadCameraTransform } from "./head-camera-transform.types"
import type { HeadCameraState } from "./head-camera.types"
import type { HeadPose } from "./head-pose.types"

export type HeadTrackingController = HeadCameraState & {
  enabled: boolean
  latest: MutableRefObject<HeadPose | null>
  history: MutableRefObject<HeadPose[]>
  start: (deviceId: string) => Promise<void>
  stop: () => void
  transform: HeadCameraTransform
  setTransform: (value: HeadCameraTransform) => void
}
