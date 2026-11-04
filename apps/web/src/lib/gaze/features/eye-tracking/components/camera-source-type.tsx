import { Usb, Wifi } from "lucide-react"
import {
  EyeButtonStyles,
  EyeSourceTypeStyles,
} from "../../tracking-ui/control-styles"
import type { CameraSourceTypeProps } from "./camera-source-type.types"
export function CameraSourceType({
  value,
  onChange,
  label = "Camera type",
}: CameraSourceTypeProps) {
  return (
    <div
      className={`eye-source-type ${EyeSourceTypeStyles}`}
      role="group"
      aria-label={label}
    >
      <button
        className={`eye-button ${EyeButtonStyles} secondary`}
        aria-label="USB camera"
        title="USB camera"
        data-tooltip="USB camera"
        aria-pressed={value === "usb"}
        onClick={() => onChange("usb")}
      >
        <Usb size={19} aria-hidden="true" />
      </button>
      <button
        className={`eye-button ${EyeButtonStyles} secondary`}
        aria-label="MJPEG / video stream URL"
        title="MJPEG / video stream URL"
        data-tooltip="MJPEG / video URL"
        aria-pressed={value === "network"}
        onClick={() => onChange("network")}
      >
        <Wifi size={19} aria-hidden="true" />
      </button>
    </div>
  )
}
