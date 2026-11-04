import type { TrackingFrame } from "../eye-tracking.types"
import type { HeadPose } from "./head-pose.types"

export type SynchronizedGazeFrame = { eye: TrackingFrame; head: HeadPose }
export type Quaternion = [number, number, number, number]
