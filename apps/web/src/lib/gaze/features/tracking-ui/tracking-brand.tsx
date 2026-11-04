import { Eye } from "lucide-react"
import {
  EyeBrandStyles,
  EyeLogoStyles,
  EyeVersionStyles,
} from "./layout-styles"
import type { TrackingBrandProps } from "./tracking-brand.types"
export function TrackingBrand({ version }: TrackingBrandProps) {
  return (
    <span className={`eye-brand ${EyeBrandStyles}`}>
      <span className={`eye-logo ${EyeLogoStyles}`}>
        <Eye size={21} />
      </span>
      IRIS
      <span className={`eye-version ${EyeVersionStyles}`}>{version}</span>
    </span>
  )
}
