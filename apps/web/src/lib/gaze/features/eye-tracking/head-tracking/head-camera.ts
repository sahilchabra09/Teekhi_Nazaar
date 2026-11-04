import { VideoFrameClock } from "../video-frame-clock"
import {
  DEFAULT_HEAD_CAMERA_TRANSFORM,
  normalizeHeadCameraTransform,
} from "./head-camera-transform"
import type { HeadCameraTransform } from "./head-camera-transform.types"
import type { HeadCameraCallbacks, HeadCameraState } from "./head-camera.types"
import { HEAD_POSE_MAX_AGE_MS } from "./head-pose"
import type { HeadWorkerResponse } from "./head.worker.types"
const FRAME_INTERVAL_MS = 1000 / 30
const PROCESSING_TIMEOUT_MS = 3000
const INITIALIZATION_TIMEOUT_MS = 30000
export class HeadCamera {
  private generation = 0
  private worker: Worker | null = null
  private stream: MediaStream | null = null
  private video: HTMLVideoElement | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private initializationTimer: ReturnType<typeof setTimeout> | null = null
  private inFlight = false
  private inFlightStarted = 0
  private lastVideoTime = -1
  private sequence = 0
  private frameClock = new VideoFrameClock()
  private lastPoseTimestamp: number | null = null
  private callbacks: HeadCameraCallbacks
  private transform = { ...DEFAULT_HEAD_CAMERA_TRANSFORM }
  private transformVersion = 0
  private inFlightTransformVersion = 0
  constructor(callbacks: HeadCameraCallbacks) {
    this.callbacks = callbacks
  }
  private publish(state: HeadCameraState): void {
    this.callbacks.onState(state)
  }
  setTransform(value: HeadCameraTransform): void {
    const next = normalizeHeadCameraTransform(value)
    if (
      next.rotation === this.transform.rotation &&
      next.mirrorX === this.transform.mirrorX &&
      next.mirrorY === this.transform.mirrorY
    ) {
      return
    }
    this.transform = next
    this.transformVersion++
    this.lastPoseTimestamp = null
    this.lastVideoTime = -1
    if (this.stream) {
      let status: HeadCameraState["status"] = "loading"
      if (this.timer) {
        status = "lost"
      }
      this.publish({ status, pose: null, stream: this.stream, error: "" })
    }
  }
  stop(): void {
    this.generation++
    this.frameClock.stop()
    if (this.timer) {
      clearInterval(this.timer)
    }
    if (this.initializationTimer) {
      clearTimeout(this.initializationTimer)
    }
    this.timer = null
    this.initializationTimer = null
    this.worker?.terminate()
    this.worker = null
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
    if (this.video) {
      this.video.pause()
      this.video.srcObject = null
    }
    this.video = null
    this.inFlight = false
    this.lastVideoTime = -1
    this.lastPoseTimestamp = null
    this.publish({ status: "off", pose: null, stream: null, error: "" })
  }
  private fail(message: string): void {
    this.stop()
    this.publish({ status: "error", pose: null, stream: null, error: message })
  }
  async start(deviceId: string): Promise<void> {
    this.stop()
    const generation = this.generation
    this.publish({ status: "loading", pose: null, stream: null, error: "" })
    try {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof OffscreenCanvas === "undefined"
      ) {
        throw new Error(
          "Head tracking needs camera access and OffscreenCanvas support. Use a current browser on localhost or HTTPS."
        )
      }
      let device: MediaTrackConstraints = { facingMode: "user" }
      if (deviceId) {
        device = { deviceId: { exact: deviceId } }
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          ...device,
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30, max: 30 },
        },
      })
      if (generation !== this.generation) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      this.stream = stream
      const video = document.createElement("video")
      video.muted = true
      video.playsInline = true
      video.srcObject = stream
      this.video = video
      this.frameClock.watch(video)
      await video.play()
      if (generation !== this.generation) {
        return
      }
      stream.getVideoTracks().forEach((track) => {
        track.addEventListener("ended", () => {
          if (generation === this.generation) {
            this.fail(
              "The front camera disconnected. Reconnect it before using compensated gaze."
            )
          }
        })
      })
      this.publish({ status: "loading", pose: null, stream, error: "" })
      const worker = new Worker(new URL("./head.worker.ts", import.meta.url), {
        type: "module",
      })
      this.worker = worker
      worker.onerror = () => {
        if (generation === this.generation) {
          this.fail(
            "The face-tracking worker stopped. Reconnect the front camera."
          )
        }
      }
      worker.onmessage = (event: MessageEvent<HeadWorkerResponse>) => {
        if (generation !== this.generation) {
          return
        }
        const message = event.data
        if (message.type === "error") {
          this.fail(message.message)
          return
        }
        if (message.type === "ready") {
          if (this.initializationTimer) {
            clearTimeout(this.initializationTimer)
          }
          this.initializationTimer = null
          this.publish({
            status: "lost",
            pose: null,
            stream: this.stream,
            error: "",
          })
          this.timer = setInterval(() => {
            void this.capture(generation)
          }, FRAME_INTERVAL_MS)
          return
        }
        this.inFlight = false
        if (this.inFlightTransformVersion !== this.transformVersion) {
          return
        }
        let pose = message.pose
        if (pose && performance.now() - pose.timestamp > HEAD_POSE_MAX_AGE_MS) {
          pose = null
        }
        this.lastPoseTimestamp = pose?.timestamp ?? null
        this.publish({
          status: pose ? "tracking" : "lost",
          pose,
          stream: this.stream,
          error: "",
        })
      }
      this.initializationTimer = setTimeout(() => {
        if (generation === this.generation) {
          this.fail(
            "Face tracking took too long to load. Check your connection and retry."
          )
        }
      }, INITIALIZATION_TIMEOUT_MS)
      worker.postMessage({ type: "initialize" })
    } catch (error) {
      if (generation !== this.generation) {
        return
      }
      let message =
        "Could not start the front camera. Check its permission and selection."
      if (error instanceof Error) {
        message = error.message
      }
      this.fail(message)
    }
  }
  private async capture(generation: number): Promise<void> {
    if (generation !== this.generation) {
      return
    }
    const now = performance.now()
    if (
      this.lastPoseTimestamp !== null &&
      now - this.lastPoseTimestamp > HEAD_POSE_MAX_AGE_MS
    ) {
      this.lastPoseTimestamp = null
      this.publish({
        status: "lost",
        pose: null,
        stream: this.stream,
        error: "",
      })
    }
    if (this.inFlight) {
      if (now - this.inFlightStarted > PROCESSING_TIMEOUT_MS) {
        this.fail(
          "Face tracking stopped responding. Reconnect the front camera."
        )
      }
      return
    }
    const video = this.video
    const worker = this.worker
    if (!video || !worker || video.readyState < 2 || !video.videoWidth) {
      return
    }
    if (video.currentTime === this.lastVideoTime) {
      return
    }
    this.lastVideoTime = video.currentTime
    this.inFlight = true
    this.inFlightStarted = now
    this.inFlightTransformVersion = this.transformVersion
    const transform = { ...this.transform }
    const timestamp = this.frameClock.read(now)
    try {
      const image = await createImageBitmap(video, {
        resizeWidth: 320,
        resizeHeight: Math.round((320 * video.videoHeight) / video.videoWidth),
        resizeQuality: "low",
      })
      if (generation !== this.generation) {
        image.close()
        return
      }
      try {
        worker.postMessage(
          {
            type: "frame",
            image,
            timestamp,
            id: ++this.sequence,
            transform,
          },
          [image]
        )
      } catch (error) {
        image.close()
        throw error
      }
    } catch {
      if (generation === this.generation) {
        this.fail("Could not read front-camera frames. Reconnect the camera.")
      }
    }
  }
}
