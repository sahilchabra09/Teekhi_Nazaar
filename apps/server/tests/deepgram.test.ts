import { expect, test } from "bun:test";
import { DeepgramLive, deepgramSpeak, deepgramTranscribe } from "../src/talk/deepgram";

const config = { apiKey: "test-only", sttModel: "nova-3", ttsModel: "aura-2-thalia-en" };
function stream() {
  const sent: unknown[] = [], finals: unknown[] = [], errors: string[] = [];
  let activity = 0;
  const socket = { readyState: 0, bufferedAmount: 0, send: (data: unknown) => sent.push(data), close() {},
    onopen: null as any, onmessage: null as any, onerror: null as any, onclose: null as any };
  const live = new DeepgramLive(config, { activity: () => activity++, final: (text, confidence) => finals.push({ text, confidence }), error: e => errors.push(e) },
    (url, key) => { expect(key).toBe(config.apiKey); expect(new URL(url).searchParams.get("vad_events")).toBe("true"); return socket as unknown as WebSocket; });
  return { live, socket, sent, finals, errors, activity: () => activity,
    open: () => { socket.readyState = 1; socket.onopen(); },
    message: (value: unknown) => socket.onmessage({ data: JSON.stringify(value) }) };
}
test("live VAD ignores interim text and silence, assembles final segments once", () => {
  const s = stream();
  try {
    s.open();
    s.message({ type: "Results", speech_final: true });
    expect(s.finals).toHaveLength(0);
    s.message({ type: "SpeechStarted" });
    expect(s.activity()).toBe(1);
    s.message({ type: "Results", channel: { alternatives: [{ transcript: "wrong interim" }] } });
    s.message({ type: "Results", is_final: true, channel: { alternatives: [{ transcript: "Hello", confidence: .9 }] } });
    s.message({ type: "Results", is_final: true, speech_final: true, channel: { alternatives: [{ transcript: "there", confidence: .8 }] } });
    s.message({ type: "UtteranceEnd" });
    expect(s.finals).toEqual([{ text: "Hello there", confidence: .8 }]);
  } finally { s.live.close(); }
});
test("stop during connection sends queued audio before Finalize", () => {
  const s = stream();
  try {
    s.live.audio(new Uint8Array([1, 2])); s.live.finalize(); s.open();
    expect(s.sent[0]).toEqual(new Uint8Array([1, 2]));
    expect(s.sent[1]).toBe(JSON.stringify({ type: "Finalize" }));
    s.message({ type: "Results", from_finalize: true });
    expect(s.finals).toEqual([{ text: "", confidence: 1 }]);
  } finally { s.live.close(); }
});
test("closed stream ignores late results and audio", () => {
  const s = stream(); s.open(); s.live.close();
  s.message({ type: "SpeechStarted" }); s.live.audio(new Uint8Array(2)); s.live.finalize();
  expect(s.sent).toHaveLength(0); expect(s.activity()).toBe(0);
});
test("provider failures do not expose credentials", async () => {
  const request = (async () => new Response("private provider details", { status: 401 })) as unknown as typeof fetch;
  await expect(deepgramSpeak(config, "hello", undefined, request)).rejects.toThrow("HTTP 401");
  await expect(deepgramTranscribe(config, new Uint8Array(2), undefined, request)).rejects.toThrow("HTTP 401");
});
test("malformed synthesized audio is rejected", async () => {
  const request = (async () => new Response(new Uint8Array(100))) as unknown as typeof fetch;
  await expect(deepgramSpeak(config, "hello", undefined, request)).rejects.toThrow("Invalid Deepgram audio");
});
