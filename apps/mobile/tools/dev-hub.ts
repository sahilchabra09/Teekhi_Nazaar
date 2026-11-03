/** Development relay only. No real STT, LLM, ownership service, or robot movement publisher. */
import type { ServerWebSocket } from "bun";

type Role = "phone" | "web" | "robot";
type Peer = ServerWebSocket<{ role: Role }>;
type Message = { type: string; ts: number; [key: string]: unknown };

export function startDevHub(options: { port?: number; hostname?: string; sessionToken?: string } = {}) {
  const peers = new Map<Role, Peer>();
  const sessionId = `bench-${crypto.randomUUID()}`;
  let uploads = 0;
  const send = (role: Role, message: Message) => peers.get(role)?.send(JSON.stringify(message));
  const peerStatus = () => {
    const message = { type: "peer_status", ts: Date.now(), phone: peers.has("phone"), web: peers.has("web"), robot: peers.has("robot") };
    send("phone", message); send("web", message);
  };
  const simulateReplies = (utteranceId: string, text: string) => {
    send("web", { type: "transcript", utterance_id: utteranceId, text: `[MOCK] ${text}`, confidence: 1, ts: Date.now() });
    send("web", { type: "suggestions", utterance_id: utteranceId, heard: `[MOCK] ${text}`,
      suggestions: ["I’m okay, thank you.", "Could you bring me some water?", "Let’s talk for a minute."],
      low_confidence: false, requires_user_confirmation: true, ts: Date.now() });
  };
  const server = Bun.serve<{ role: Role }>({
    hostname: options.hostname ?? "0.0.0.0",
    port: options.port ?? 3000,
    maxRequestBodySize: 1_000_000,
    async fetch(request, server) {
      const url = new URL(request.url);
      if (url.pathname === "/ws") {
        const role = url.searchParams.get("role");
        if (role !== "web" && role !== "phone" && role !== "robot") return new Response("Invalid role", { status: 400 });
        if (server.upgrade(request, { data: { role } })) return;
        return new Response("WebSocket required", { status: 426 });
      }
      if (url.pathname === "/health") return Response.json({ mode: "mock", uploads, phone: peers.has("phone"), web: peers.has("web") });
      // Protocol tests only. This is intentionally not an account credential and is
      // never used by the native app's account-link flow or the main API.
      if (url.pathname === "/api/mobile/web-ticket" && request.method === "POST") return Response.json({ ticket: "mock-protocol-test" });
      if (url.pathname === "/api/mobile/session" && request.method === "GET") {
        if (!options.sessionToken) return Response.json({ error: "Bench session disabled" }, { status: 501 });
        if (request.headers.get("Authorization") !== `Bearer ${options.sessionToken}`) return new Response("Unauthorized", { status: 401 });
        if (url.searchParams.get("device_id") !== "esp12e_carbot") return new Response("Wrong device", { status: 403 });
        return Response.json({ device_id: "esp12e_carbot", control_session_id: sessionId,
          server_time_ms: Date.now(), expires_at_ms: Date.now() + 10_000, max_ttl_ms: 300 });
      }
      if (url.pathname === "/api/utterance" && request.method === "POST") {
        try {
          const body = await request.formData();
          const audio = body.get("audio");
          const id = body.get("utterance_id");
          const duration = Number(body.get("duration_ms"));
          if (!(audio instanceof File) || typeof id !== "string" || !id || id.length > 128 || !Number.isFinite(duration) || duration < 0 || duration > 15000 || audio.size > 480044 || audio.size < 44) {
            return new Response("Invalid utterance", { status: 400 });
          }
          const bytes = new Uint8Array(await audio.arrayBuffer());
          const header = new DataView(bytes.buffer);
          const ascii = (start: number, end: number) => new TextDecoder().decode(bytes.slice(start, end));
          if (ascii(0, 4) !== "RIFF" || ascii(8, 12) !== "WAVE" || ascii(12, 16) !== "fmt " || ascii(36, 40) !== "data" ||
            header.getUint16(20, true) !== 1 || header.getUint16(22, true) !== 1 || header.getUint32(24, true) !== 16000 ||
            header.getUint16(34, true) !== 16 || header.getUint32(40, true) !== bytes.length - 44 ||
            Math.abs((bytes.length - 44) / 32 - duration) > 1) return new Response("Expected 16 kHz mono PCM WAV", { status: 400 });
          uploads++;
          if (duration >= 400) setTimeout(() => simulateReplies(id, "How are you feeling?"), 25);
          return Response.json({ ok: true }, { status: 202 });
        } catch { return new Response("Invalid multipart upload", { status: 400 }); }
      }
      return new Response("IRIS development hub · simulated transcripts and suggestions\n", { status: url.pathname === "/" ? 200 : 404 });
    },
    websocket: {
      maxPayloadLength: 2_000_000,
      idleTimeout: 30,
      open(socket) {
        const previous = peers.get(socket.data.role);
        peers.set(socket.data.role, socket);
        previous?.close(4001, "Role replaced");
        peerStatus();
      },
      close(socket) {
        if (peers.get(socket.data.role) !== socket) return;
        peers.delete(socket.data.role); peerStatus();
      },
      message(socket, raw) {
        if (peers.get(socket.data.role) !== socket) return;
        try {
          const message: Message = JSON.parse(raw.toString());
          if (typeof message.type !== "string" || !Number.isFinite(message.ts)) return;
          const role = socket.data.role;
          if (message.type === "hello") return;
          if (role === "phone" && ["rtc_offer", "rtc_ice", "frame", "tts_status", "speech_activity", "bump"].includes(message.type)) send("web", message);
          if (role === "phone" && message.type === "transcript" && typeof message.text === "string" && typeof message.utterance_id === "string") simulateReplies(message.utterance_id, message.text);
          if (role === "web" && ["media_ready", "rtc_answer", "rtc_ice"].includes(message.type)) send("phone", message);
          if (role === "web" && message.type === "speak" && typeof message.text === "string" && typeof message.speak_id === "string" && typeof message.source === "string") send("phone", message);
          if (message.type === "stop") { send("phone", message); send("robot", message); }
        } catch { /* Unknown messages do not crash the relay. */ }
      },
    },
  });
  return server;
}

if (import.meta.main) {
  const server = startDevHub({ port: Number(process.env.PORT ?? 3000), sessionToken: process.env.ENABLE_BENCH_SESSION === "1" ? process.env.MOCK_SESSION_TOKEN : undefined });
  console.log(`IRIS MOCK hub at http://localhost:${server.port}. Transcripts and suggestions are simulated.`);
  console.log("Bench driving grant is disabled unless ENABLE_BENCH_SESSION=1 and MOCK_SESSION_TOKEN are set. This hub never publishes drive intentions.");
}
