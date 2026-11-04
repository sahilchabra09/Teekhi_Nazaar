import type {
  HeadCameraTransform,
  HeadFrameGeometry,
} from "./head-camera-transform.types"
const STORAGE_KEY = "iris.head-camera.transform.v1"
export const DEFAULT_HEAD_CAMERA_TRANSFORM: HeadCameraTransform = {
  rotation: 0,
  mirrorX: false,
  mirrorY: false,
}
export function normalizeHeadCameraTransform(
  value: HeadCameraTransform
): HeadCameraTransform {
  let rotation = 0
  if (Number.isFinite(value.rotation)) {
    rotation = (((Math.round(value.rotation / 90) * 90) % 360) + 360) % 360
  }
  return { rotation, mirrorX: !!value.mirrorX, mirrorY: !!value.mirrorY }
}
export function headFrameGeometry(
  width: number,
  height: number,
  value: HeadCameraTransform
): HeadFrameGeometry {
  const transform = normalizeHeadCameraTransform(value)
  const angle = (transform.rotation * Math.PI) / 180
  const cosine = Math.round(Math.cos(angle))
  const sine = Math.round(Math.sin(angle))
  const outputWidth = Math.abs(width * cosine) + Math.abs(height * sine)
  const outputHeight = Math.abs(height * cosine) + Math.abs(width * sine)
  const horizontal = transform.mirrorX ? -1 : 1
  const vertical = transform.mirrorY ? -1 : 1
  const a = horizontal * cosine
  const b = vertical * sine
  const c = -horizontal * sine
  const d = vertical * cosine
  return {
    width: outputWidth,
    height: outputHeight,
    matrix: [
      a,
      b,
      c,
      d,
      outputWidth / 2 - (a * width + c * height) / 2,
      outputHeight / 2 - (b * width + d * height) / 2,
    ],
  }
}
export function readHeadCameraTransform(): HeadCameraTransform {
  try {
    const serialized = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (!serialized) {
      return { ...DEFAULT_HEAD_CAMERA_TRANSFORM }
    }
    const value: unknown = JSON.parse(serialized)
    if (typeof value !== "object" || value === null) {
      return { ...DEFAULT_HEAD_CAMERA_TRANSFORM }
    }
    if (
      "rotation" in value &&
      typeof value.rotation === "number" &&
      "mirrorX" in value &&
      typeof value.mirrorX === "boolean" &&
      "mirrorY" in value &&
      typeof value.mirrorY === "boolean"
    ) {
      return normalizeHeadCameraTransform({
        rotation: value.rotation,
        mirrorX: value.mirrorX,
        mirrorY: value.mirrorY,
      })
    }
  } catch {
    // Camera orientation remains available when storage is blocked.
  }
  return { ...DEFAULT_HEAD_CAMERA_TRANSFORM }
}
export function saveHeadCameraTransform(value: HeadCameraTransform): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    // Changes still apply to this camera session when storage is unavailable.
  }
}
