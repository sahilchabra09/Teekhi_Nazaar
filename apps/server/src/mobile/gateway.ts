import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import type { Server, ServerWebSocket } from "bun";
import { Pairing, type Identity, type SessionResolver } from "./pairing";
import { MobileOAuth, appCallback } from "./oauth";

type Role = "web" | "phone";
interface PeerData { role: Role; identity: Identity; driveCapable?: boolean; driveBinding?: string; check?: ReturnType<typeof setInterval>; checking?: boolean; window: number; messages: number }
type Peer = ServerWebSocket<PeerData>;
type Message = Record<string, unknown> & { type: string };

export function createRobotGateway(options: {
  resolve: SessionResolver;
  origin: string;
  authHandler: (request: Request) => Promise<Response>;
  authBaseUrl: string;
  googleEnabled: boolean;
  robotOwnerId?: string;
  validationIntervalMs?: number;
}) {
  const pairing = new Pairing(options.resolve);
  const oauth = new MobileOAuth(pairing);
  const authBase = new URL(options.authBaseUrl).origin;
  const rooms = new Map<string, Map<Role, Peer>>();
  const deviceId = "esp12e_carbot";
  let lease: { control_session_id: string; signing_key: string; expires_at_ms: number } | undefined;
  const app = new Hono();
  app.use("/*", cors({ origin: options.origin, credentials: true, allowMethods: ["GET", "POST", "OPTIONS"], allowHeaders: ["Content-Type", "Authorization"] }));
  app.use("/api/mobile/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    const origin = c.req.header("origin");
    if (origin && origin !== options.origin) return c.json({ error: "Untrusted origin" }, 403);
    await next();
  });
  app.use("/api/mobile/*", bodyLimit({ maxSize: 4096 }));
  app.on(["POST", "GET"], "/api/auth/*", (c) => options.authHandler(c.req.raw));
  app.get("/", (c) => c.text("IRIS API"));
  app.get("/health", (c) => c.json({ ok: true, media: "authenticated" }));
  const allowAttempt = (request: Request, server?: Server<PeerData>) => pairing.allowAttempt(server?.requestIP(request)?.address ?? "unknown");
  app.post("/api/mobile/oauth/start", async (c) => {
    if (!options.googleEnabled) return c.json({ error: "Google sign-in is not configured on the server" }, 503);
    if (!allowAttempt(c.req.raw, (c.env as { server?: Server<PeerData> }).server)) return c.json({ error: "Too many attempts. Try again in one minute." }, 429);
    const body = await c.req.json().catch(() => null);
    const attempt = oauth.begin(body?.state, body?.code_challenge);
    if (!attempt) return c.json({ error: "Invalid OAuth request" }, 400);
    const url = new URL("/api/mobile/oauth/authorize", authBase);
    url.searchParams.set("request", attempt.request);
    return c.json({ authorization_url: url.toString(), expires_at_ms: attempt.expires_at_ms });
  });
  app.get("/api/mobile/oauth/authorize", async (c) => {
    const request = c.req.query("request") ?? "";
    const pending = oauth.authorize(request);
    if (!pending) return c.text("Sign-in expired. Return to IRIS and tap Continue with Google again.", 400);
    const callback = new URL("/api/mobile/oauth/callback", authBase);
    callback.searchParams.set("request", request);
    callback.searchParams.set("return_key", pending.returnKey);
    try {
      // Let Better Auth create/verify the Google OAuth state, PKCE and session.
      // Forward its state cookie to the external browser before redirecting to Google.
      const response = await options.authHandler(new Request(new URL("/api/auth/sign-in/social", authBase).toString(), {
        method: "POST", headers: { "Content-Type": "application/json", Origin: authBase, Cookie: c.req.header("cookie") ?? "" },
        body: JSON.stringify({ provider: "google", callbackURL: callback.toString(), errorCallbackURL: callback.toString(), disableRedirect: true }),
      }));
      const body = await response.json() as { url?: unknown };
      if (!response.ok || typeof body.url !== "string") throw new Error("Google initialization failed");
      const google = new URL(body.url);
      if (google.protocol !== "https:" || google.hostname !== "accounts.google.com") throw new Error("Invalid Google destination");
      for (const cookie of response.headers.getSetCookie()) c.header("Set-Cookie", cookie, { append: true });
      return c.redirect(google.toString(), 302);
    } catch {
      oauth.takeCallback(request, pending.returnKey);
      return c.redirect(appCallback(pending.state, { error: "sign_in_unavailable" }), 302);
    }
  });
  app.get("/api/mobile/oauth/callback", async (c) => {
    const attempt = oauth.takeCallback(c.req.query("request") ?? "", c.req.query("return_key") ?? "");
    if (!attempt) return c.text("Sign-in expired. Return to IRIS and try again.", 400);
    if (c.req.query("error")) return c.redirect(appCallback(attempt.state, { error: "access_denied" }), 302);
    const identity = await pairing.browser(c.req.raw.headers);
    if (!identity) return c.redirect(appCallback(attempt.state, { error: "sign_in_failed" }), 302);
    return c.redirect(oauth.complete(attempt, identity), 302);
  });
  app.post("/api/mobile/oauth/exchange", async (c) => {
    if (!allowAttempt(c.req.raw, (c.env as { server?: Server<PeerData> }).server)) return c.json({ error: "Too many attempts. Try again in one minute." }, 429);
    const body = await c.req.json().catch(() => null);
    const result = await oauth.exchange(body?.code, body?.code_verifier);
    if (!result) return c.json({ error: "Google sign-in expired. Please sign in again." }, 401);
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
    return identity ? c.json({ user: identity.account.user, expires_at_ms: identity.expires }) : c.json({ error: "Sign in with Google again" }, 401);
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
  app.get("/api/mobile/session", async (c) => {
    const identity = await pairing.phone(c.req.raw.headers);
    if (!identity) return c.json({ error: "Unauthorized" }, 401);
    if (!options.robotOwnerId) return c.json({ error: "Robot driving authorization is not configured" }, 501);
    if (identity.account.user.id !== options.robotOwnerId || c.req.query("device_id") !== deviceId) {
      return c.json({ error: "Robot is not assigned to this account" }, 403);
    }
    const room = rooms.get(options.robotOwnerId);
    const web = room?.get("web"), phone = room?.get("phone");
    if (!web || !phone || phone.data.identity !== identity || !phone.data.driveBinding ||
        phone.data.driveBinding !== c.req.header("X-IRIS-Drive-Binding")) {
      return c.json({ error: "Connect a compatible phone and console" }, 409);
    }
    const binding = phone.data.driveBinding;
    // Recheck socket ownership after the async session lookup. Either peer may have been replaced.
    if (!await pairing.valid(web.data.identity) || !pairing.current(identity) || room?.get("web") !== web || room?.get("phone") !== phone ||
        phone.data.driveBinding !== binding || web.readyState !== 1 || phone.readyState !== 1) {
      return c.json({ error: "Controller disconnected" }, 409);
    }
    const now = Date.now();
    if (!lease || lease.expires_at_ms <= now) {
      lease = { control_session_id: crypto.randomUUID(), signing_key: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex"), expires_at_ms: 0 };
    }
    lease.expires_at_ms = Math.min(now + 10_000, identity.expires, web.data.identity.expires);
    const grant = { ...lease, device_id: deviceId, server_time_ms: now, max_ttl_ms: 300 };
    if (!send(web, { ...grant, type: "drive_grant", ts: now })) {
      web.close(1013, "Drive connection unavailable");
      return c.json({ error: "Console unavailable" }, 409);
    }
    return c.json(grant);
  });
  app.post("/api/utterance", async (c) => {
    if (!await pairing.phone(c.req.raw.headers)) return c.json({ error: "Unauthorized" }, 401);
    // Explicit failure rather than returning simulated transcripts or accepting data
    // that no speech service can process. Android STT remains a usable fallback.
    return c.json({ error: "Speech transcription is not configured. Enable Android STT in phone controls." }, 501);
  });
  const roomFor = (peer: Peer) => rooms.get(peer.data.identity.account.user.id);
  const send = (peer: Peer | undefined, message: Message) => {
    return !!peer && peer.readyState === 1 && peer.getBufferedAmount() < 2_000_000 && peer.send(JSON.stringify(message)) !== 0;
  };
  const revokeDrive = (room: Map<Role, Peer>) => {
    const phone = room.get("phone");
    if (!phone || phone.data.identity.account.user.id !== options.robotOwnerId) return;
    delete phone.data.driveBinding;
    if (!lease) return;
    const revoked = { type: "session_revoked", device_id: deviceId, control_session_id: lease.control_session_id, ts: Date.now() };
    lease = undefined;
    for (const peer of room.values()) {
      if (!send(peer, revoked) && peer.readyState === 1) peer.close(1013, "Drive connection unavailable");
    }
  };
  const bindDrive = (room: Map<Role, Peer>) => {
    const phone = room.get("phone");
    if (!phone?.data.driveCapable || phone.data.driveBinding || !room.has("web") ||
        phone.data.identity.account.user.id !== options.robotOwnerId) return;
    const binding = crypto.randomUUID();
    if (send(phone, { type: "drive_binding", device_id: deviceId, binding, ts: Date.now() })) phone.data.driveBinding = binding;
    else phone.close(1013, "Drive connection unavailable");
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
        if (previous) revokeDrive(room);
        room.set(peer.data.role, peer);
        previous?.close(4001, "Connected on another device");
        presence(room);
        bindDrive(room);
        peer.data.check = setInterval(() => void validate(peer), options.validationIntervalMs ?? 15_000);
      },
      close(peer: Peer) {
        clearInterval(peer.data.check);
        const room = roomFor(peer);
        if (room?.get(peer.data.role) !== peer) return;
        revokeDrive(room);
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
          if (role === "phone" && message.type === "hello" && message.drive_proof === "hmac-sha256-v1") {
            peer.data.driveCapable = true;
            bindDrive(room);
          }
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
