import { expect, test } from "bun:test";
import { startDevHub } from "./dev-hub";

async function until(check: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!check()) { if (Date.now() > deadline) throw new Error("Timed out waiting for hub event"); await Bun.sleep(5); }
}
async function peer(port: number, role: string) {
  const messages: Record<string, unknown>[] = [];
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?role=${role}`);
  socket.addEventListener("message", ({ data }) => messages.push(JSON.parse(String(data))));
  await new Promise<void>((resolve, reject) => { socket.onopen = () => resolve(); socket.onerror = () => reject(new Error("WebSocket failed")); });
  socket.send(JSON.stringify({ type: "hello", role, version: 1, ts: Date.now() }));
  return { socket, messages };
}
function wav(duration: number) {
  const bytes = new Uint8Array(44 + duration * 32); const header = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => bytes.set(new TextEncoder().encode(value), offset);
  text(0, "RIFF"); header.setUint32(4, bytes.length - 8, true); text(8, "WAVEfmt ");
  header.setUint32(16, 16, true); header.setUint16(20, 1, true); header.setUint16(22, 1, true);
  header.setUint32(24, 16000, true); header.setUint32(28, 32000, true); header.setUint16(32, 2, true); header.setUint16(34, 16, true);
  text(36, "data"); header.setUint32(40, bytes.length - 44, true); return bytes;
}

test("hub routes phone offers and browser answers, and role replacement preserves presence", async () => {
  const server = startDevHub({ port: 0, hostname: "127.0.0.1" });
  try {
    const phone = await peer(server.port!, "phone"); const web = await peer(server.port!, "web");
    web.socket.send(JSON.stringify({ type: "media_ready", device_id: "esp12e_carbot", ts: Date.now() }));
    await until(() => phone.messages.some((message) => message.type === "media_ready"));
    await until(() => phone.messages.some((message) => message.type === "peer_status" && message.web === true));
    phone.socket.send(JSON.stringify({ type: "rtc_offer", sdp: "phone", ts: Date.now() }));
    await until(() => web.messages.some((message) => message.sdp === "phone"));
    web.socket.send(JSON.stringify({ type: "rtc_answer", sdp: "browser", ts: Date.now() }));
    await until(() => phone.messages.some((message) => message.sdp === "browser"));
    const replacement = await peer(server.port!, "phone");
    await until(() => phone.socket.readyState === WebSocket.CLOSED);
    const health = await fetch(`http://127.0.0.1:${server.port}/health`).then((response) => response.json());
    expect(health.phone).toBe(true);
    web.socket.send(JSON.stringify({ type: "speak", text: "Hello", speak_id: "s1", source: "phrase", ts: Date.now() }));
    await until(() => replacement.messages.some((message) => message.type === "speak"));
  } finally { await server.stop(true); }
});

test("WAV upload is accepted asynchronously and emits explicitly simulated replies", async () => {
  const server = startDevHub({ port: 0, hostname: "127.0.0.1" });
  try {
    const web = await peer(server.port!, "web");
    const form = new FormData();
    form.append("utterance_id", "u-test"); form.append("duration_ms", "1000");
    form.append("audio", new File([wav(1000)], "clip.wav", { type: "audio/wav" }));
    const response = await fetch(`http://127.0.0.1:${server.port}/api/utterance`, { method: "POST", body: form });
    expect(response.status).toBe(202); expect(await response.json()).toEqual({ ok: true });
    await until(() => web.messages.some((message) => message.type === "suggestions"));
    expect(web.messages.find((message) => message.type === "transcript")?.text).toContain("[MOCK]");
    const invalid = new FormData(); invalid.append("audio", new File(["bad"], "bad.wav"));
    expect((await fetch(`http://127.0.0.1:${server.port}/api/utterance`, { method: "POST", body: invalid })).status).toBe(400);
    expect((await fetch(`http://127.0.0.1:${server.port}/api/mobile/session?device_id=esp12e_carbot`)).status).toBe(501);
  } finally { await server.stop(true); }
});

test("bench grant requires a token and exact target, and is a short lease", async () => {
  const server = startDevHub({ port: 0, hostname: "127.0.0.1", sessionToken: "test-token" });
  try {
    const url = `http://127.0.0.1:${server.port}/api/mobile/session?device_id=esp12e_carbot`;
    expect((await fetch(url)).status).toBe(401);
    const response = await fetch(url, { headers: { Authorization: "Bearer test-token" } });
    expect(response.status).toBe(200);
    const grant = await response.json();
    expect(grant.device_id).toBe("esp12e_carbot"); expect(grant.max_ttl_ms).toBe(300);
    expect(grant.expires_at_ms - grant.server_time_ms).toBeLessThanOrEqual(10000);
  } finally { await server.stop(true); }
});
