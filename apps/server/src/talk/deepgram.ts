export type DeepgramConfig = { apiKey: string; sttModel: string; ttsModel: string };
export type SpeechText = { text: string; confidence: number; model: string; language: string; durationSeconds?: number };

export async function deepgramTranscribe(config: DeepgramConfig, audio: Uint8Array, signal?: AbortSignal, request = fetch): Promise<SpeechText> {
  const query = new URLSearchParams({ model: config.sttModel, language: "en", smart_format: "true" });
  const response = await request(`https://api.deepgram.com/v1/listen?${query}`, {
    method: "POST", headers: { Authorization: `Token ${config.apiKey}`, "Content-Type": "application/octet-stream" },
    body: new Uint8Array(audio), signal: AbortSignal.any([AbortSignal.timeout(60000), ...(signal ? [signal] : [])]),
  });
  if (!response.ok) throw new Error(`Deepgram transcription failed (HTTP ${response.status})`);
  const data = await response.json() as any;
  const alternative = data.results?.channels?.[0]?.alternatives?.[0];
  if (!alternative || typeof alternative.transcript !== "string") throw new Error("Invalid Deepgram transcript response");
  return { text: alternative.transcript.trim(), confidence: validConfidence(alternative.confidence), model: config.sttModel,
    language: "en", durationSeconds: data.metadata?.duration };
}

export function validConfidence(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0;
}

export async function deepgramSpeak(config: DeepgramConfig, text: string, signal?: AbortSignal, request = fetch): Promise<ArrayBuffer> {
  const query = new URLSearchParams({ model: config.ttsModel, encoding: "linear16", container: "wav", sample_rate: "24000" });
  const response = await request(`https://api.deepgram.com/v1/speak?${query}`, {
    method: "POST", headers: { Authorization: `Token ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text }), signal: AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])]),
  });
  if (!response.ok) throw new Error(`Deepgram voice synthesis failed (HTTP ${response.status})`);
  const audio = await response.arrayBuffer();
  if (audio.byteLength < 44 || audio.byteLength > 12_000_000 || new TextDecoder().decode(audio.slice(0, 4)) !== "RIFF") {
    throw new Error("Invalid Deepgram audio response");
  }
  return audio;
}

/** One upstream stream per active phone. Interim text never reaches reply generation. */
export class DeepgramLive {
  private socket: WebSocket;
  private queued: Uint8Array[] = [];
  private queuedBytes = 0;
  private closed = false;
  private finalizing = false;
  private parts: string[] = [];
  private confidence = 1;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private keepAlive: ReturnType<typeof setInterval>;
  constructor(config: DeepgramConfig, private events: {
    activity: () => void; final: (text: string, confidence: number) => void; error: (message: string) => void;
  }, connect = (url: string, key: string) => new WebSocket(url, { headers: { Authorization: `Token ${key}` } })) {
    const query = new URLSearchParams({ model: config.sttModel, language: "en", encoding: "linear16", sample_rate: "16000",
      channels: "1", interim_results: "true", vad_events: "true", endpointing: "1600", utterance_end_ms: "1600", smart_format: "true" });
    this.socket = connect(`wss://api.deepgram.com/v1/listen?${query}`, config.apiKey);
    this.timer = setTimeout(() => this.fail("Deepgram connection timed out"), 10000);
    this.socket.onopen = () => {
      clearTimeout(this.timer); this.timer = undefined;
      for (const audio of this.queued) this.socket.send(audio);
      this.queued = []; this.queuedBytes = 0;
      if (this.finalizing) this.finalize();
    };
    this.socket.onmessage = ({ data }) => {
      if (this.closed) return;
      try {
        const result = JSON.parse(String(data));
        if (result.type === "Error") return this.fail("Deepgram streaming transcription failed");
        if (result.type === "SpeechStarted") {
          this.events.activity();
          this.timer ??= setTimeout(() => this.finalize(), 15000);
        }
        if (result.type === "Results") {
          const alt = result.channel?.alternatives?.[0];
          if (result.is_final && typeof alt?.transcript === "string" && alt.transcript.trim()) {
            this.parts.push(alt.transcript.trim());
            this.confidence = Math.min(this.confidence, validConfidence(alt.confidence));
          }
          if (result.speech_final && this.parts.length) this.flush();
          else if (result.from_finalize && this.finalizing) this.flush();
        }
        if (result.type === "UtteranceEnd" && this.parts.length) this.flush();
      } catch { this.fail("Invalid Deepgram streaming response"); }
    };
    this.socket.onerror = () => this.fail("Deepgram speech connection failed");
    this.socket.onclose = () => { if (!this.closed) this.fail("Deepgram speech connection closed"); };
    this.keepAlive = setInterval(() => { if (this.socket.readyState === 1) this.socket.send(JSON.stringify({ type: "KeepAlive" })); }, 5000);
  }
  audio(bytes: Uint8Array) {
    if (this.closed) return;
    if (this.socket.readyState === 1) {
      if (this.socket.bufferedAmount > 64000) return this.fail("Speech connection is too slow");
      this.socket.send(bytes);
    } else if (this.queuedBytes + bytes.length <= 64000) { this.queued.push(bytes.slice()); this.queuedBytes += bytes.length; }
    else this.fail("Speech connection is too slow");
  }
  finalize() {
    if (this.closed) return;
    this.finalizing = true;
    // Preserve the connection timeout and flush queued PCM before finalizing.
    if (this.socket.readyState !== 1) return;
    clearTimeout(this.timer);
    if (this.socket.readyState === 1) this.socket.send(JSON.stringify({ type: "Finalize" }));
    this.timer = setTimeout(() => this.flush(), 2000);
  }
  private flush() {
    if (this.closed) return;
    const text = this.parts.join(" ").trim().slice(0, 1000);
    const confidence = this.confidence;
    this.close(); this.events.final(text, confidence);
  }
  private fail(message: string) { if (!this.closed) { this.close(); this.events.error(message); } }
  close() {
    if (this.closed) return;
    this.closed = true; clearTimeout(this.timer); clearInterval(this.keepAlive);
    this.queued = []; this.socket.close();
  }
}
