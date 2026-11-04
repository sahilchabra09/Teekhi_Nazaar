import type { HeadPose } from "./head-pose.types"

export type HeadCameraStatus = "off" | "loading" | "tracking" | "lost" | "error"

export type HeadCameraState = {
  status: HeadCameraStatus
  pose: HeadPose | null
  stream: MediaStream | null
  error: string
}

export type HeadCameraCallbacks = {
  onState: (state: HeadCameraState) => void
}
