import { useSyncExternalStore } from "react"
import type { ScreenGeometry } from "./use-screen-geometry.types"
function subscribe(onChanged: () => void): () => void {
  window.addEventListener("resize", onChanged)
  return () => window.removeEventListener("resize", onChanged)
}
function viewportSnapshot(): string {
  return `${window.innerWidth}:${window.innerHeight}`
}
export function useScreenGeometry(): ScreenGeometry {
  const snapshot = useSyncExternalStore(
    subscribe,
    viewportSnapshot,
    () => "0:0"
  )
  const [width, height] = snapshot.split(":").map(Number)
  let aspectRatio = 0
  if (width > 0 && height > 0) {
    aspectRatio = width / height
  }
  return { width, height, aspectRatio }
}
