import type { HeadCameraTransform } from "./head-camera-transform.types"

export type HeadOrientationControlsProps = {
  value: HeadCameraTransform
  onChange: (value: HeadCameraTransform) => void
}
