import { afterEach, expect, setSystemTime, test } from "bun:test";
import { createRobotGateway } from "../src/mobile/gateway";
import { Pairing, type AccountSession } from "../src/mobile/pairing";
import { MobileOAuth, pkceChallenge } from "../src/mobile/oauth";

const origin = "http://localhost:3001";
const account = (id: string): AccountSession => ({ user: { id, email: `${id}@example.invalid`, name: id }, session: { id: `session-${id}`, expiresAt: new Date(Date.now() + 3_600_000) } });
const cookie = (id: string) => new Headers({ cookie: id });
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function until(check: () => boolean) {
  const end = Date.now() + 2000;
  while (!check()) { if (Date.now() > end) throw new Error("Timed out waiting for relay"); await Bun.sleep(5); }
}
function fixture(googleEnabled = true, robotOwnerId?: string) {
  const sessions = new Map(["alice", "bob"].map((id) => [id, account(id)]));
  for (const id of ["alice", "bob"]) sessions.set(`mobile-${id}`, { ...account(id), session: { ...account(id).session, id: `mobile-session-${id}` } });
  const callbacks = new Map<string, URL>();
  const server = Bun.serve({ ...createRobotGateway({ origin, robotOwnerId, validationIntervalMs: 20,
    authBaseUrl: "http://localhost:3000", googleEnabled,
    resolve: async (headers) => sessions.get(headers.get("cookie") ?? "") ?? null,
    authHandler: async (request) => {
      const body = await request.json() as { provider: string; callbackURL: string; errorCallbackURL: string };
      expect(body.provider).toBe("google");
      expect(body.callbackURL).toBe(body.errorCallbackURL);
      const callback = new URL(body.callbackURL);
      callbacks.set(callback.searchParams.get("request")!, callback);
      return Response.json({ url: "https://accounts.google.com/o/oauth2/v2/auth?state=provider-state" }, { headers: { "Set-Cookie": "oauth-state=provider-state; HttpOnly" } });
    },
  }), port: 0, hostname: "127.0.0.1" });
  const base = `http://127.0.0.1:${server.port}`;
  const sockets: WebSocket[] = [];
  cleanups.push(async () => { sockets.forEach((socket) => socket.close()); await Bun.sleep(10); await server.stop(true); });
  const api = (path: string, id?: string, body?: unknown, token?: string) => fetch(base + path, {
    method: body !== undefined ? "POST" : "GET", redirect: "manual", headers: { origin, ...(id ? { cookie: id } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const begin = async () => {
    const state = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
    const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
    const started = await (await api("/api/mobile/oauth/start", undefined, { state, code_challenge: pkceChallenge(verifier) })).json() as { authorization_url: string };
    const authorize = new URL(started.authorization_url);
    const response = await api(authorize.pathname + authorize.search);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toStartWith("https://accounts.google.com/");
    expect(response.headers.get("set-cookie")).toContain("oauth-state");
    return { state, verifier, callback: callbacks.get(authorize.searchParams.get("request")!)!, authorize };
  };
  const signIn = async (id: string) => {
    const attempt = await begin();
    const result = await api(attempt.callback.pathname + attempt.callback.search, `mobile-${id}`);
    const link = new URL(result.headers.get("location")!);
    expect(link.searchParams.get("state")).toBe(attempt.state);
    return await (await api("/api/mobile/oauth/exchange", undefined, { code: link.searchParams.get("code"), code_verifier: attempt.verifier })).json() as { token: string; user: { id: string } };
  };
  const socket = async (role: "web" | "phone", identity: string) => {
    let url = base.replace("http:", "ws:") + `/ws?role=${role}`;
    if (role === "web") {
      const body = await (await api("/api/mobile/web-ticket", identity, {})).json() as { ticket: string };
      url += `&ticket=${body.ticket}`;
    }
    const ws = new WebSocket(url, { headers: role === "phone" ? { Authorization: `Bearer ${identity}` } : { Origin: origin } });
    sockets.push(ws);
    const messages: Record<string, unknown>[] = [];
    ws.addEventListener("message", ({ data }) => messages.push(JSON.parse(String(data))));
    await until(() => ws.readyState === WebSocket.OPEN);
    return { ws, messages };
  };
  return { server, sessions, base, api, signIn, socket, begin };
}

test("manual-code routes are removed; socket tickets require a signed-in browser and trusted origin", async () => {
  const f = fixture();
  expect((await f.api("/api/mobile/link-code", undefined, {})).status).toBe(404);
  expect((await f.api("/api/mobile/link", undefined, {})).status).toBe(404);
  expect((await f.api("/api/mobile/web-ticket", undefined, {})).status).toBe(401);
  expect((await fetch(f.base + "/api/mobile/web-ticket", { method: "POST", headers: { cookie: "alice", origin: "https://evil.invalid" } })).status).toBe(403);
  expect((await fetch(f.base + "/api/mobile/web-ticket", { method: "POST", headers: { cookie: "alice" } })).status).toBe(403);
  expect((await fetch(f.base + "/ws?role=phone")).status).toBe(401);
  expect((await f.api("/api/mobile/me")).status).toBe(401);
  expect((await f.api("/api/mobile/session")).status).toBe(401);
});

test("Google returns to the APK, PKCE is required, and the exchange cannot be replayed", async () => {
  const f = fixture();
  const attempt = await f.begin();
  const callback = await f.api(attempt.callback.pathname + attempt.callback.search, "mobile-alice");
  const destination = new URL(callback.headers.get("location")!);
  expect(destination.origin).toBe("null");
  expect(destination.protocol).toBe("com.iris.robot:");
  expect(destination.searchParams.has("token")).toBe(false);
  const exchange = { code: destination.searchParams.get("code"), code_verifier: attempt.verifier };
  expect((await f.api("/api/mobile/oauth/exchange", undefined, { ...exchange, code_verifier: "x".repeat(43) })).status).toBe(401);
  const response = await f.api("/api/mobile/oauth/exchange", undefined, exchange);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const linked = await response.json() as { token: string; user: { id: string } };
  expect(linked.user.id).toBe("alice");
  expect((await f.api("/api/mobile/oauth/exchange", undefined, exchange)).status).toBe(401);
  expect((await f.api("/api/mobile/me", undefined, undefined, "alice")).status).toBe(401);
  const me = await (await f.api("/api/mobile/me", undefined, undefined, linked.token)).json() as { user: { id: string } };
  expect(me.user.id).toBe("alice");
  expect((await f.api("/api/mobile/session", undefined, undefined, linked.token)).status).toBe(501);
  expect((await f.api("/api/utterance", undefined, {}, linked.token)).status).toBe(501);
});

test("media and confirmed speech are isolated by the authenticated account, including spoofed user IDs", async () => {
  const f = fixture();
  const alice = await f.signIn("alice"), bob = await f.signIn("bob");
  const aw = await f.socket("web", "alice"), bw = await f.socket("web", "bob");
  const ap = await f.socket("phone", alice.token), bp = await f.socket("phone", bob.token);
  ap.ws.send(JSON.stringify({ type: "rtc_offer", sdp: "alice-camera", user_id: "bob", ts: Date.now() }));
  aw.ws.send(JSON.stringify({ type: "speak", speak_id: "a1", text: "Hello", source: "phrase", ts: Date.now() }));
  await until(() => aw.messages.some((message) => message.type === "rtc_offer") && ap.messages.some((message) => message.type === "speak"));
  expect(bw.messages.some((message) => message.type === "rtc_offer")).toBe(false);
  expect(bp.messages.some((message) => message.type === "speak")).toBe(false);
  // A phone cannot inject a speak instruction into its laptop or another phone.
  ap.ws.send(JSON.stringify({ type: "speak", speak_id: "bad", text: "Spoof", source: "phrase", ts: Date.now() }));
  // The media relay must never become a movement publisher.
  aw.ws.send(JSON.stringify({ type: "drive_intent", action: "forward", ts: Date.now() }));
  await Bun.sleep(30);
  expect(aw.messages.some((message) => message.type === "speak")).toBe(false);
  expect(ap.messages.some((message) => message.type === "drive_intent")).toBe(false);
});

test("phone and laptop sign in independently to the same account; laptop sign-out closes only its socket", async () => {
  const f = fixture();
  const linked = await f.signIn("alice");
  const web = await f.socket("web", "alice"), phone = await f.socket("phone", linked.token);
  f.sessions.delete("alice");
  expect((await f.api("/api/mobile/me", undefined, undefined, linked.token)).status).toBe(200);
  await until(() => web.ws.readyState === WebSocket.CLOSED);
  expect(phone.ws.readyState).toBe(WebSocket.OPEN);
  f.sessions.delete("mobile-alice");
  await until(() => phone.ws.readyState === WebSocket.CLOSED);
});

test("phone sign-out revokes the credential and closes the phone without signing the laptop out", async () => {
  const f = fixture();
  const linked = await f.signIn("alice");
  const web = await f.socket("web", "alice"), phone = await f.socket("phone", linked.token);
  expect((await f.api("/api/mobile/logout", undefined, {}, linked.token)).status).toBe(200);
  await until(() => phone.ws.readyState === WebSocket.CLOSED);
  expect(web.ws.readyState).toBe(WebSocket.OPEN);
  expect((await f.api("/api/mobile/me", undefined, undefined, linked.token)).status).toBe(401);
});

test("relinking replaces the old phone, and replacing a console preserves correct presence", async () => {
  const f = fixture();
  const first = await f.signIn("alice");
  const oldPhone = await f.socket("phone", first.token);
  const oldWeb = await f.socket("web", "alice");
  const newWeb = await f.socket("web", "alice");
  await until(() => oldWeb.ws.readyState === WebSocket.CLOSED);
  expect(newWeb.messages.some((message) => message.type === "peer_status" && message.phone === true)).toBe(true);
  const second = await f.signIn("alice");
  await until(() => oldPhone.ws.readyState === WebSocket.CLOSED);
  expect((await f.api("/api/mobile/me", undefined, undefined, first.token)).status).toBe(401);
  await f.socket("phone", second.token);
  await until(() => newWeb.messages.some((message) => message.type === "peer_status" && message.phone === true));
});

test("OAuth attempts are rate limited without trusting forwarded caller IP headers", async () => {
  const f = fixture();
  for (let i = 0; i < 10; i++) expect((await f.api("/api/mobile/oauth/start", undefined, {})).status).toBe(400);
  expect((await f.api("/api/mobile/oauth/start", undefined, {})).status).toBe(429);
});

test("OAuth attempts and exchange codes expire, and websocket tickets are single-use", async () => {
  let now = Date.now();
  const pairing = new Pairing(async () => account("alice"), () => now);
  const identity = (await pairing.browser(cookie("alice")))!;
  const oauth = new MobileOAuth(pairing, () => now);
  const verifier = "v".repeat(43);
  const start = oauth.begin("s".repeat(43), pkceChallenge(verifier))!;
  const unstarted = oauth.begin("u".repeat(43), pkceChallenge(verifier))!;
  const pending = oauth.authorize(start.request)!;
  expect(oauth.takeCallback(start.request, "forged-key")).toBeNull();
  const completed = oauth.complete(oauth.takeCallback(start.request, pending.returnKey)!, identity);
  const code = new URL(completed).searchParams.get("code")!;
  expect(oauth.takeCallback(start.request, pending.returnKey)).toBeNull();
  const ticket = pairing.ticket(identity);
  expect(await pairing.consumeTicket(ticket)).not.toBeNull();
  expect(await pairing.consumeTicket(ticket)).toBeNull();
  const expiredTicket = pairing.ticket(identity);
  now += 31_000;
  expect(await pairing.consumeTicket(expiredTicket)).toBeNull();
  now += 60_000;
  expect(await oauth.exchange(code, verifier)).toBeNull();
  now += 5 * 60_000;
  expect(oauth.authorize(unstarted.request)).toBeNull();
});

test("forged callbacks cannot bypass Google and cancellation returns safely to the app", async () => {
  const f = fixture();
  const attempt = await f.begin();
  const forged = new URL(attempt.callback);
  forged.searchParams.set("return_key", "forged");
  expect((await f.api(forged.pathname + forged.search, "mobile-alice")).status).toBe(400);
  const canceled = new URL(attempt.callback);
  canceled.searchParams.set("error", "access_denied");
  const response = await f.api(canceled.pathname + canceled.search, "mobile-alice");
  const result = new URL(response.headers.get("location")!);
  expect(result.searchParams.get("state")).toBe(attempt.state);
  expect(result.searchParams.get("error")).toBe("access_denied");
  expect(result.searchParams.has("code")).toBe(false);
  expect((await f.api(attempt.callback.pathname + attempt.callback.search, "mobile-alice")).status).toBe(400);
});

test("an OAuth return without a verified Better Auth session never signs the phone in", async () => {
  const f = fixture();
  const attempt = await f.begin();
  const response = await f.api(attempt.callback.pathname + attempt.callback.search);
  const result = new URL(response.headers.get("location")!);
  expect(result.searchParams.get("error")).toBe("sign_in_failed");
  expect(result.searchParams.has("code")).toBe(false);
});

test("a missing Google configuration is reported before opening the browser", async () => {
  const f = fixture(false);
  expect((await f.api("/api/mobile/oauth/start", undefined, { state: "s".repeat(43), code_challenge: pkceChallenge("v".repeat(43)) })).status).toBe(503);
});

test("concurrent PKCE exchanges cannot issue two phone credentials", async () => {
  const pairing = new Pairing(async () => account("alice"));
  const oauth = new MobileOAuth(pairing);
  const verifier = "v".repeat(43);
  const start = oauth.begin("s".repeat(43), pkceChallenge(verifier))!;
  const pending = oauth.authorize(start.request)!;
  const result = oauth.complete(oauth.takeCallback(start.request, pending.returnKey)!, (await pairing.browser(cookie("alice")))!);
  const code = new URL(result).searchParams.get("code");
  const results = await Promise.all([oauth.exchange(code, verifier), oauth.exchange(code, verifier)]);
  expect(results.filter(Boolean)).toHaveLength(1);
});

test("drive leases require the configured owner, live signed-intent phone, paired console and socket binding", async () => {
  const f = fixture(true, "alice");
  const alice = await f.signIn("alice"), bob = await f.signIn("bob");
  const poll = (token: string, binding = "", device = "esp12e_carbot") => fetch(
    f.base + "/api/mobile/session?device_id=" + device,
    { headers: { authorization: "Bearer " + token, "X-IRIS-Drive-Binding": binding } },
  );
  const web = await f.socket("web", "alice"), phone = await f.socket("phone", alice.token);
  const otherWeb = await f.socket("web", "bob"), otherPhone = await f.socket("phone", bob.token);
  const hello = JSON.stringify({ type: "hello", drive_proof: "hmac-sha256-v1", ts: Date.now() });
  otherPhone.ws.send(hello);
  expect((await poll(bob.token)).status).toBe(403);
  expect((await poll(alice.token)).status).toBe(409);
  phone.ws.send(hello);
  await until(() => phone.messages.some(m => m.type === "drive_binding"));
  const binding = String(phone.messages.find(m => m.type === "drive_binding")!.binding);
  expect((await poll(alice.token, "unbound")).status).toBe(409);
  expect((await poll(alice.token, binding, "other")).status).toBe(403);
  const response = await poll(alice.token, binding);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const grant = await response.json() as { control_session_id: string; signing_key: string; server_time_ms: number; expires_at_ms: number };
  expect(grant.signing_key).toMatch(/^[0-9a-f]{64}$/);
  expect(grant.expires_at_ms - grant.server_time_ms).toBe(10_000);
  await until(() => web.messages.some(m => m.type === "drive_grant"));
  expect(web.messages.find(m => m.type === "drive_grant")).toMatchObject({ ...grant, max_ttl_ms: 300 });
  expect(otherWeb.messages.some(m => m.type === "drive_grant")).toBe(false);
  expect(otherPhone.messages.some(m => m.type === "drive_binding")).toBe(false);
  expect(web.messages.some(m => m.type === "drive_binding")).toBe(false);
  expect(await (await poll(alice.token, binding)).json()).toMatchObject({ control_session_id: grant.control_session_id, signing_key: grant.signing_key });

  let active = grant;
  try {
    setSystemTime(new Date(grant.expires_at_ms + 100));
    const expired = await poll(alice.token, binding);
    expect(expired.status).toBe(200);
    active = await expired.json() as typeof grant;
    expect(active.control_session_id).not.toBe(grant.control_session_id);
    expect(active.signing_key).not.toBe(grant.signing_key);
  } finally { setSystemTime(); }

  const nextWeb = await f.socket("web", "alice");
  await until(() => phone.messages.some(m => m.type === "session_revoked" && m.control_session_id === active.control_session_id));
  expect((await poll(alice.token, binding)).status).toBe(409);
  const nextBinding = String(phone.messages.filter(m => m.type === "drive_binding").at(-1)!.binding);
  const nextGrant = await (await poll(alice.token, nextBinding)).json() as typeof grant;
  expect(nextGrant.control_session_id).not.toBe(active.control_session_id);
  expect(nextGrant.signing_key).not.toBe(active.signing_key);
  const nextPhone = await f.socket("phone", alice.token);
  await until(() => nextWeb.messages.some(m => m.type === "session_revoked" && m.control_session_id === nextGrant.control_session_id));
  expect((await poll(alice.token, nextBinding)).status).toBe(409);
  nextPhone.ws.send(hello);
  await until(() => nextPhone.messages.some(m => m.type === "drive_binding"));
  const finalBinding = String(nextPhone.messages.find(m => m.type === "drive_binding")!.binding);
  expect((await poll(alice.token, finalBinding)).status).toBe(200);
  nextWeb.ws.close();
  await until(() => nextPhone.messages.some(m => m.type === "session_revoked"));
  expect((await poll(alice.token, finalBinding)).status).toBe(409);
});

test("revoking a phone during an asynchronous account check invalidates the in-flight result", async () => {
  const checked = Promise.withResolvers<AccountSession | null>();
  const pairing = new Pairing(() => checked.promise);
  const identity = { account: account("alice"), headers: cookie("alice"), expires: Date.now() + 60_000 };
  const credential = pairing.issue(identity);
  const headers = new Headers({ authorization: "Bearer " + credential.token });
  const firstCheck = pairing.phone(headers);
  checked.resolve(identity.account);
  const phone = await firstCheck;
  expect(phone).not.toBeNull();
  const outstanding = pairing.valid(phone!);
  pairing.revoke(phone!);
  expect(await outstanding).toBe(false);
});
