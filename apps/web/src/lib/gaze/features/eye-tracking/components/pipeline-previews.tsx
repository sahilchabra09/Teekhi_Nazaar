import { ScanEye } from "lucide-react"
import { useEffect, useRef } from "react"
import {
  EyeThumbnailImageStyles,
  EyeThumbnailStyles,
  EyeThumbnailsStyles,
} from "../../tracking-ui/camera-styles"
import { setCanvasDimensions } from "../canvas-sizing"
import type {
  MaskPreviewProps,
  PipelinePreviewsProps,
} from "./pipeline-previews.types"
function MaskPreview({ mask, width, height }: MaskPreviewProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) {
      return
    }
    setCanvasDimensions(canvas, width, height)
    const context = canvas.getContext("2d")
    if (!context) {
      return
    }
    const image = context.createImageData(width, height)
    for (let index = 0; index < mask.length; index += 1) {
      const pixel = index * 4
      image.data[pixel] = mask[index]!
      image.data[pixel + 1] = mask[index]!
      image.data[pixel + 2] = mask[index]!
      image.data[pixel + 3] = 255
    }
    context.putImageData(image, 0, 0)
  }, [height, mask, width])
  return <canvas ref={ref} />
}
export function PipelinePreviews({ frame }: PipelinePreviewsProps) {
  const previews = frame?.detection.previews.length
    ? frame.detection.previews
    : [
        { label: "Strict", threshold: 0 },
        { label: "Balanced", threshold: 0 },
        { label: "Relaxed", threshold: 0 },
      ]
  return (
    <div className={`eye-thumbnails ${EyeThumbnailsStyles}`}>
      {previews.map((preview, index) => {
        const isSelected = frame?.detection.selected === index
        const fitLabel =
          "score" in preview
            ? `${Math.round(preview.score * 100)}% fit`
            : "Awaiting frame"
        return (
          <div
            key={preview.label}
            className={`eye-thumbnail ${EyeThumbnailStyles} ${isSelected ? "selected" : ""}`}
          >
            <div className={`eye-thumbnail-image ${EyeThumbnailImageStyles}`}>
              {frame && "mask" in preview && preview.mask ? (
                <MaskPreview
                  mask={preview.mask}
                  width={frame.roi.width}
                  height={frame.roi.height}
                />
              ) : (
                <ScanEye size={22} strokeWidth={1} />
              )}
            </div>
            <div>
              <span>{preview.label}</span>
              <span>{fitLabel}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
