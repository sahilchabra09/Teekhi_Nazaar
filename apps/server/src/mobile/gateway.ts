import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import type { Server, ServerWebSocket } from "bun";
import { Pairing, type Identity, type SessionResolver } from "./pairing";

type Role = "web" | "phone";
interface PeerData { role: Role; identity: Identity; check?: ReturnType<typeof setInterval>; checking?: boolean; window: number; messages: number }
type Peer = ServerWebSocket<PeerData>;
type Message = Record<string, unknown> & { type: string };

export function createRobotGateway(options: {
  resolve: SessionResolver;
  origin: string;
  authHandler: (request: Request) => Promise<Response>;
  validationIntervalMs?: number;
}) {
  const pairing = new Pairing(options.resolve);
  const rooms = new Map<string, Map<Role, Peer>>();
  const app = new Hono();
  app.use("/*", cors({ origin: options.origin, credentials: true, allowMethods: ["GET", "POST", "OPTIONS"], allowHeaders: ["Content-Type", "Authorization"] }));
  app.use("/api/mobile/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    const origin = c.req.header("origin");
    if (origin && origin !== options.origin) return c.json({ error: "Untrusted origin" }, 403);
    await next();
  });
  app.use("/api/mobile/*", bodyLimit({ maxSize: 4096 }));
  app.on(["POST", "GET"], "/api/auth/*", (c) => options.authHandler(c.req.raw));
  app.get("/", (c) => c.text("IRIS API"));
  app.get("/health", (c) => c.json({ ok: true, media: "authenticated" }));
  app.post("/api/mobile/link-code", async (c) => {
    // A browser-only, explicit authorization action protected against cross-site requests.
    if (c.req.header("origin") !== options.origin) return c.json({ error: "Open the IRIS console to link a phone" }, 403);
    const identity = await pairing.browser(c.req.raw.headers);
    return identity ? c.json(pairing.code(identity)) : c.json({ error: "Sign in to link your phone" }, 401);
  });
  app.post("/api/mobile/link", async (c) => {
    // Do not trust X-Forwarded-For supplied by the caller. Reverse proxies should enforce
    // their own rate limit as well; direct Bun deployments use the actual peer address.
    const ip = (c.env as { server?: Server<PeerData> } | undefined)?.server?.requestIP(c.req.raw)?.address ?? "unknown";
    if (!pairing.allowAttempt(ip)) return c.json({ error: "Too many attempts. Wait one minute and try again." }, 429);
    const body = await c.req.json().catch(() => null);
    const result = typeof body?.code === "string" && body.code.length <= 32 ? await pairing.exchange(body.code) : null;
    if (!result) return c.json({ error: "Code is invalid or expired. Generate a new code on your laptop." }, 401);
    // Replacing a link immediately closes obsolete phone sockets.
    for (const room of rooms.values()) for (const peer of room.values()) {
      if (peer.data.role === "phone" && !await pairing.valid(peer.data.identity)) peer.close(1008, "Link replaced");
    }
    return c.json(result);
  });
  app.post("/api/mobile/web-ticket", async (c) => {
    if (c.req.header("origin") !== options.origin) return c.json({ error: "Untrusted origin" }, 403);
    const identity = await pairing.browser(c.req.raw.headers);
    return identity ? c.json({ ticket: pairing.ticket(identity) }) : c.json({ error: "Sign in before connecting your phone" }, 401);
  });
  app.get("/api/mobile/me", async (c) => {
    const identity = await pairing.phone(c.req.raw.headers);
    return identity ? c.json({ user: identity.account.user, expires_at_ms: identity.expires }) : c.json({ error: "Link your phone again from the laptop" }, 401);
  });
  app.post("/api/mobile/logout", async (c) => {
    const identity = await pairing.phone(c.req.raw.headers);
    if (!identity) return c.json({ error: "Already signed out" }, 401);
    pairing.revoke(identity);
    for (const room of rooms.values()) for (const peer of room.values()) {
      if (peer.data.identity === identity) peer.close(1008, "Signed out");
    }
    return c.json({ ok: true });
  });
  // Account pairing authorizes media, not motors. Hardware ownership and MQTT grants
  // must be implemented before the existing guarded driving controller can enable.
  app.get("/api/mobile/session", async (c) => {
    if (!await pairing.phone(c.req.raw.headers)) return c.json({ error: "Unauthorized" }, 401);
    return c.json({ error: "Robot driving authorization is not configured" }, 501);
  });
  app.post("/api/utterance", async (c) => {
    if (!await pairing.phone(c.req.raw.headers)) return c.json({ error: "Unauthorized" }, 401);
    // Explicit failure rather than returning simulated transcripts or accepting data
    // that no speech service can process. Android STT remains a usable fallback.
    return c.json({ error: "Speech transcription is not configured. Enable Android STT in phone controls." }, 501);
  });
  const roomFor = (peer: Peer) => rooms.get(peer.data.identity.account.user.id);
  const send = (peer: Peer | undefined, message: Message) => {
    if (peer && peer.readyState === 1 && peer.getBufferedAmount() < 2_000_000) peer.send(JSON.stringify(message));
  };
  const presence = (room: Map<Role, Peer>) => {
    const message = { type: "peer_status", web: room.has("web"), phone: room.has("phone"), robot: false, ts: Date.now() };
    for (const peer of room.values()) send(peer, message);
  };
  const validate = async (peer: Peer) => {
    if (peer.data.checking) return;
    peer.data.checking = true;
    try { if (!await pairing.valid(peer.data.identity)) peer.close(1008, "Account session expired; sign in again"); }
    catch { peer.close(1011, "Account validation unavailable"); }
    finally { peer.data.checking = false; }
  };
  return {
    maxRequestBodySize: 512_000,
    async fetch(request: Request, server: Server<PeerData>) {
      const url = new URL(request.url);
      if (url.pathname !== "/ws") return app.fetch(request, { server });
      const role = url.searchParams.get("role");
      if (role !== "web" && role !== "phone") return new Response("Invalid role", { status: 400 });
      const origin = request.headers.get("origin");
      if ((role === "web" && origin !== options.origin) || (origin && origin !== options.origin)) return new Response("Untrusted origin", { status: 403 });
      const identity = role === "phone" ? await pairing.phone(request.headers) : await pairing.consumeTicket(url.searchParams.get("ticket"));
      if (!identity) return new Response("Sign in and link your phone", { status: 401 });
      if (server.upgrade(request, { data: { role, identity, window: Date.now(), messages: 0 } })) return;
      return new Response("WebSocket required", { status: 426 });
    },
    websocket: {
      maxPayloadLength: 1_000_000,
      idleTimeout: 60,
      open(peer: Peer) {
        const id = peer.data.identity.account.user.id;
        const room = rooms.get(id) ?? new Map<Role, Peer>();
        rooms.set(id, room);
        const previous = room.get(peer.data.role);
        room.set(peer.data.role, peer);
        previous?.close(4001, "Connected on another device");
        presence(room);
        peer.data.check = setInterval(() => void validate(peer), options.validationIntervalMs ?? 15_000);
      },
      close(peer: Peer) {
        clearInterval(peer.data.check);
        const room = roomFor(peer);
        if (room?.get(peer.data.role) !== peer) return;
        room.delete(peer.data.role); presence(room);
        if (!room.size) rooms.delete(peer.data.identity.account.user.id);
      },
      message(peer: Peer, raw: string | Buffer) {
        const room = roomFor(peer);
        if (room?.get(peer.data.role) !== peer) return;
        if (peer.data.identity.expires <= Date.now()) { peer.close(1008, "Session expired"); return; }
        if (Date.now() - peer.data.window > 1000) { peer.data.window = Date.now(); peer.data.messages = 0; }
        if (++peer.data.messages > 100) { peer.close(1008, "Message rate exceeded"); return; }
        try {
          const message = JSON.parse(String(raw)) as Message;
          if (!message || typeof message.type !== "string" || !Number.isFinite(message.ts)) return;
          const role = peer.data.role;
          // Never route an MQTT drive intention or trust account IDs supplied in a message.
          if (role === "web" && ["media_ready", "rtc_answer", "rtc_ice", "stop"].includes(message.type)) send(room.get("phone"), message);
          if (role === "web" && message.type === "speak" && typeof message.text === "string" && message.text.trim() && message.text.length <= 4000 &&
              typeof message.speak_id === "string" && message.speak_id.length <= 128 && ["phrase", "suggestion", "system"].includes(String(message.source)) && message.audio_url == null) send(room.get("phone"), message);
          if (role === "phone" && ["rtc_offer", "rtc_ice", "frame", "tts_status", "speech_activity", "transcript", "bump", "stop"].includes(message.type)) send(room.get("web"), message);
        } catch { /* Malformed messages cannot interrupt another account's relay. */ }
      },
    },
  };
}
