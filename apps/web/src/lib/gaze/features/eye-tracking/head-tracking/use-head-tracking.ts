import { useCallback, useEffect, useRef, useState } from "react"
import { HeadCamera } from "./head-camera"
import {
  normalizeHeadCameraTransform,
  readHeadCameraTransform,
  saveHeadCameraTransform,
} from "./head-camera-transform"
import type { HeadCameraTransform } from "./head-camera-transform.types"
import type { HeadCameraState } from "./head-camera.types"
import type { HeadPose } from "./head-pose.types"
import type { HeadTrackingController } from "./use-head-tracking.types"
const INITIAL_STATE: HeadCameraState = {
  status: "off",
  pose: null,
  stream: null,
  error: "",
}
export function useHeadTracking(
  eyeSourceAvailable = true
): HeadTrackingController {
  const [state, setState] = useState<HeadCameraState>(INITIAL_STATE)
  const [transform, setTransformState] = useState(readHeadCameraTransform)
  const enabled = state.status !== "off"
  const latest = useRef<HeadPose | null>(null)
  const history = useRef<HeadPose[]>([])
  const camera = useRef<HeadCamera | null>(null)
  useEffect(() => {
    const session = new HeadCamera({
      onState: (next) => {
        latest.current = next.pose
        if (!next.pose) {
          history.current = []
        } else if (
          next.pose.timestamp > (history.current.at(-1)?.timestamp ?? -1)
        ) {
          history.current = [...history.current, next.pose].slice(-32)
        }
        setState(next)
      },
    })
    camera.current = session
    return () => {
      session.stop()
      camera.current = null
    }
  }, [])
  useEffect(() => {
    camera.current?.setTransform(transform)
    saveHeadCameraTransform(transform)
  }, [transform])
  const setTransform = useCallback((value: HeadCameraTransform) => {
    const next = normalizeHeadCameraTransform(value)
    // Expire the old pose immediately so gaze cannot use the previous orientation.
    latest.current = null
    history.current = []
    camera.current?.setTransform(next)
    setTransformState(next)
  }, [])
  const start = useCallback(
    async (deviceId: string) => {
      if (!eyeSourceAvailable) {
        return
      }
      await camera.current?.start(deviceId)
    },
    [eyeSourceAvailable]
  )
  const stop = useCallback(() => {
    camera.current?.stop()
  }, [])
  useEffect(() => {
    if (!eyeSourceAvailable) {
      camera.current?.stop()
    }
  }, [eyeSourceAvailable])
  return {
    ...state,
    enabled,
    latest,
    history,
    start,
    stop,
    transform,
    setTransform,
  }
}
