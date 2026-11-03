import { afterEach, expect, test } from "bun:test";
import { createRobotGateway } from "../src/mobile/gateway";
import { Pairing, type AccountSession } from "../src/mobile/pairing";

const origin = "http://localhost:3001";
const account = (id: string): AccountSession => ({ user: { id, email: `${id}@example.invalid`, name: id }, session: { id: `session-${id}`, expiresAt: new Date(Date.now() + 3_600_000) } });
const cookie = (id: string) => new Headers({ cookie: id });
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function until(check: () => boolean) {
  const end = Date.now() + 2000;
  while (!check()) { if (Date.now() > end) throw new Error("Timed out waiting for relay"); await Bun.sleep(5); }
}
function fixture() {
  const sessions = new Map(["alice", "bob"].map((id) => [id, account(id)]));
  const server = Bun.serve({ ...createRobotGateway({ origin, validationIntervalMs: 20,
    resolve: async (headers) => sessions.get(headers.get("cookie") ?? "") ?? null,
    authHandler: async () => new Response("Test auth"),
  }), port: 0, hostname: "127.0.0.1" });
  const base = `http://127.0.0.1:${server.port}`;
  const sockets: WebSocket[] = [];
  cleanups.push(async () => { sockets.forEach((socket) => socket.close()); await Bun.sleep(10); await server.stop(true); });
  const api = (path: string, id?: string, body?: unknown, token?: string) => fetch(base + path, {
    method: body !== undefined ? "POST" : "GET", headers: { origin, ...(id ? { cookie: id } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const link = async (id: string) => {
    const code = await (await api("/api/mobile/link-code", id, {})).json() as { code: string };
    return await (await api("/api/mobile/link", undefined, code)).json() as { token: string; user: { id: string } };
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
  return { server, sessions, base, api, link, socket };
}

test("link codes and socket tickets require the existing signed-in browser and trusted origin", async () => {
  const f = fixture();
  expect((await f.api("/api/mobile/link-code", undefined, {})).status).toBe(401);
  expect((await f.api("/api/mobile/web-ticket", undefined, {})).status).toBe(401);
  expect((await fetch(f.base + "/api/mobile/link-code", { method: "POST", headers: { cookie: "alice", origin: "https://evil.invalid" } })).status).toBe(403);
  expect((await fetch(f.base + "/api/mobile/link-code", { method: "POST", headers: { cookie: "alice" } })).status).toBe(403);
  expect((await fetch(f.base + "/ws?role=phone")).status).toBe(401);
  expect((await f.api("/api/mobile/me")).status).toBe(401);
  expect((await f.api("/api/mobile/session")).status).toBe(401);
});

test("a phone signs in as the same account, codes are one-use, and credentials cannot be forged", async () => {
  const f = fixture();
  const issued = await (await f.api("/api/mobile/link-code", "alice", {})).json() as { code: string };
  const response = await f.api("/api/mobile/link", undefined, { code: issued.code.toLowerCase().replace(/(.{4})/g, "$1 ") });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const linked = await response.json() as { token: string; user: { id: string } };
  expect(linked.user.id).toBe("alice");
  expect((await f.api("/api/mobile/link", undefined, issued)).status).toBe(401);
  expect((await f.api("/api/mobile/me", undefined, undefined, "alice")).status).toBe(401);
  const me = await (await f.api("/api/mobile/me", undefined, undefined, linked.token)).json() as { user: { id: string } };
  expect(me.user.id).toBe("alice");
  expect((await f.api("/api/mobile/session", undefined, undefined, linked.token)).status).toBe(501);
  expect((await f.api("/api/utterance", undefined, {}, linked.token)).status).toBe(501);
});

test("media and confirmed speech are isolated by the authenticated account, including spoofed user IDs", async () => {
  const f = fixture();
  const alice = await f.link("alice"), bob = await f.link("bob");
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

test("laptop sign-out revokes its phone credential and closes both active sockets", async () => {
  const f = fixture();
  const linked = await f.link("alice");
  const web = await f.socket("web", "alice"), phone = await f.socket("phone", linked.token);
  f.sessions.delete("alice");
  expect((await f.api("/api/mobile/me", undefined, undefined, linked.token)).status).toBe(401);
  await until(() => web.ws.readyState === WebSocket.CLOSED && phone.ws.readyState === WebSocket.CLOSED);
});

test("phone sign-out revokes the credential and closes the phone without signing the laptop out", async () => {
  const f = fixture();
  const linked = await f.link("alice");
  const web = await f.socket("web", "alice"), phone = await f.socket("phone", linked.token);
  expect((await f.api("/api/mobile/logout", undefined, {}, linked.token)).status).toBe(200);
  await until(() => phone.ws.readyState === WebSocket.CLOSED);
  expect(web.ws.readyState).toBe(WebSocket.OPEN);
  expect((await f.api("/api/mobile/me", undefined, undefined, linked.token)).status).toBe(401);
});

test("relinking replaces the old phone, and replacing a console preserves correct presence", async () => {
  const f = fixture();
  const first = await f.link("alice");
  const oldPhone = await f.socket("phone", first.token);
  const oldWeb = await f.socket("web", "alice");
  const newWeb = await f.socket("web", "alice");
  await until(() => oldWeb.ws.readyState === WebSocket.CLOSED);
  expect(newWeb.messages.some((message) => message.type === "peer_status" && message.phone === true)).toBe(true);
  const second = await f.link("alice");
  await until(() => oldPhone.ws.readyState === WebSocket.CLOSED);
  expect((await f.api("/api/mobile/me", undefined, undefined, first.token)).status).toBe(401);
  await f.socket("phone", second.token);
  await until(() => newWeb.messages.some((message) => message.type === "peer_status" && message.phone === true));
});

test("link attempts are rate limited without trusting forwarded caller IP headers", async () => {
  const f = fixture();
  for (let i = 0; i < 10; i++) expect((await f.api("/api/mobile/link", undefined, { code: "000000000000" })).status).toBe(401);
  expect((await f.api("/api/mobile/link", undefined, { code: "000000000000" })).status).toBe(429);
});

test("codes expire, regeneration invalidates the previous code, and websocket tickets are single-use", async () => {
  let now = Date.now();
  const pairing = new Pairing(async () => account("alice"), () => now);
  const identity = (await pairing.browser(cookie("alice")))!;
  const old = pairing.code(identity), current = pairing.code(identity);
  expect(await pairing.exchange(old.code)).toBeNull();
  const ticket = pairing.ticket(identity);
  expect(await pairing.consumeTicket(ticket)).not.toBeNull();
  expect(await pairing.consumeTicket(ticket)).toBeNull();
  const expiredTicket = pairing.ticket(identity);
  now += 31_000;
  expect(await pairing.consumeTicket(expiredTicket)).toBeNull();
  now += 5 * 60_000;
  expect(await pairing.exchange(current.code)).toBeNull();
});

test("concurrent exchanges cannot consume a link code twice", async () => {
  const pairing = new Pairing(async () => account("alice"));
  const code = pairing.code((await pairing.browser(cookie("alice")))!).code;
  const results = await Promise.all([pairing.exchange(code), pairing.exchange(code)]);
  expect(results.filter(Boolean)).toHaveLength(1);
});
