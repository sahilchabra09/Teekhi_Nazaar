import { useEffect, useState } from "react"
import { synchronizedHeadPose } from "./head-tracking/head-pose"
import { GazeFrameSynchronizer } from "./head-tracking/head-synchronization"
import { getScreenGaze } from "./screen-gaze"
import type { ScreenGazeReading } from "./screen-gaze.types"
import type { UseCalibratedGazeOptions } from "./use-calibrated-gaze.types"
export function useCalibratedGaze({
  calibration,
  eye,
  head,
  headHistory,
  onDiagnosticReading,
}: UseCalibratedGazeOptions): ScreenGazeReading {
  const [reading, setReading] = useState<ScreenGazeReading>({
    point: null,
    status: "not-calibrated",
    message: "Calibrate your screen first.",
  })
  useEffect(() => {
    const synchronizer = new GazeFrameSynchronizer()
    const timer = setInterval(() => {
      const now = performance.now()
      let frame = eye.current
      let pose = head.current
      if (calibration?.headCompensation && headHistory) {
        const pair = synchronizer.read(frame, headHistory.current, now)
        frame = pair?.eye ?? eye.current
        pose = pair?.head ?? null
      }
      const next = getScreenGaze(calibration, frame, pose, now)
      if (calibration && onDiagnosticReading) {
        onDiagnosticReading({
          mode: "live",
          now,
          eye: frame,
          head: head.current,
          pairedHead: synchronizedHeadPose(pose, frame?.timestamp ?? NaN, now),
          point: next.point,
          status: next.status,
        })
      }
      if (next.status !== "tracking" || !next.point) {
        setReading((current) => {
          if (
            !current.point &&
            !next.point &&
            current.status === next.status &&
            current.message === next.message
          ) {
            return current
          }
          return { ...next, timestamp: frame?.timestamp }
        })
        return
      }
      // Keep measurement output unsmoothed. Only the shared bubble filters its display.
      setReading({ ...next, timestamp: frame?.timestamp })
    }, 40)
    return () => clearInterval(timer)
  }, [calibration, eye, head, headHistory, onDiagnosticReading])
  return reading
}
