import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision"
import { headFrameGeometry } from "./head-camera-transform"
import { readHeadPose } from "./head-pose"
import type { HeadWorkerRequest, HeadWorkerResponse } from "./head.worker.types"
const WASM_ROOT = new URL("/vision-runtime/wasm", self.location.origin).href
const FACE_MODEL = new URL(
  "/models/remote-eye-tracking/face_landmarker.task",
  self.location.origin
).href
let landmarker: FaceLandmarker | null = null
let orientedFrame: OffscreenCanvas | null = null
let lastInferenceTimestamp = -1
function respond(message: HeadWorkerResponse): void {
  self.postMessage(message)
}
async function initialize(): Promise<void> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_ROOT)
  // MediaPipe's classic WASM loader needs its factory on self. A module worker cannot
  // use importScripts, so adapt the pinned loader into a temporary module instead.
  const response = await fetch(fileset.wasmLoaderPath)
  if (!response.ok) {
    throw new Error("Could not download the face-tracking runtime.")
  }
  const loader = await response.text()
  const moduleUrl = URL.createObjectURL(
    // The classic loader's fallback debug function uses block-function hoisting.
    // Give it a lexical debug callback so the same loader works in a strict module.
    new Blob(
      [
        "const dbg = (...message) => console.debug(...message);\n",
        loader,
        "\nself.ModuleFactory = ModuleFactory;",
      ],
      {
        type: "text/javascript",
      }
    )
  )
  try {
    await import(/* webpackIgnore: true */ moduleUrl)
  } finally {
    URL.revokeObjectURL(moduleUrl)
  }
  landmarker = await FaceLandmarker.createFromOptions(
    { ...fileset, wasmLoaderPath: "" },
    {
      baseOptions: { modelAssetPath: FACE_MODEL, delegate: "CPU" },
      canvas: new OffscreenCanvas(320, 240),
      runningMode: "VIDEO",
      // Enable MediaPipe's temporal smoothing for the current tracked face.
      numFaces: 1,
      minFaceDetectionConfidence: 0.65,
      minFacePresenceConfidence: 0.65,
      minTrackingConfidence: 0.65,
      outputFacialTransformationMatrixes: true,
      outputFaceBlendshapes: false,
    }
  )
  lastInferenceTimestamp = -1
  respond({ type: "ready" })
}
self.onmessage = async (event: MessageEvent<HeadWorkerRequest>) => {
  const message = event.data
  try {
    if (message.type === "initialize") {
      await initialize()
      return
    }
    if (!landmarker) {
      return
    }
    if (!Number.isFinite(message.timestamp) || message.timestamp < 0) {
      respond({ type: "pose", pose: null })
      return
    }
    const geometry = headFrameGeometry(
      message.image.width,
      message.image.height,
      message.transform
    )
    if (!orientedFrame) {
      orientedFrame = new OffscreenCanvas(geometry.width, geometry.height)
    }
    if (orientedFrame.width !== geometry.width) {
      orientedFrame.width = geometry.width
    }
    if (orientedFrame.height !== geometry.height) {
      orientedFrame.height = geometry.height
    }
    const context = orientedFrame.getContext("2d")
    if (!context) {
      throw new Error("Could not orient the front-camera frame.")
    }
    context.setTransform(...geometry.matrix)
    context.drawImage(message.image, 0, 0)
    // Capture metadata can repeat or arrive behind a fallback timestamp. MediaPipe
    // requires strictly increasing packet times; keep its clock separate from the
    // original capture time used below for eye/head synchronization.
    const inferenceTimestamp = Math.max(
      Math.floor(message.timestamp),
      lastInferenceTimestamp + 1
    )
    lastInferenceTimestamp = inferenceTimestamp
    const result = landmarker.detectForVideo(orientedFrame, inferenceTimestamp)
    let pose = null
    if (
      result.faceLandmarks.length === 1 &&
      result.facialTransformationMatrixes.length === 1
    ) {
      pose = readHeadPose(
        result.facialTransformationMatrixes[0].data,
        message.id,
        message.timestamp
      )
    }
    if (pose) {
      const nose = result.faceLandmarks[0][1]
      if (nose && Number.isFinite(nose.x) && Number.isFinite(nose.y)) {
        pose.previewAnchor = [nose.x, nose.y]
      }
    }
    respond({ type: "pose", pose })
  } catch (error) {
    let detail = "Face tracking stopped. Reconnect the front camera."
    if (error instanceof Error) {
      detail = error.message
    }
    respond({ type: "error", message: detail })
  } finally {
    if (message.type === "frame") {
      message.image.close()
    }
  }
}
