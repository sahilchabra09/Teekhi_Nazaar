import type { SessionAlignment } from "./session-alignment.types"
import type { Calibration } from "../eye-tracking/calibration.types"
import type { Point } from "../eye-tracking/eye-tracking.types"
export type CalibrationContext = {
  version: 1
  tracker: "screen"
  featureVersion: string
  cameraIdentity: string
  width: number
  height: number
  inputTransform: string
  outputSpace: "screen"
  screenAspect: number
  setupKey: string
  geometryId: string | null
}
export type CalibrationPayload = { kind: "screen"; model: Calibration }
export type CalibrationProfile = {
  id: string
  name: string
  updatedAt: string
  context: CalibrationContext
  offset: Point
  alignment?: SessionAlignment | null
  payload: CalibrationPayload
}
export type CalibrationProfileLibrary = {
  version: 1
  selectedId: string | null
  profiles: CalibrationProfile[]
}
export type CalibrationCompatibility = { compatible: boolean; reason: string }
export type ProfileReadStorage = Pick<Storage, "getItem">
export type ProfileWriteStorage = Pick<Storage, "getItem" | "setItem">
