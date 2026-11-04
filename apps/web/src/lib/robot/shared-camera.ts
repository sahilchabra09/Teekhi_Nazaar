import { inputError, readInput, requestInput, saveInput } from "../media-inputs";

export type CameraState = { deviceId: string; stream?: MediaStream; busy: boolean; error: string | null };
export const idleCamera: CameraState = { deviceId: "", busy: false, error: null };

function release(stream?: MediaStream) {
  stream?.getTracks().forEach((track) => track.stop());
}

/** Owns only the local video stream shared with the paired phone. */
export class SharedCamera {
  private state = idleCamera;
  private generation = 0;
  private pending?: MediaStream;
  private handoff = Promise.resolve();

  constructor(
    private changed: (state: CameraState) => void,
    private send: (stream?: MediaStream) => Promise<void>,
    private capture = requestInput,
  ) {}

  private update(next: Partial<CameraState>) {
    this.state = { ...this.state, ...next };
    this.changed(this.state);
  }

  restore() { this.update({ deviceId: readInput("camera") }); }

  select = async (deviceId: string) => {
    if (this.state.stream || this.state.busy) return this.acquire(deviceId);
    saveInput("camera", deviceId);
    this.update({ deviceId, error: null });
  };

  open = async () => {
    if (!this.state.stream && !this.state.busy) await this.acquire(this.state.deviceId);
  };

  stop = () => {
    this.generation++;
    release(this.pending);
    this.pending = undefined;
    release(this.state.stream);
    this.update({ stream: undefined, busy: false, error: null });
    // No capture remains even if the peer has already gone away.
    void this.send(undefined).catch(() => {});
  };

  private async acquire(deviceId: string) {
    const generation = ++this.generation;
    release(this.pending);
    this.pending = undefined;
    this.update({ busy: true, error: null });
    let candidate: MediaStream | undefined;
    try {
      const stream = await this.capture({
        audio: false,
        video: { width: 1280, height: 720, ...(deviceId && { deviceId: { exact: deviceId } }) },
      });
      candidate = stream;
      if (generation !== this.generation) return;
      this.pending = stream;
      // Capture can finish out of order. Serialize only the sender handoff.
      const swap = this.handoff.then(async () => {
        if (generation !== this.generation) return;
        const track = stream.getVideoTracks()[0];
        if (!track || track.readyState !== "live") throw new Error("The camera stopped. Reconnect it and try again.");
        try {
          await this.send(stream);
        } catch {
          throw new Error("The phone connection could not switch cameras. Choose another camera or reconnect the phone.");
        }
        if (generation !== this.generation || track.readyState !== "live") {
          await this.send(this.state.stream);
          if (generation === this.generation) throw new Error("The camera stopped. Reconnect it and try again.");
          return;
        }
        release(this.state.stream);
        track.addEventListener("ended", () => {
          if (this.state.stream !== stream) return;
          release(stream);
          this.update({ stream: undefined, error: "Your camera disconnected. Reconnect it or select another camera, then share again." });
          // A replacement already in flight may have reached the sender.
          this.handoff = this.handoff.then(() => {
            if (!this.state.stream) return this.send(undefined);
          }).catch(() => {});
        }, { once: true });
        saveInput("camera", deviceId);
        this.update({ deviceId, stream, error: null });
        candidate = undefined;
      });
      this.handoff = swap.catch(() => {});
      await swap;
    } catch (cause) {
      if (generation === this.generation) this.update({ error: inputError("camera", cause) });
    } finally {
      release(candidate);
      if (generation === this.generation) {
        this.pending = undefined;
        this.update({ busy: false });
      }
    }
  }
}
