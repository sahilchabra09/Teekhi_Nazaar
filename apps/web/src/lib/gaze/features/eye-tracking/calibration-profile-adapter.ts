import {
  hasOnlyKeys,
  isFiniteNumber,
  isMatrix,
  isRecord,
  isVector,
} from "../tracking-calibration/runtime-validation"
import type { Calibration } from "./calibration.types"

function isHeadModel(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "method",
      "geometry",
      "mapping",
      "reference",
      "orientation",
      "coefficients",
      "validationError",
      "envelope",
      "maximumValidationError",
      "poseSamples",
    ])
  ) {
    return false
  }
  const reference = value.reference
  const orientation = value.orientation
  const envelope = value.envelope
  if (
    !isRecord(reference) ||
    !hasOnlyKeys(reference, ["id", "timestamp", "position", "rotation"]) ||
    !isFiniteNumber(reference.id) ||
    !isFiniteNumber(reference.timestamp) ||
    !isVector(reference.position, 3) ||
    !isVector(reference.rotation, 3)
  ) {
    return false
  }
  if (
    !isRecord(orientation) ||
    !hasOnlyKeys(orientation, ["horizontal", "vertical"]) ||
    ![1, -1].includes(Number(orientation.horizontal)) ||
    ![1, -1].includes(Number(orientation.vertical))
  ) {
    return false
  }
  if (
    !isRecord(envelope) ||
    !hasOnlyKeys(envelope, ["minimum", "maximum"]) ||
    !isVector(envelope.minimum, 6) ||
    !isVector(envelope.maximum, 6)
  ) {
    return false
  }
  if (
    !isMatrix(value.coefficients, 2, 3) ||
    !isFiniteNumber(value.validationError) ||
    value.validationError < 0 ||
    !isFiniteNumber(value.maximumValidationError) ||
    value.maximumValidationError < 0
  ) {
    return false
  }
  if (
    value.poseSamples !== undefined &&
    (!Array.isArray(value.poseSamples) ||
      value.poseSamples.length > 2048 ||
      !value.poseSamples.every((pose) => isVector(pose, 6)))
  ) {
    return false
  }
  if (value.method === "calibrated-pose-regression") {
    const mapping = value.mapping
    return (
      isRecord(mapping) &&
      hasOnlyKeys(mapping, ["center", "scale", "coefficients"]) &&
      isVector(mapping.center, 8) &&
      isVector(mapping.scale, 8) &&
      mapping.scale.every((scale) => scale > 0) &&
      isMatrix(mapping.coefficients, 2, 9)
    )
  }
  if (value.method !== "calibrated-ray-plane") {
    return false
  }
  const geometry = value.geometry
  return (
    isRecord(geometry) &&
    hasOnlyKeys(geometry, [
      "referenceDepth",
      "featureCenter",
      "featureScale",
      "eyeRay",
      "eyeOrigin",
      "screenCenter",
      "screenRotation",
      "screenWidth",
      "screenAspectRatio",
    ]) &&
    isFiniteNumber(geometry.referenceDepth) &&
    geometry.referenceDepth > 0 &&
    isVector(geometry.featureCenter, 2) &&
    isVector(geometry.featureScale, 2) &&
    geometry.featureScale.every((scale) => scale > 0) &&
    isVector(geometry.eyeRay, 8) &&
    isVector(geometry.eyeOrigin, 3) &&
    isVector(geometry.screenCenter, 3) &&
    isVector(geometry.screenRotation, 3) &&
    isFiniteNumber(geometry.screenWidth) &&
    geometry.screenWidth > 0 &&
    isFiniteNumber(geometry.screenAspectRatio) &&
    geometry.screenAspectRatio > 0
  )
}
export function isScreenCalibration(value: unknown): value is Calibration {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "coefficients",
      "validationError",
      "quadraticMapping",
      "headCompensation",
    ]) ||
    !isMatrix(value.coefficients, 2, 3) ||
    !isFiniteNumber(value.validationError) ||
    value.validationError < 0
  ) {
    return false
  }
  if (value.quadraticMapping !== undefined) {
    const mapping = value.quadraticMapping
    if (
      !isRecord(mapping) ||
      !hasOnlyKeys(mapping, [
        "coefficients",
        "mean",
        "scale",
        "minimum",
        "maximum",
      ]) ||
      !isMatrix(mapping.coefficients, 2, 6) ||
      !isVector(mapping.mean, 2) ||
      !isVector(mapping.scale, 2) ||
      !mapping.scale.every((scale) => scale > 0) ||
      !isVector(mapping.minimum, 2) ||
      !isVector(mapping.maximum, 2)
    ) {
      return false
    }
  }
  return (
    value.headCompensation === undefined || isHeadModel(value.headCompensation)
  )
}
/** Persist model parameters only; face measurements and sample histories stay in memory. */
export function screenProfileModel(calibration: Calibration): Calibration {
  if (!calibration.headCompensation) {
    return calibration
  }
  const { reference, ...head } = calibration.headCompensation
  return {
    ...calibration,
    headCompensation: {
      ...head,
      reference: {
        id: reference.id,
        timestamp: reference.timestamp,
        position: reference.position,
        rotation: reference.rotation,
      },
    },
  }
}
