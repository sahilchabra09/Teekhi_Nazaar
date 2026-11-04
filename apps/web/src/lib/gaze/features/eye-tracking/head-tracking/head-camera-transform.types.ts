export type HeadCameraTransform = {
  rotation: number
  mirrorX: boolean
  mirrorY: boolean
}

export type HeadFrameGeometry = {
  width: number
  height: number
  matrix: [number, number, number, number, number, number]
}
