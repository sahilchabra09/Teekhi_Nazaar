import type { HeadCameraTransform } from "./head-camera-transform.types"
import type { HeadPose } from "./head-pose.types"

export type HeadWorkerRequest =
  | { type: "initialize" }
  | {
      type: "frame"
      image: ImageBitmap
      timestamp: number
      id: number
      transform: HeadCameraTransform
    }

export type HeadWorkerResponse =
  | { type: "ready" }
  | { type: "pose"; pose: HeadPose | null }
  | { type: "error"; message: string }
