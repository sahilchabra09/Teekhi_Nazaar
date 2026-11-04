import type { CalibrationFitResult } from "./calibration-result.types"
import type {
  CalibrationFitRequest,
  CalibrationFitResponse,
} from "./calibration.worker.types"
/** Fitting and whole-fixation cross-validation must not block either camera or the UI. */
export function fitCalibrationInWorker(
  request: CalibrationFitRequest,
  signal: AbortSignal
): Promise<CalibrationFitResult> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Calibration cancelled", "AbortError"))
      return
    }
    const worker = new Worker(
      new URL("./calibration.worker.ts", import.meta.url),
      { type: "module" }
    )
    let settled = false
    const timer = setTimeout(
      () => finish(null, new Error("Calibration took too long. Please retry.")),
      30000
    )
    function cancel(): void {
      finish(null, new DOMException("Calibration cancelled", "AbortError"))
    }
    function finish(result: CalibrationFitResult | null, error?: Error): void {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      signal.removeEventListener("abort", cancel)
      worker.terminate()
      if (error) {
        reject(error)
      } else {
        resolve(result ?? { calibration: null, issue: null })
      }
    }
    signal.addEventListener("abort", cancel, { once: true })
    worker.onerror = () =>
      finish(null, new Error("The calibration worker stopped. Please retry."))
    worker.onmessage = (event: MessageEvent<CalibrationFitResponse>) => {
      const { calibration, issue, error } = event.data
      if (error) {
        finish(null, new Error(error))
      } else {
        finish({ calibration, issue })
      }
    }
    try {
      worker.postMessage(request)
    } catch {
      finish(null, new Error("Could not start calibration. Please retry."))
    }
  })
}
