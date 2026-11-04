import { isScreenCalibration } from "../eye-tracking/calibration-profile-adapter"
import {
  hasOnlyKeys,
  isFiniteNumber,
  isMatrix,
  isRecord,
  isVector,
} from "./runtime-validation"
import type {
  CalibrationContext,
  CalibrationCompatibility,
  CalibrationProfile,
  CalibrationProfileLibrary,
  ProfileReadStorage,
  ProfileWriteStorage,
} from "./calibration-profiles.types"
const STORAGE_KEY = "iris.calibration-profiles.v1"
const MAX_BYTES = 2_000_000
const MAX_PROFILES = 20
function emptyLibrary(): CalibrationProfileLibrary {
  return { version: 1, selectedId: null, profiles: [] }
}
function isContext(value: unknown): value is CalibrationContext {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "version",
      "tracker",
      "featureVersion",
      "cameraIdentity",
      "width",
      "height",
      "inputTransform",
      "outputSpace",
      "screenAspect",
      "setupKey",
      "geometryId",
    ]) &&
    value.version === 1 &&
    value.tracker === "screen" &&
    typeof value.featureVersion === "string" &&
    /^[a-zA-Z0-9-]{1,80}$/.test(value.featureVersion) &&
    typeof value.cameraIdentity === "string" &&
    /^[a-f0-9]{64}$/.test(value.cameraIdentity) &&
    [value.width, value.height].every(
      (size) =>
        isFiniteNumber(size) &&
        Number.isInteger(size) &&
        size > 0 &&
        size <= 16384
    ) &&
    typeof value.inputTransform === "string" &&
    value.inputTransform.length <= 80 &&
    value.outputSpace === "screen" &&
    isFiniteNumber(value.screenAspect) &&
    value.screenAspect > 0 &&
    typeof value.setupKey === "string" &&
    value.setupKey.length <= 1024 &&
    (value.geometryId === null ||
      (typeof value.geometryId === "string" && value.geometryId.length <= 80))
  )
}
function isProfile(value: unknown): value is CalibrationProfile {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "id",
      "name",
      "updatedAt",
      "context",
      "offset",
      "alignment",
      "payload",
    ])
  ) {
    return false
  }
  if (
    typeof value.id !== "string" ||
    value.id.length < 1 ||
    value.id.length > 80 ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    value.name.length > 60 ||
    typeof value.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(value.updatedAt)) ||
    !isContext(value.context) ||
    !isVector(value.offset, 2) ||
    !value.offset.every((offset) => Math.abs(offset) <= 1)
  ) {
    return false
  }
  if (value.alignment !== undefined && value.alignment !== null) {
    const alignment = value.alignment
    if (
      !isRecord(alignment) ||
      !hasOnlyKeys(alignment, [
        "method",
        "offset",
        "coefficients",
        "targetCount",
        "verified",
      ]) ||
      alignment.verified !== false ||
      !isFiniteNumber(alignment.targetCount) ||
      alignment.targetCount < 1 ||
      alignment.targetCount > 100
    ) {
      return false
    }
    if (alignment.method === "translation") {
      if (
        !isVector(alignment.offset, 2) ||
        alignment.offset.some((value) => Math.abs(value) > 1)
      ) {
        return false
      }
    } else if (
      alignment.method !== "affine" ||
      !isMatrix(alignment.coefficients, 2, 3)
    ) {
      return false
    }
  }
  const payload = value.payload
  if (!isRecord(payload) || !hasOnlyKeys(payload, ["kind", "model"])) {
    return false
  }
  return payload.kind === "screen" && isScreenCalibration(payload.model)
}
export function readCalibrationProfiles(
  storage?: ProfileReadStorage
): CalibrationProfileLibrary {
  try {
    const store = storage ?? window.localStorage
    const raw = store.getItem(STORAGE_KEY)
    if (!raw || raw.length > MAX_BYTES) {
      return emptyLibrary()
    }
    const value: unknown = JSON.parse(raw)
    if (
      !isRecord(value) ||
      value.version !== 1 ||
      !Array.isArray(value.profiles) ||
      value.profiles.length > MAX_PROFILES
    ) {
      return emptyLibrary()
    }
    const profiles = value.profiles.filter(isProfile)
    const ids = new Set<string>()
    if (
      profiles.some((profile) => {
        if (ids.has(profile.id)) {
          return true
        }
        ids.add(profile.id)
        return false
      })
    ) {
      return emptyLibrary()
    }
    let selectedId: string | null = null
    if (typeof value.selectedId === "string" && ids.has(value.selectedId)) {
      selectedId = value.selectedId
    }
    return { version: 1, profiles, selectedId }
  } catch {
    return emptyLibrary()
  }
}
export function saveCalibrationProfile(
  profile: CalibrationProfile,
  storage?: ProfileWriteStorage
): void {
  if (!isProfile(profile)) {
    throw new Error("This calibration profile is invalid or incompatible.")
  }
  const store = storage ?? window.localStorage
  const library = readCalibrationProfiles(store)
  const name = profile.name.trim()
  if (
    library.profiles.some(
      (item) =>
        item.id !== profile.id &&
        item.name.toLocaleLowerCase() === name.toLocaleLowerCase()
    )
  ) {
    throw new Error("That name already exists. Choose another name.")
  }
  const profiles = library.profiles.filter((item) => item.id !== profile.id)
  if (profiles.length >= MAX_PROFILES) {
    throw new Error("Profile storage is full. Replace or delete a profile.")
  }
  profiles.push({ ...profile, name })
  writeLibrary({ version: 1, selectedId: profile.id, profiles }, store)
}
function writeLibrary(
  library: CalibrationProfileLibrary,
  storage: ProfileWriteStorage
): void {
  const raw = JSON.stringify(library)
  if (raw.length > MAX_BYTES) {
    throw new Error("Profile storage is full.")
  }
  try {
    storage.setItem(STORAGE_KEY, raw)
  } catch {
    throw new Error(
      "Could not save profiles. Check browser storage space and permissions."
    )
  }
}
export function selectCalibrationProfile(
  id: string,
  storage?: ProfileWriteStorage
): CalibrationProfileLibrary {
  const store = storage ?? window.localStorage
  const library = readCalibrationProfiles(store)
  if (!library.profiles.some((profile) => profile.id === id)) {
    throw new Error("This profile is no longer available.")
  }
  const selected = { ...library, selectedId: id }
  writeLibrary(selected, store)
  return selected
}
export function deleteCalibrationProfile(id: string): void {
  const library = readCalibrationProfiles()
  const profiles = library.profiles.filter((profile) => profile.id !== id)
  const selectedId = library.selectedId === id ? null : library.selectedId
  writeLibrary({ ...library, profiles, selectedId }, window.localStorage)
}
export function checkCalibrationCompatibility(
  saved: CalibrationContext,
  current: CalibrationContext
): CalibrationCompatibility {
  if (!isContext(saved) || !isContext(current)) {
    return {
      compatible: false,
      reason: "Connect the matching camera and complete eye setup first.",
    }
  }
  for (const key of [
    "tracker",
    "featureVersion",
    "cameraIdentity",
    "width",
    "height",
    "inputTransform",
    "outputSpace",
    "setupKey",
    "geometryId",
  ] as const) {
    if (saved[key] !== current[key]) {
      return {
        compatible: false,
        reason:
          "Camera, orientation or eye setup changed. Use its matching profile or recalibrate.",
      }
    }
  }
  if (Math.abs(saved.screenAspect / current.screenAspect - 1) > 0.01) {
    return {
      compatible: false,
      reason: "Screen geometry changed. Recalibrate for this screen.",
    }
  }
  return {
    compatible: true,
    reason: "Loaded · saved calibration",
  }
}
