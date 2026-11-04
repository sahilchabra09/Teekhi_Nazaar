import { afterEach, expect, setSystemTime, test } from "bun:test";
import { createRobotGateway } from "../src/mobile/gateway";
import { Pairing, type AccountSession } from "../src/mobile/pairing";
import { MobileOAuth, pkceChallenge } from "../src/mobile/oauth";

const origin = "http://localhost:3001";
const account = (id: string): AccountSession => ({ user: { id, email: `${id}@example.invalid`, name: id, role: "patient" }, session: { id: `session-${id}`, expiresAt: new Date(Date.now() + 3_600_000) } });
const cookie = (id: string) => new Headers({ cookie: id });
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { setSystemTime(); for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function until(check: () => boolean) {
  const end = Date.now() + 2000;
  while (!check()) { if (Date.now() > end) throw new Error("Timed out waiting for relay"); await Bun.sleep(5); }
}
function fixture(googleEnabled = true, robotOwnerId?: string, talkHandler?: (request: Request) => Promise<Response>, connectSpeech?: () => WebSocket) {
  const sessions = new Map(["alice", "bob"].map((id) => [id, account(id)]));
  for (const id of ["alice", "bob"]) sessions.set(`mobile-${id}`, { ...account(id), session: { ...account(id).session, id: `mobile-session-${id}` } });
  const callbacks = new Map<string, URL>();
  let sessionGate: Promise<void> | undefined;
  const server = Bun.serve({ ...createRobotGateway({ origin, robotOwnerId, talkHandler, validationIntervalMs: 20,
    authBaseUrl: "http://localhost:3000", googleEnabled, connectSpeech,
    speech: connectSpeech ? { apiKey: "test", sttModel: "test", ttsModel: "test" } : undefined,
    resolve: async (headers) => { await sessionGate; return sessions.get(headers.get("cookie") ?? "") ?? null; },
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
  return { server, sessions, base, api, signIn, socket, begin, holdSessions: (gate: Promise<void>) => { sessionGate = gate; } };
}

test("the same mobile bearer reconnects up to seven days, bounded by its parent session", async () => {
  const day = 86_400_000;
  const issuedAt = Date.UTC(2026, 0, 1);
  for (const parentDays of [2, 10]) {
    let now = issuedAt;
    const parent = account("alice");
    parent.session.expiresAt = new Date(issuedAt + parentDays * day);
    const pairing = new Pairing(async () => parent, () => now);
    const linked = pairing.issue((await pairing.browser(cookie("alice")))!);
    const headers = new Headers({ Authorization: `Bearer ${linked.token}` });
    const expires = issuedAt + Math.min(7, parentDays) * day;
    expect(linked.expires_at_ms).toBe(expires);
    now += day + 1;
    expect((await pairing.phone(headers))?.expires).toBe(expires);
    now = expires - 1;
    expect((await pairing.phone(headers))?.expires).toBe(expires);
    now = expires;
    expect(await pairing.phone(headers)).toBeNull();
  }
});

test("losing and replacing the phone transport preserves its original account token and expiry", async () => {
  const f = fixture();
  const { token } = await f.signIn("alice");
  const me = async () => {
    const response = await f.api("/api/mobile/me", undefined, undefined, token);
    expect(response.status).toBe(200);
    return await response.json() as { expires_at_ms: number; user: { id: string } };
  };
  const before = await me();
  expect(before.user.id).toBe("alice");
  expect(before.expires_at_ms).toBeGreaterThan(Date.now());
  const first = await f.socket("phone", token);
  first.ws.terminate();
  await until(() => first.ws.readyState === WebSocket.CLOSED);
  const second = await f.socket("phone", token);
  await f.socket("phone", token);
  await until(() => second.ws.readyState === WebSocket.CLOSED);
  expect(await me()).toEqual(before);
  await f.api("/api/mobile/logout", undefined, {}, token);
  expect((await f.api("/api/mobile/me", undefined, undefined, token)).status).toBe(401);
});

type TestPeer = Awaited<ReturnType<ReturnType<typeof fixture>["socket"]>>;
const listen = (peer: TestPeer, action: string, id: string, fields: Record<string, unknown> = {}) => peer.ws.send(JSON.stringify({ type: "listen", action, request_id: id, ...fields, ts: Date.now() }));
const gotListen = (peer: TestPeer, action: string, id: string) => peer.messages.some(m => m.type === "listen" && m.action === action && m.request_id === id);
async function approve(phone: TestPeer, web: TestPeer, id: string) {
  listen(phone, "request", id);
  await until(() => gotListen(web, "request", id));
  listen(web, "start", id);
  await until(() => gotListen(phone, "start", id));
}

test("phone audio and Android transcripts share Talk routes and return replies only to their account", async () => {
  const calls: { path: string; cookie: string; text?: string; audio?: number }[] = [];
  const f = fixture(true, undefined, async (request) => {
    const path = new URL(request.url).pathname;
    const text = path.endsWith("transcript") ? (await request.json() as {text:string}).text : undefined;
    const audio = text === undefined ? ((await request.formData()).get("audio") as File).size : undefined;
    calls.push({ path, cookie: request.headers.get("cookie")!, text, audio });
    return Response.json({ status: "ok", conversationId: "alice-conversation", heard: "Would you like water?", replies: ["Yes please", "No thanks", "Later please"], lowConfidence: false });
  });
  const phone = await f.signIn("alice");
  const aw = await f.socket("web", "alice"), bw = await f.socket("web", "bob");
  const ap = await f.socket("phone", phone.token);
  await approve(ap, aw, "capture-1");
  const form = new FormData(); form.set("utterance_id", "capture-1");
  form.set("audio", new File([new Uint8Array(16000)], "speech.wav", {type:"audio/wav"}));
  const uploaded = await fetch(f.base + "/api/utterance", {method:"POST", headers:{Authorization:`Bearer ${phone.token}`}, body:form});
  expect(uploaded.status).toBe(200);
  expect(await uploaded.text()).not.toContain("Yes please");
  await until(() => aw.messages.some(m => m.type === "talk_result"));
  expect(calls[0]).toEqual({path:"/api/talk/utterance", cookie:"alice", audio:16000, text:undefined});
  expect(bw.messages.some(m => m.type === "talk_result")).toBe(false);
  const transcript = new FormData(); transcript.set("text", "Would you like water?"); transcript.set("utterance_id", "capture-2");
  const upload = () => fetch(f.base + "/api/utterance", {method:"POST", headers:{Authorization:`Bearer ${phone.token}`}, body:transcript});
  expect((await upload()).status).toBe(403);
  await approve(ap, aw, "capture-2");
  expect((await fetch(f.base + "/api/utterance", {method:"POST", headers:{Authorization:`Bearer ${phone.token}`}, body:transcript})).status).toBe(200);
  expect((await upload()).status).toBe(403);
  expect(calls).toHaveLength(2);
  expect(calls[1]?.path).toBe("/api/talk/transcript");
  expect(calls[1]?.text).toBe("Would you like water?");
  expect((await fetch(f.base + "/api/utterance", {method:"POST", body:new FormData()})).status).toBe(401);
});

test("mobile speech preserves provider errors and never reports successful replies", async () => {
  const f = fixture(true, undefined, async () => Response.json({error:"AI_NOT_CONFIGURED", message:"Configure speech provider"}, {status:503}));
  const phone = await f.signIn("alice"), web = await f.socket("web", "alice");
  await approve(await f.socket("phone", phone.token), web, "failed-capture");
  const body = new FormData(); body.set("text", "hello"); body.set("utterance_id", "failed-capture");
  expect((await fetch(f.base + "/api/utterance", {method:"POST", headers:{Authorization:`Bearer ${phone.token}`}, body})).status).toBe(503);
  await until(() => web.messages.some(m => m.type === "talk_result"));
  expect(web.messages.find(m => m.type === "talk_result")?.ok).toBe(false);
});

test("requests are isolated by account and need a live patient decision each time", async () => {
  const calls: string[] = [];
  const f = fixture(true, undefined, async () => { calls.push("talk"); return Response.json({}); });
  const { token } = await f.signIn("alice"), bob = await f.signIn("bob");
  const phone = await f.socket("phone", token), web = await f.socket("web", "alice"), otherWeb = await f.socket("web", "bob");
  const upload = (id: string, bearer = token) => {
    const body = new FormData(); body.set("text", "hello"); body.set("utterance_id", id);
    return fetch(f.base + "/api/utterance", { method: "POST", headers: { authorization: "Bearer " + bearer }, body });
  };
  listen(web, "start", "unsolicited");
  expect((await upload("unsolicited")).status).toBe(403);
  listen(phone, "request", "first");
  await until(() => gotListen(web, "request", "first"));
  expect(gotListen(otherWeb, "request", "first")).toBe(false);
  listen(otherWeb, "start", "first");
  expect((await upload("first")).status).toBe(403);
  listen(web, "cancel", "first");
  await until(() => gotListen(phone, "cancel", "first"));
  listen(web, "start", "first");
  expect((await upload("first")).status).toBe(403);

  listen(phone, "request", "role-changed");
  await until(() => gotListen(web, "request", "role-changed"));
  f.sessions.get("alice")!.user.role = "doctor";
  listen(web, "start", "role-changed");
  await until(() => gotListen(phone, "cancel", "role-changed"));
  expect((await upload("role-changed")).status).toBe(403);
  listen(phone, "request", "doctor");
  await until(() => gotListen(phone, "cancel", "doctor"));
  expect(gotListen(web, "request", "doctor")).toBe(false);
  f.sessions.get("alice")!.user.role = "patient";
  await approve(phone, web, "allowed");
  expect((await upload("allowed", bob.token)).status).toBe(403);
  expect((await upload("another")).status).toBe(403);
  listen(phone, "stop", "allowed");
  await until(() => gotListen(web, "stop", "allowed"));
  expect((await upload("allowed")).status).toBe(200);
  listen(phone, "request", "allowed");
  await until(() => gotListen(phone, "cancel", "allowed"));
  expect(calls).toHaveLength(1);
});

test("a role change cancels an approved turn while the live account retains media pairing", async () => {
  const f = fixture(true, undefined, async () => Response.json({}));
  const { token } = await f.signIn("alice"), phone = await f.socket("phone", token), web = await f.socket("web", "alice");
  await approve(phone, web, "role-change");
  f.sessions.get("alice")!.user.role = "doctor";
  await until(() => gotListen(phone, "cancel", "role-change"));
  phone.ws.send(JSON.stringify({ type: "rtc_offer", sdp: "still paired", ts: Date.now() }));
  await until(() => web.messages.some(m => m.type === "rtc_offer" && m.sdp === "still paired"));
});

test("replacing the approving web peer suppresses an in-flight transcript and its response", async () => {
  const started = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const f = fixture(true, undefined, async () => { started.resolve(); await release.promise; return Response.json({ heard: "private" }); });
  const { token } = await f.signIn("alice"), phone = await f.socket("phone", token), web = await f.socket("web", "alice");
  await approve(phone, web, "in-flight");
  const body = new FormData(); body.set("utterance_id", "in-flight"); body.set("text", "hello");
  const upload = fetch(f.base + "/api/utterance", { method: "POST", headers: { authorization: "Bearer " + token }, body });
  await started.promise;
  const replacement = await f.socket("web", "alice");
  await until(() => gotListen(phone, "cancel", "in-flight"));
  release.resolve();
  const response = await upload;
  expect(response.status).toBe(403);
  expect(await response.text()).not.toContain("private");
  expect(replacement.messages.some(m => m.type === "talk_result")).toBe(false);
});

test.each([false, true])("streaming requires the granted ID and stops accepting PCM after one final transcript (continuous=%s)", async continuous => {
  const received: (string | Buffer)[] = [];
  const provider = Bun.serve({
    port: 0, hostname: "127.0.0.1",
    fetch(request, server) { return server.upgrade(request) ? undefined : new Response(null, {status: 400}); },
    websocket: { message(ws, message) {
      received.push(message);
      if (typeof message === "string" && JSON.parse(message).type === "Finalize") ws.send(JSON.stringify({
        type: "Results", is_final: true, from_finalize: true, channel: { alternatives: [{ transcript: "hello", confidence: .9 }] },
      }));
    } },
  });
  cleanups.push(() => provider.stop(true));
  const f = fixture(true, undefined, async () => Response.json({ status: "ok", heard: "hello" }), () => new WebSocket(`ws://127.0.0.1:${provider.port}`));
  const { token } = await f.signIn("alice"), phone = await f.socket("phone", token), web = await f.socket("web", "alice");
  const headers = { authorization: "Bearer " + token };
  expect((await fetch(f.base + "/api/mobile/speech", { headers })).status).toBe(403);
  if (continuous) await approveCall(phone, web, "stream");
  else await approve(phone, web, "stream");
  const fields = continuous ? {call_id: "stream"} : {};
  const socketUrl = f.base.replace("http:", "ws:") + "/api/mobile/speech";
  if (continuous) expect((await fetch(f.base + "/api/mobile/speech?call_id=stream&request_id=wrong", {headers})).status).toBe(403);
  const stream = new WebSocket(socketUrl + (continuous ? "?call_id=stream&request_id=stream" : ""), { headers });
  await until(() => stream.readyState === WebSocket.OPEN);
  const pcm = new Uint8Array(100);
  stream.send(JSON.stringify({ action: "resume" })); stream.send(pcm);
  stream.send(JSON.stringify({ action: "start", ...fields, request_id: "guessed" })); stream.send(pcm);
  if (continuous) { stream.send(JSON.stringify({action: "start", call_id: "wrong", request_id: "stream"})); stream.send(pcm); }
  stream.send(JSON.stringify({ action: "start", ...fields, request_id: "stream" })); stream.send(pcm);
  await until(() => received.length > 0);
  expect(received).toHaveLength(1);
  stream.send(JSON.stringify({ action: "stop", ...fields, request_id: "stream" })); stream.send(pcm);
  await until(() => web.messages.some(m => m.type === "talk_result" && m.request_id === "stream"));
  expect(received.filter(m => typeof m !== "string")).toHaveLength(1);
  expect(web.messages.filter(m => m.type === "talk_result")).toHaveLength(1);
  expect((await fetch(f.base + "/api/mobile/speech", { headers })).status).toBe(403);
  if (continuous) {
    await until(() => stream.readyState === WebSocket.CLOSED);
    listen(phone, "next", "abandoned", {call_id: "stream"});
    await turnStarted(phone, web, "stream", "abandoned");
    const abandoned = new WebSocket(socketUrl + "?call_id=stream&request_id=abandoned", {headers});
    await until(() => abandoned.readyState === WebSocket.OPEN);
    abandoned.close();
    await until(() => web.messages.some(m => m.state === "failed" && m.call_id === "stream" && m.request_id === "abandoned"));
    listen(phone, "next", "after-close", {call_id: "stream"});
    await turnStarted(phone, web, "stream", "after-close");
  }
});

test("pending and active approvals expire even when their timer callback is delayed", async () => {
  const f = fixture(true, undefined, async () => Response.json({}));
  const {token} = await f.signIn("alice"), phone = await f.socket("phone", token), web = await f.socket("web", "alice");
  listen(phone, "request", "pending");
  await until(() => gotListen(web, "request", "pending"));
  try {
    setSystemTime(new Date(Date.now() + 60_001));
    listen(web, "start", "pending");
    await until(() => gotListen(phone, "cancel", "pending"));
    await approve(phone, web, "active");
    setSystemTime(new Date(Date.now() + 100_001));
    const body = new FormData(); body.set("utterance_id", "active"); body.set("text", "late");
    expect((await fetch(f.base + "/api/utterance", { method: "POST", headers: { authorization: "Bearer " + token }, body })).status).toBe(403);
    await until(() => gotListen(web, "cancel", "active"));
  } finally { setSystemTime(); }
});

async function approveCall(phone: TestPeer, web: TestPeer, call: string) {
  listen(phone, "request", call, { continuous: true });
  await until(() => gotListen(web, "request", call));
  expect(web.messages.find(m => m.action === "request" && m.request_id === call)?.continuous).toBe(true);
  listen(web, "start", call, { continuous: true });
  await turnStarted(phone, web, call, call);
}

function turnStarted(phone: TestPeer, web: TestPeer, call: string, turn: string) {
  return until(() => [phone, web].every(peer => peer.messages.some(m =>
    m.action === "start" && m.continuous === true && m.call_id === call && m.request_id === turn)));
}

function uploadTurn(base: string, token: string, call: string, turn: string) {
  const body = new FormData(); body.set("utterance_id", turn); body.set("text", "hello"); body.set("call_id", call);
  return fetch(base + "/api/utterance", { method: "POST", headers: { authorization: "Bearer " + token }, body });
}

test("a continuous call outlives the single-turn timeout, preserves conversation context and ends explicitly", async () => {
  const conversations: (string | undefined)[] = [];
  const f = fixture(true, undefined, async request => {
    conversations.push((await request.json() as { conversationId?: string }).conversationId);
    return Response.json({ status: "ok", heard: "hello", conversationId: "conversation-one" });
  });
  const { token } = await f.signIn("alice"), phone = await f.socket("phone", token), web = await f.socket("web", "alice");
  await approveCall(phone, web, "call");
  try {
    setSystemTime(new Date(Date.now() + 180_000));
    expect((await uploadTurn(f.base, token, "wrong-call", "call")).status).toBe(403);
    expect((await uploadTurn(f.base, token, "call", "call")).status).toBe(200);
    await until(() => web.messages.some(m => m.type === "talk_result" && m.call_id === "call" && m.request_id === "call"));
    listen(phone, "next", "second", {call_id: "call"});
    await turnStarted(phone, web, "call", "second");
    expect((await uploadTurn(f.base, token, "call", "second")).status).toBe(200);
    expect(conversations).toEqual([undefined, "conversation-one"]);
    await until(() => phone.messages.some(m => m.state === "ready" && m.call_id === "call" && m.request_id === "second"));
    listen(phone, "next", "second", {call_id: "call"});
    listen(phone, "next", "third", {call_id: "call"});
    await turnStarted(phone, web, "call", "third");
    expect((await uploadTurn(f.base, token, "call", "second")).status).toBe(403);
    listen(web, "cancel", "call", {call_id: "call"});
    await until(() => phone.messages.some(m => m.action === "cancel" && m.call_id === "call" && m.request_id === "call"));
    listen(phone, "next", "fourth", {call_id: "call"});
    expect((await uploadTurn(f.base, token, "call", "third")).status).toBe(403);
    expect((await uploadTurn(f.base, token, "call", "fourth")).status).toBe(403);
    expect(web.messages.filter(m => m.action === "request")).toHaveLength(1);
  } finally { setSystemTime(); }
});

test("TTS pause during processing aborts that turn, then a new turn can run until a control peer leaves", async () => {
  const started = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const f = fixture(true, undefined, async () => { started.resolve(); await release.promise; return Response.json({status: "ok"}); });
  const { token } = await f.signIn("alice"), phone = await f.socket("phone", token), web = await f.socket("web", "alice");
  await approveCall(phone, web, "call");
  const upload = uploadTurn(f.base, token, "call", "call");
  await started.promise;
  listen(phone, "pause", "call", {call_id: "call"});
  await until(() => phone.messages.some(m => m.state === "paused" && m.call_id === "call" && m.request_id === "call"));
  listen(phone, "next", "after-tts", {call_id: "call"});
  await turnStarted(phone, web, "call", "after-tts");
  release.resolve();
  expect((await upload).status).toBe(403);
  expect(web.messages.some(m => m.type === "talk_result")).toBe(false);
  phone.ws.send(JSON.stringify({type: "speech_state", state: "no_speech", call_id: "call", request_id: "after-tts", ts: Date.now()}));
  await until(() => web.messages.some(m => m.state === "no_speech" && m.call_id === "call" && m.request_id === "after-tts"));
  web.ws.close();
  await until(() => gotListen(phone, "cancel", "call"));
  await f.socket("web", "alice");
  listen(phone, "next", "after-disconnect", {call_id: "call"});
  expect((await uploadTurn(f.base, token, "call", "after-disconnect")).status).toBe(403);
});

test("pause or End call during next-turn authentication cannot revive a retired turn", async () => {
  const f = fixture(true, undefined, async () => Response.json({}));
  const { token } = await f.signIn("alice"), phone = await f.socket("phone", token), web = await f.socket("web", "alice");
  await approveCall(phone, web, "call");
  listen(phone, "pause", "call", {call_id:"call"});
  await until(() => phone.messages.some(m => m.state === "paused" && m.request_id === "call"));
  const checks = Promise.withResolvers<void>();
  f.holdSessions(checks.promise);
  listen(phone, "next", "paused-next", {call_id:"call"});
  listen(phone, "pause", "paused-next", {call_id:"call"});
  await until(() => phone.messages.some(m => m.state === "paused" && m.request_id === "paused-next"));
  listen(phone, "next", "canceled-next", {call_id:"call"});
  listen(phone, "cancel", "call", {call_id:"call"});
  await until(() => gotListen(web, "cancel", "call"));
  checks.resolve();
  expect((await uploadTurn(f.base, token, "call", "canceled-next")).status).toBe(403);
  expect(phone.messages.filter(m => m.action === "start").map(m => m.request_id)).toEqual(["call"]);
});

test("one-sided continuous opt-in only approves one utterance", async () => {
  const f = fixture(true, undefined, async () => Response.json({status: "ok"}));
  const { token } = await f.signIn("alice"), phone = await f.socket("phone", token), web = await f.socket("web", "alice");
  for (const phoneOptsIn of [false, true]) {
    const id = String(phoneOptsIn);
    listen(phone, "request", id, {continuous: phoneOptsIn});
    await until(() => gotListen(web, "request", id));
    listen(web, "start", id, {continuous: !phoneOptsIn});
    await until(() => gotListen(phone, "start", id));
    expect(phone.messages.find(m => m.action === "start" && m.request_id === id)?.continuous).not.toBe(true);
    const form = new FormData(); form.set("utterance_id", id); form.set("text", "hello");
    expect((await fetch(f.base + "/api/utterance", {method:"POST", headers: {authorization: "Bearer "+token}, body: form})).status).toBe(200);
    listen(phone, "next", "extra-"+id, {call_id:id});
    expect((await uploadTurn(f.base, token, id, "extra-"+id)).status).toBe(403);
  }
});

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
  expect((await f.api("/api/utterance", undefined, {}, linked.token)).status).toBe(503);
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

function drivePoll(base: string, token: string, binding: string) {
  return fetch(base + "/api/mobile/session?device_id=esp12e_carbot", {
    headers: { authorization: "Bearer " + token, "X-IRIS-Drive-Binding": binding },
  });
}

async function drivePair(f: ReturnType<typeof fixture>, id: string) {
  const {token} = await f.signIn(id);
  const web = await f.socket("web", id), phone = await f.socket("phone", token);
  phone.ws.send(JSON.stringify({type: "hello", drive_proof: "hmac-sha256-v1", ts: Date.now()}));
  await until(() => phone.messages.some(m => m.type === "drive_binding"));
  const binding = () => String(phone.messages.filter(m => m.type === "drive_binding").at(-1)!.binding);
  return { id, web, phone, token, binding, poll: () => drivePoll(f.base, token, binding()) };
}

test("shared driving grants exactly one competing pair a private lease and hands off with fresh keys", async () => {
  const f = fixture(true, "*");
  const pairs = [await drivePair(f, "alice"), await drivePair(f, "bob")];
  expect((await drivePoll(f.base, pairs[0]!.token, pairs[1]!.binding())).status).toBe(409);
  // A fresh gateway cannot know whether its predecessor still has a live 10-second grant.
  expect((await pairs[0]!.poll()).status).toBe(409);
  setSystemTime(new Date(Date.now() + 10_001));
  const responses = await Promise.all(pairs.map(p => p.poll()));
  expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
  const won = responses.findIndex(r => r.status === 200);
  const owner = pairs[won]!, waiting = pairs[1-won]!;
  const grant = await responses[won]!.json() as {control_session_id:string; signing_key:string; expires_at_ms:number};
  expect(await responses[1-won]!.json()).not.toHaveProperty("signing_key");
  await until(() => owner.web.messages.some(m => m.type === "drive_grant"));
  expect(owner.web.messages.find(m => m.type === "drive_grant")).toMatchObject(grant);
  expect(waiting.web.messages.some(m => m.type === "drive_grant")).toBe(false);
  const oldBinding = waiting.binding();
  const otherWeb = await f.socket("web", waiting.id);
  await until(() => waiting.binding() !== oldBinding);
  expect((await waiting.poll()).status).toBe(409);
  const renewed = await (await owner.poll()).json() as typeof grant;
  expect(renewed).toMatchObject({control_session_id: grant.control_session_id, signing_key: grant.signing_key});
  expect(owner.phone.messages.some(m => m.type === "session_revoked")).toBe(false);
  owner.web.ws.close();
  await until(() => owner.phone.messages.some(m => m.type === "session_revoked" && m.control_session_id === grant.control_session_id));
  expect((await waiting.poll()).status).toBe(409);
  try {
    setSystemTime(new Date(renewed.expires_at_ms - 100));
    expect((await waiting.poll()).status).toBe(409);
    setSystemTime(new Date(renewed.expires_at_ms + 1));
    const handoff = await waiting.poll();
    expect(handoff.status).toBe(200);
    const fresh = await handoff.json() as typeof grant;
    expect(fresh.control_session_id).not.toBe(grant.control_session_id);
    expect(fresh.signing_key).not.toBe(grant.signing_key);
    await until(() => otherWeb.messages.some(m => m.type === "drive_grant" && m.control_session_id === fresh.control_session_id));
  } finally { setSystemTime(); }
});

test("shared driving rechecks both patient sessions, revokes role loss and allows takeover after expiry", async () => {
  const f = fixture(true, "*");
  const alice = await drivePair(f, "alice"), bob = await drivePair(f, "bob");
  setSystemTime(new Date(Date.now() + 10_001));
  f.sessions.get("alice")!.user.role = "doctor";
  expect((await alice.poll()).status).toBe(403);
  f.sessions.get("alice")!.user.role = "patient";
  f.sessions.get("mobile-alice")!.user.role = null;
  expect((await alice.poll()).status).toBe(403);
  f.sessions.get("mobile-alice")!.user.role = "patient";
  const initial = await alice.poll();
  expect(initial.status).toBe(200);
  const grant = await initial.json() as {control_session_id:string; signing_key:string; expires_at_ms:number};
  const mobileSession = f.sessions.get("mobile-alice")!.session;
  const parentExpiry = mobileSession.expiresAt;
  mobileSession.expiresAt = new Date(Date.now() + 1_000);
  const shortened = await (await alice.poll()).json() as typeof grant;
  expect(shortened.expires_at_ms).toBeLessThan(grant.expires_at_ms);
  mobileSession.expiresAt = parentExpiry;
  f.sessions.get("mobile-alice")!.user.role = "doctor";
  await until(() => alice.web.messages.some(m => m.type === "session_revoked" && m.control_session_id === grant.control_session_id));
  expect((await bob.poll()).status).toBe(409);
  try {
    setSystemTime(new Date(shortened.expires_at_ms + 1));
    expect((await bob.poll()).status).toBe(409);
    setSystemTime(new Date(grant.expires_at_ms + 1));
    const bobGrant = await bob.poll();
    expect(bobGrant.status).toBe(200);
    const held = await bobGrant.json() as typeof grant;
    expect(held.signing_key).not.toBe(grant.signing_key);
    f.sessions.get("mobile-alice")!.user.role = "patient";
    expect((await alice.poll()).status).toBe(409);
    setSystemTime(new Date(held.expires_at_ms + 1));
    const next = await alice.poll();
    expect(next.status).toBe(200);
    const rotated = await next.json() as typeof grant;
    expect(rotated.signing_key).not.toBe(held.signing_key);
    expect(rotated.control_session_id).not.toBe(held.control_session_id);
    expect((await bob.poll()).status).toBe(409);
  } finally { setSystemTime(); }
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
