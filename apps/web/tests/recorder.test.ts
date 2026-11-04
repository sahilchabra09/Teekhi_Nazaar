import { afterAll, expect, test } from "bun:test";
import { UtteranceRecorder } from "../src/lib/talk/recorder";

const originals = ["navigator", "AudioContext", "AudioWorkletNode"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
afterAll(() => { for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
let tap: { port: { onmessage: ((event: {data:Float32Array}) => void) | null } };
let stopped = 0;
let constraints: unknown;
const node = () => ({ connect() {}, disconnect() {} });
Object.defineProperty(globalThis, "navigator", { configurable:true, value:{mediaDevices:{getUserMedia:async (value:unknown) => {
  constraints = value; return {getTracks:() => [{stop() { stopped++; }}]};
}}} });
Object.defineProperty(globalThis, "AudioContext", {configurable:true, value:class {
  sampleRate = 48000; destination = {}; audioWorklet = {addModule:async () => {}};
  async resume() {} async close() {}
  createMediaStreamSource() { return node(); }
  createGain() { return {...node(), gain:{value:1}}; }
}});
Object.defineProperty(globalThis, "AudioWorkletNode", {configurable:true, value:class {
  port = {onmessage:null}; constructor() { tap = this; }
  connect() {} disconnect() {}
}});
function frames(n:number, amplitude:number) {
  for (let j=0;j<n;j++) tap.port.onmessage?.({data:Float32Array.from({length:960}, (_,i) => amplitude * Math.sin(2*Math.PI*250*i/48000))});
}
test("laptop fallback uses the selected mic and produces correctly labelled mono PCM", async () => {
  const rec = await UtteranceRecorder.start({deviceId:"laptop"});
  expect(constraints).toMatchObject({audio:{deviceId:{exact:"laptop"}}});
  frames(15,0); frames(50,.1); frames(80,0);
  const result = await rec.done;
  expect(result.hadSpeech).toBe(true);
  const wav = new DataView(await result.wav.arrayBuffer());
  expect(wav.getUint32(24,true)).toBe(16000);
  expect(wav.getUint16(22,true)).toBe(1);
});
test("speech starting immediately is not calibrated away as background noise", async () => {
  const rec = await UtteranceRecorder.start(); frames(80,.1); rec.stop();
  expect((await rec.done).hadSpeech).toBe(true);
});
test("quiet speech remains detectable", async () => {
  const rec = await UtteranceRecorder.start(); frames(15,0); frames(80,.01); rec.stop();
  expect((await rec.done).hadSpeech).toBe(true);
});
test("a 1.2 second pause does not cut off the rest of a sentence", async () => {
  const rec = await UtteranceRecorder.start(); frames(15,0); frames(30,.1); frames(60,0);
  expect(tap.port.onmessage).not.toBe(null);
  frames(30,.1); frames(80,0);
  expect((await rec.done).durationMs).toBeGreaterThan(2000);
});
test("cancel stops capture and ignores late audio", async () => {
  const rec = await UtteranceRecorder.start(); const before = stopped; rec.cancel();
  expect(stopped).toBe(before+1); expect(tap.port.onmessage).toBe(null);
  await expect(rec.done).rejects.toMatchObject({name:"AbortError"});
});
test("no-audio timeout releases capture even when the worklet supplies no frames", async () => {
  const rec = await UtteranceRecorder.start({noSpeechTimeoutMs:10,maxMs:100});
  expect((await rec.done).hadSpeech).toBe(false);
  expect(tap.port.onmessage).toBe(null);
});

test("canceling before a microphone grant releases the newly acquired track without recording", async () => {
  const controller = new AbortController();
  const before = stopped;
  const starting = UtteranceRecorder.start({ signal: controller.signal });
  controller.abort();
  await expect(starting).rejects.toMatchObject({ name: "AbortError" });
  expect(stopped).toBe(before + 1);
});
