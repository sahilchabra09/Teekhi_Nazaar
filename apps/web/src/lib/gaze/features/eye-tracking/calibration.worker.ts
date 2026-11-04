import { evaluateCalibration } from "./calibration-result"
import type {
  CalibrationFitRequest,
  CalibrationFitResponse,
} from "./calibration.worker.types"
self.onmessage = (event: MessageEvent<CalibrationFitRequest>) => {
  const { samples, orientation, screenAspectRatio } = event.data
  let response: CalibrationFitResponse
  try {
    response = {
      ...evaluateCalibration(samples, orientation, screenAspectRatio),
      error: "",
    }
  } catch {
    response = {
      calibration: null,
      issue: null,
      error: "Calibration could not be fitted. Please retry.",
    }
  }
  self.postMessage(response)
}
