import { useEffect, useRef, useState } from "react"
import {
  EyeHeadForwardVectorStyles,
  EyeHeadPreviewImageStyles,
  EyeHeadPreviewStyles,
  EyeHeadUpVectorStyles,
  EyeHeadVectorTipStyles,
  EyeHeadVectorValuesStyles,
} from "../../tracking-ui/head-tracking-styles"
import { EyeStatusDotStyles } from "../../tracking-ui/control-styles"
import { HelpTip } from "../components/help-tip"
import {
  DEFAULT_HEAD_CAMERA_TRANSFORM,
  headFrameGeometry,
} from "./head-camera-transform"
import { headForwardVector, rotateHeadVector } from "./head-geometry"
import type { HeadPreviewProps } from "./head-preview.types"
export function HeadPreview({
  head,
  compact = false,
  inline = false,
}: HeadPreviewProps) {
  const [aspectRatio, setAspectRatio] = useState(4 / 3)
  const transform = head.transform ?? DEFAULT_HEAD_CAMERA_TRANSFORM
  const geometry = headFrameGeometry(aspectRatio, 1, transform)
  const previewMirror = transform.mirrorX ? 1 : -1
  const previewFlip = transform.mirrorY ? -1 : 1
  const video = useRef<HTMLVideoElement | null>(null)
  useEffect(() => {
    const element = video.current
    if (!element) {
      return
    }
    element.srcObject = head.stream
    return () => {
      element.srcObject = null
    }
  }, [head.stream])
  const pose = head.status === "tracking" ? head.pose : null
  const vector = pose ? headForwardVector(pose) : null
  let originX = 80
  let originY = 60
  if (pose?.previewAnchor) {
    originX = (1 - pose.previewAnchor[0]) * 160
    originY = pose.previewAnchor[1] * 120
  }
  let up = null
  if (pose) {
    up = rotateHeadVector([0, 1, 0], pose.rotation)
  }
  let status = "Head tracking"
  if (head.status === "lost") {
    status = "Face not visible"
  }
  if (head.status === "loading") {
    status = "Connecting…"
  }
  if (head.status === "error") {
    status = "Camera unavailable"
  }
  let poseDescription =
    "Keep your face visible. The arrow shows head direction."
  if (pose) {
    const degrees = pose.rotation.map((angle) =>
      ((angle * 180) / Math.PI).toFixed(0)
    )
    poseDescription = `Pitch ${degrees[0]}°, yaw ${degrees[1]}°, roll ${degrees[2]}°. XYZ is the forward unit vector.`
  }
  return (
    <figure
      className={`eye-head-preview ${EyeHeadPreviewStyles} ${compact ? "is-compact" : ""} ${inline ? "is-inline" : ""}`}
      aria-label="Head tracking preview"
    >
      <figcaption>
        <span
          className={`eye-status-dot ${EyeStatusDotStyles} ${vector ? "live" : ""}`}
        />
        {status}
      </figcaption>
      <div
        className={`eye-head-preview-image ${EyeHeadPreviewImageStyles}`}
        style={{ aspectRatio: geometry.width / geometry.height }}
      >
        <video
          ref={video}
          autoPlay
          muted
          playsInline
          aria-label="Front camera preview"
          style={{
            inset: "auto",
            left: "50%",
            top: "50%",
            width: `${(100 * aspectRatio) / geometry.width}%`,
            height: `${100 / geometry.height}%`,
            transform: `translate(-50%, -50%) scale(${previewMirror}, ${previewFlip}) rotate(${transform.rotation}deg)`,
          }}
          onLoadedMetadata={(event) => {
            const element = event.currentTarget
            if (element.videoWidth > 0 && element.videoHeight > 0) {
              setAspectRatio(element.videoWidth / element.videoHeight)
            }
          }}
        />
        {vector && up && (
          <svg
            viewBox="0 0 160 120"
            preserveAspectRatio="none"
            role="img"
            aria-label="Head direction vector"
          >
            <line
              x1={originX}
              y1={originY}
              x2={originX - up[0] * 18}
              y2={originY - up[1] * 18}
              className={`eye-head-up-vector ${EyeHeadUpVectorStyles}`}
            />
            <line
              data-head-vector="forward"
              x1={originX}
              y1={originY}
              x2={originX - vector[0] * 45}
              y2={originY - vector[1] * 45}
              className={`eye-head-forward-vector ${EyeHeadForwardVectorStyles}`}
            />
            <circle cx={originX} cy={originY} r="2" />
            <circle
              cx={originX - vector[0] * 45}
              cy={originY - vector[1] * 45}
              r="3"
              className={`eye-head-vector-tip ${EyeHeadVectorTipStyles}`}
            />
          </svg>
        )}
      </div>
      <div className={`eye-head-vector-values ${EyeHeadVectorValuesStyles}`}>
        <span title="Head forward unit vector">XYZ</span>
        <output>
          {vector ? vector.map((value) => value.toFixed(2)).join(" · ") : "—"}
        </output>
      </div>
      {!compact && <HelpTip label="Head pose details" text={poseDescription} />}
    </figure>
  )
}
