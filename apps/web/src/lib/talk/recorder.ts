/**
 * Records ONE utterance from a microphone and hands back a 16 kHz mono WAV.
 *
 * - Captures raw PCM through an AudioWorklet (no MediaRecorder), so the output is always WAV,
 *   exactly what the robot phone will upload later (docs/mobile.md M5).
 * - Built-in voice-activity detection: waits for speech, then stops on its own after
 *   `silenceMs` of quiet. Leading/trailing silence is trimmed before encoding.
 */

const TARGET_RATE = 16_000;
const FRAME = 320; // 20 ms at 16 kHz
const PRE_ROLL_MS = 300; // keep a little audio before speech was detected
const TAIL_MS = 350; // and a little after it ended

export type Recording = { wav: Blob; durationMs: number; hadSpeech: boolean };

export type RecorderOptions = {
  deviceId?: string;
  signal?: AbortSignal;
  /** Stop after this much silence once someone has spoken. */
  silenceMs?: number;
  /** Give up if nobody speaks within this time. */
  noSpeechTimeoutMs?: number;
  /** Hard cap on recording length. */
  maxMs?: number;
  /** 0–1 input level, ~15 times a second, for a meter. */
  onLevel?: (level: number) => void;
  onSpeechStart?: () => void;
};

const WORKLET_SOURCE = `
class IrisTap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice());
    return true;
  }
}
registerProcessor("iris-tap", IrisTap);
`;

export class UtteranceRecorder {
  /** Resolves when recording ends: silence after speech, timeout, max length, or `stop()`. */
  readonly done: Promise<Recording>;

  private resolve!: (r: Recording) => void;
  private reject!: (e: unknown) => void;
  private samples: number[] = [];
  private finished = false;
  private cleanupFns: (() => void)[] = [];

  private constructor() {
    this.done = new Promise((res, rej) => {
      this.resolve = res;
      this.reject = rej;
    });
    // Callers that only use stop()/cancel() shouldn't trigger unhandled-rejection noise.
    this.done.catch(() => {});
  }

  static async start(opts: RecorderOptions = {}) {
    const rec = new UtteranceRecorder();
    const abort = () => rec.cancel();
    opts.signal?.throwIfAborted();
    opts.signal?.addEventListener("abort", abort, { once: true });
    rec.cleanupFns.push(() => opts.signal?.removeEventListener("abort", abort));
    try { await rec.begin(opts); }
    catch (error) { rec.teardown(); throw error; }
    return rec;
  }

  /** Stop now and keep what was recorded. */
  stop() {
    this.finish(false);
  }

  /** Stop now and throw the recording away. */
  cancel() {
    if (this.finished) return;
    this.finished = true;
    this.teardown();
    this.reject(new DOMException("Recording cancelled", "AbortError"));
  }

  // ───────────────────────────── internals ─────────────────────────────

  private speechStart = -1; // sample index where speech began
  private lastSpeech = -1; // sample index of the last speech frame

  private async begin(opts: RecorderOptions) {
    const silenceMs = opts.silenceMs ?? 1600;
    const noSpeechTimeoutMs = opts.noSpeechTimeoutMs ?? 8000;
    const maxMs = opts.maxMs ?? 20_000;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(opts.deviceId ? { deviceId: { exact: opts.deviceId } } : {}),
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.cleanupFns.push(() => stream.getTracks().forEach((t) => t.stop()));

    opts.signal?.throwIfAborted();
    const ctx = new AudioContext();
    this.cleanupFns.push(() => void ctx.close());
    await ctx.resume();
    opts.signal?.throwIfAborted();
    const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }));
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }

    opts.signal?.throwIfAborted();
    const source = ctx.createMediaStreamSource(stream);
    const tap = new AudioWorkletNode(ctx, "iris-tap");
    source.connect(tap);
    const silent = ctx.createGain();
    silent.gain.value = 0;
    tap.connect(silent); silent.connect(ctx.destination);
    this.cleanupFns.push(() => {
      tap.port.onmessage = null;
      source.disconnect();
      tap.disconnect();
      silent.disconnect();
    });

    const downsample = makeDownsampler(ctx.sampleRate);
    const startedAt = performance.now();

    // VAD state
    let frame: number[] = [];
    let noiseFloor = 0.001;
    let calibrationFrames = 0;
    let speechRun = 0;
    let silenceRun = 0;
    let smoothedLevel = 0;
    let frameCount = 0;

    tap.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (this.finished) return;
      const fresh = downsample(e.data);

      for (const s of fresh) {
        this.samples.push(s);
        frame.push(s);
        if (frame.length < FRAME) continue;

        const rms = Math.sqrt(frame.reduce((a, v) => a + v * v, 0) / frame.length);
        frame = [];
        frameCount++;

        // Learn the room's noise floor from the first ~200 ms, then track it slowly.
        if (calibrationFrames < 10) {
          // Never teach the detector that immediately spoken words are room noise.
          noiseFloor = Math.min(0.002, (noiseFloor * calibrationFrames + rms) / (calibrationFrames + 1));
          calibrationFrames++;
        }

        const threshold = Math.max(0.006, noiseFloor * 3);
        const isSpeech = rms > threshold;

        if (isSpeech) {
          speechRun++;
          silenceRun = 0;
          this.lastSpeech = this.samples.length;
          if (this.speechStart < 0 && speechRun >= 4) {
            this.speechStart = Math.max(0, this.samples.length - 4 * FRAME);
            opts.onSpeechStart?.();
          }
        } else {
          speechRun = 0;
          silenceRun++;
          noiseFloor = noiseFloor * 0.97 + rms * 0.03;
        }

        smoothedLevel = smoothedLevel * 0.6 + Math.min(1, rms / 0.18) * 0.4;
        if (frameCount % 3 === 0) opts.onLevel?.(smoothedLevel);

        const elapsed = performance.now() - startedAt;
        if (this.speechStart >= 0 && silenceRun * 20 >= silenceMs) return this.finish(false);
        if (this.speechStart < 0 && elapsed >= noSpeechTimeoutMs) return this.finish(false);
        if (elapsed >= maxMs) return this.finish(false);
      }
    };
    const deadline = setTimeout(() => this.finish(false), maxMs);
    const noSpeechDeadline = setTimeout(() => { if (this.speechStart < 0) this.finish(false); }, noSpeechTimeoutMs);
    this.cleanupFns.push(() => { clearTimeout(deadline); clearTimeout(noSpeechDeadline); });
  }

  private finish(_cancelled: boolean) {
    if (this.finished) return;
    this.finished = true;
    this.teardown();

    try {
      const hadSpeech = this.speechStart >= 0;
      const from = hadSpeech ? Math.max(0, this.speechStart - msToSamples(PRE_ROLL_MS)) : 0;
      const to = hadSpeech ? Math.min(this.samples.length, this.lastSpeech + msToSamples(TAIL_MS)) : this.samples.length;
      const clip = Float32Array.from(this.samples.slice(from, to));
      this.resolve({
        wav: encodeWav(clip, TARGET_RATE),
        durationMs: Math.round((clip.length / TARGET_RATE) * 1000),
        hadSpeech,
      });
    } catch (error) {
      this.reject(error);
    }
  }

  private teardown() {
    for (const fn of this.cleanupFns.splice(0)) {
      try {
        fn();
      } catch {
        /* already closed */
      }
    }
  }
}

/** Audio inputs the browser knows about. Labels are only filled in after mic permission was granted once. */
export async function listMicrophones() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "audioinput" && d.deviceId !== "communications");
}

const msToSamples = (ms: number) => Math.round((ms / 1000) * TARGET_RATE);

/** Streaming box-filter downsampler from the device rate (usually 48 kHz) to 16 kHz. */
function makeDownsampler(inputRate: number) {
  const ratio = inputRate / TARGET_RATE;
  let acc = 0;
  let sum = 0;
  let count = 0;
  return (input: Float32Array) => {
    const out: number[] = [];
    for (let i = 0; i < input.length; i++) {
      sum += input[i]!;
      count++;
      acc++;
      if (acc >= ratio) {
        out.push(sum / count);
        acc -= ratio;
        sum = 0;
        count = 0;
      }
    }
    return out;
  };
}

/** 16-bit PCM mono WAV. */
function encodeWav(samples: Float32Array, sampleRate: number) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}
