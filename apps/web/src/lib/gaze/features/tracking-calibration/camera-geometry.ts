import type { FrameDimensions } from "../eye-tracking/eye-tracking.types"
import type { TrackerSource } from "../eye-tracking/use-tracker.types"

/** Transport reconnect counters do not change the camera's coordinate system. */
export function cameraGeometryIdentity(
  source: TrackerSource | null,
  dimensions: FrameDimensions
): string | null {
  if (!source || dimensions.width <= 0 || dimensions.height <= 0) {
    return null
  }
  return JSON.stringify([
    source.kind,
    source.deviceId || source.url || source.name,
    dimensions.width,
    dimensions.height,
  ])
}
