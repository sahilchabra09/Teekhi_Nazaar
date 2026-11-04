import type { SessionAlignment } from "./session-alignment.types"
import type { Point } from "../eye-tracking/eye-tracking.types"
import type {
  CalibrationContext,
  CalibrationPayload,
} from "./calibration-profiles.types"
export type ProfileControlsController = {
  profiles: { id: string; name: string }[]
  selectedId: string | null
  error: string
  message: string
  disabled: boolean
  canLoad: boolean
  canSave: boolean
  load: (id: string) => void
  save: (name: string, profileId?: string) => boolean
  clearError?: () => void
  remove: () => void
}
export type UseSavedCalibrationOptions = {
  context: CalibrationContext | null
  payload: CalibrationPayload | null
  alignment?: SessionAlignment | null
  offset: Point
  ready: boolean
  disabled: boolean
  /** Return a reason before selecting a profile the current route cannot use. */
  loadIssue?: (payload: CalibrationPayload) => string | null
  onIncompatible?: () => void
  onLoaded: (
    payload: CalibrationPayload,
    offset: Point,
    alignment: SessionAlignment | null
  ) => void
}
export type ModelContextBinding = { model: object; context: CalibrationContext }
