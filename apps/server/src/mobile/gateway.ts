import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import type { Server, ServerWebSocket } from "bun";
import { Pairing, type Identity, type SessionResolver } from "./pairing";
import { MobileOAuth, appCallback } from "./oauth";

import { createPhoneSpeech, type SpeechOptions, type SpeechTurn } from "./phone-speech";
import { deepgramSpeak } from "../talk/deepgram";

export type Role = "web" | "phone";
interface PeerData { speech?: SpeechTurn; role: Role; identity: Identity; driveCapable?: boolean; driveBinding?: string; check?: ReturnType<typeof setInterval>; checking?: boolean; window: number; messages: number }
export type Peer = ServerWebSocket<PeerData>;
export type Message = Record<string, unknown> & { type: string };

export function createRobotGateway(options: SpeechOptions & {
  resolve: SessionResolver;
  origin: string;
  authHandler: (request: Request) => Promise<Response>;
  googleEnabled: boolean;
  robotOwnerId?: string;
  validationIntervalMs?: number;
}) {
  const pairing = new Pairing(options.resolve);
  const oauth = new MobileOAuth(pairing);
  const authBase = new URL(options.authBaseUrl).origin;
  const ttsBusy = new Set<string>();
  const rooms = new Map<string, Map<Role, Peer>>();
  const deviceId = "esp12e_carbot";
  const sharedDrive = options.robotOwnerId === "*";
  const driveEligible = (id: string) => sharedDrive || id === options.robotOwnerId;
  let lease: { phone: Peer; web: Peer; id: string; key: string; expires: number } | undefined;
  const driveLeaseMs = 10_000;
  // After a restart, a previous instance’s final grant may still be usable on the car.
  let sharedReservedUntil = sharedDrive ? Date.now() + driveLeaseMs : 0;
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
  app.post("/api/mobile/tts", async (c) => {
    const identity = await pairing.phone(c.req.raw.headers);
    if (!identity) return c.json({ error: "Unauthorized" }, 401);
    if (!options.speech) return c.json({ error: "Deepgram is not configured" }, 503);
    const body = await c.req.json().catch(() => null);
    if (typeof body?.text !== "string" || !body.text.trim() || body.text.length > 1000) return c.json({ error: "Invalid speech text" }, 400);
    const id = identity.account.user.id;
    if (ttsBusy.has(id)) return c.json({ error: "Voice synthesis busy" }, 429);
    ttsBusy.add(id);
    try {
      const audio = await deepgramSpeak(options.speech, body.text.trim(), c.req.raw.signal);
      if (!await pairing.valid(identity)) return c.json({ error: "Session expired" }, 401);
      return new Response(audio, { headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" } });
    } catch { return c.json({ error: "Deepgram voice synthesis failed" }, 502); }
    finally { ttsBusy.delete(id); }
  });
  app.get("/api/mobile/session", async (c) => {
    const authenticated = await pairing.phoneSession(c.req.raw.headers);
    if (!authenticated) return c.json({ error: "Unauthorized" }, 401);
    if (!options.robotOwnerId) return c.json({ error: "Robot driving authorization is not configured" }, 501);
    const { identity, session: phoneSession } = authenticated;
    if (!driveEligible(identity.account.user.id) || c.req.query("device_id") !== deviceId) {
      return c.json({ error: "Robot is not assigned to this account" }, 403);
    }
    const room = rooms.get(identity.account.user.id);
    const web = room?.get("web"), phone = room?.get("phone");
    if (!room || !web || !phone || phone.data.identity !== identity || !phone.data.driveBinding ||
        phone.data.driveBinding !== c.req.header("X-IRIS-Drive-Binding")) {
      return c.json({ error: "Connect a compatible phone and console" }, 409);
    }
    const binding = phone.data.driveBinding;
    const webSession = await pairing.session(web.data.identity);
    const now = Date.now();
    // No awaits between the ownership recheck and issuance: contenders cannot both claim the car.
    if (!pairing.current(identity) || !pairing.current(web.data.identity) ||
        room.get("web") !== web || room.get("phone") !== phone || phone.data.driveBinding !== binding ||
        web.readyState !== 1 || phone.readyState !== 1) {
      return c.json({ error: "Controller disconnected" }, 409);
    }
    if (!webSession) {
      revokeDrive(room);
      web.close(1008, "Account session expired; sign in again");
      return c.json({ error: "Console session expired" }, 409);
    }
    if (sharedDrive && (webSession.user.role !== "patient" || phoneSession.user.role !== "patient")) {
      revokePatientLease(phone);
      return c.json({ error: "Patient account required to drive the robot" }, 403);
    }
    if (lease && lease.expires <= now) lease = undefined;
    if (now < sharedReservedUntil || (lease && (lease.web !== web || lease.phone !== phone))) {
      return c.json({ error: "Robot drive lease is temporarily reserved" }, 409);
    }
    const expires = Math.min(now + driveLeaseMs, identity.expires, web.data.identity.expires,
      phoneSession.session.expiresAt.getTime(), webSession.session.expiresAt.getTime());
    if (expires <= now) return c.json({ error: "Controller session expired" }, 409);
    lease ??= { phone, web, id: crypto.randomUUID(), key: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex"), expires };
    // A shorter renewal cannot recall a longer grant already delivered to this pair.
    lease.expires = Math.max(lease.expires, expires);
    const grant = { control_session_id: lease.id, signing_key: lease.key, expires_at_ms: expires, device_id: deviceId, server_time_ms: now, max_ttl_ms: 300 };
    if (!send(web, { ...grant, type: "drive_grant", ts: now })) {
      revokeDrive(room);
      web.close(1013, "Drive connection unavailable");
      return c.json({ error: "Console unavailable" }, 409);
    }
    return c.json(grant);
  });
  const roomFor = (peer: Peer) => rooms.get(peer.data.identity.account.user.id);
  const send = (peer: Peer | undefined, message: Message) => {
    return !!peer && peer.readyState === 1 && peer.getBufferedAmount() < 2_000_000 && peer.send(JSON.stringify(message)) !== 0;
  };
  const speech = createPhoneSpeech(options, pairing, roomFor, send);
  app.use("/api/utterance*", bodyLimit({ maxSize: 5 * 1024 * 1024 + 16384 }));
  app.post("/api/utterance", async (c) => {
    const identity = await pairing.phone(c.req.raw.headers);
    if (!identity) return c.json({ error: "Unauthorized" }, 401);
    if (!options.talkHandler) return c.json({ error: "Speech service unavailable" }, 503);
    return speech.upload(identity, c.req.raw);
  });
  const revokeDrive = (room: Map<Role, Peer>) => {
    const phone = room.get("phone");
    if (!phone) return;
    delete phone.data.driveBinding;
    if (!lease || lease.phone !== phone || lease.web !== room.get("web")) return;
    const old = lease;
    lease = undefined;
    // A disconnected controller may miss revocation. Its last signed lease still bounds handoff.
    if (sharedDrive) sharedReservedUntil = Math.max(sharedReservedUntil, old.expires);
    const revoked = { type: "session_revoked", device_id: deviceId, control_session_id: old.id, ts: Date.now() };
    for (const peer of [old.web, old.phone]) {
      if (!send(peer, revoked) && peer.readyState === 1) peer.close(1013, "Drive connection unavailable");
    }
  };
  const bindDrive = (room: Map<Role, Peer>) => {
    const phone = room.get("phone");
    if (!phone?.data.driveCapable || phone.data.driveBinding || !room.has("web") ||
        !driveEligible(phone.data.identity.account.user.id)) return;
    const binding = crypto.randomUUID();
    if (send(phone, { type: "drive_binding", device_id: deviceId, binding, ts: Date.now() })) phone.data.driveBinding = binding;
    else phone.close(1013, "Drive connection unavailable");
  };
  const revokePatientLease = (peer: Peer) => {
    if (!lease || (lease.web !== peer && lease.phone !== peer)) return;
    const room = roomFor(peer);
    if (!room) return;
    revokeDrive(room);
    // The phone clears its binding on revocation. Rebind this still-connected pair for later polls.
    bindDrive(room);
  };
  const presence = (room: Map<Role, Peer>) => {
    const message = { type: "peer_status", web: room.has("web"), phone: room.has("phone"), robot: false, ts: Date.now() };
    for (const peer of room.values()) send(peer, message);
  };
  const validate = async (peer: Peer) => {
    if (peer.data.checking) return;
    peer.data.checking = true;
    try {
      const session = await pairing.session(peer.data.identity);
      if (!session) {
        speech.disconnect(peer);
        peer.close(1008, "Account session expired; sign in again");
      } else {
        speech.checkRole(peer, session.user.role);
        if (sharedDrive && session.user.role !== "patient") revokePatientLease(peer);
      }
    }
    catch { peer.close(1011, "Account validation unavailable"); }
    finally { peer.data.checking = false; }
  };
  return {
    maxRequestBodySize: 512_000,
    async fetch(request: Request, server: Server<PeerData>) {
      const url = new URL(request.url);
      if (url.pathname === "/api/mobile/speech") {
        const origin = request.headers.get("origin");
        if (origin && origin !== options.origin) return new Response("Untrusted origin", { status: 403 });
        const identity = await pairing.phone(request.headers);
        if (!identity) return new Response("Unauthorized", { status: 401 });
        if (!options.speech) return new Response("Deepgram is not configured", { status: 503 });
        const turn = await speech.authorizeStream(identity, url.searchParams);
        if (!turn) return new Response("A current patient approval is required", { status: 403 });
        if (server.upgrade(request, { data: { role: "phone", identity, speech: turn, window: Date.now(), messages: 0 } })) return;
        return new Response("WebSocket required", { status: 426 });
      }
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
        if (peer.data.speech) {
          speech.openStream(peer.data.speech, peer);
          return;
        }
        const id = peer.data.identity.account.user.id;
        const room = rooms.get(id) ?? new Map<Role, Peer>();
        rooms.set(id, room);
        const previous = room.get(peer.data.role);
        if (previous) { speech.disconnect(previous); revokeDrive(room); }
        room.set(peer.data.role, peer);
        previous?.close(4001, "Connected on another device");
        presence(room);
        bindDrive(room);
        peer.data.check = setInterval(() => void validate(peer), options.validationIntervalMs ?? 15_000);
      },
      close(peer: Peer) {
        clearInterval(peer.data.check);
        speech.disconnect(peer);
        if (peer.data.speech) return;
        const room = roomFor(peer);
        if (room?.get(peer.data.role) !== peer) return;
        revokeDrive(room);
        room.delete(peer.data.role); presence(room);
        if (!room.size) rooms.delete(peer.data.identity.account.user.id);
      },
      message(peer: Peer, raw: string | Buffer) {
        if (peer.data.speech) {
          if (peer.data.identity.expires <= Date.now()) { peer.close(1008, "Session expired"); return; }
          if (Date.now() - peer.data.window >= 1000) { peer.data.window = Date.now(); peer.data.messages = 0; }
          if (++peer.data.messages > 100) { peer.close(1008, "Audio rate exceeded"); return; }
          speech.streamMessage(peer.data.speech, peer, raw);
          return;
        }
        const room = roomFor(peer);
        if (room?.get(peer.data.role) !== peer) return;
        if (peer.data.identity.expires <= Date.now()) { peer.close(1008, "Session expired"); return; }
        if (Date.now() - peer.data.window > 1000) { peer.data.window = Date.now(); peer.data.messages = 0; }
        if (++peer.data.messages > 100) { peer.close(1008, "Message rate exceeded"); return; }
        try {
          const message = JSON.parse(String(raw)) as Message;
          if (!message || typeof message.type !== "string" || !Number.isFinite(message.ts)) return;
          const role = peer.data.role;
          if (message.type === "listen") { void speech.control(peer, message); return; }
          if (role === "phone" && message.type === "speech_state") { speech.phoneState(peer, message); return; }
          if (role === "phone" && message.type === "hello" && message.drive_proof === "hmac-sha256-v1") {
            peer.data.driveCapable = true;
            bindDrive(room);
          }
          // Never route an MQTT drive intention or trust account IDs supplied in a message.
          if (role === "web" && ["media_ready", "rtc_answer", "rtc_ice", "stop"].includes(message.type)) send(room.get("phone"), message);
          if (role === "web" && message.type === "speak" && typeof message.text === "string" && message.text.trim() && message.text.length <= 4000 &&
              typeof message.speak_id === "string" && message.speak_id.length <= 128 && ["phrase", "suggestion", "system"].includes(String(message.source)) && message.audio_url == null) send(room.get("phone"), message);
          if (role === "phone" && ["rtc_offer", "rtc_ice", "frame", "tts_status", "bump", "stop"].includes(message.type)) send(room.get("web"), message);
        } catch { /* Malformed messages cannot interrupt another account's relay. */ }
      },
    },
  };
}
