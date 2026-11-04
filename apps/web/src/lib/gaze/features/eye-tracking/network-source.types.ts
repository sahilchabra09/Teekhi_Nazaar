export type NetworkSource = {
  name: string
  streamUrl: string
} & (
  | {
      kind: "mjpeg"
      firstFrame: Uint8Array
      frames: AsyncGenerator<Uint8Array>
    }
  | {
      kind: "video"
      video: HTMLVideoElement
    }
)
