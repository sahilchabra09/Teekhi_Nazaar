import { DeepgramLive, type DeepgramConfig } from "../talk/deepgram";
import type { Message, Peer, Role } from "./gateway";
import type { Identity, Pairing } from "./pairing";

export interface SpeechOptions {
  speech?: DeepgramConfig;
  connectSpeech?: (url: string, key: string) => WebSocket;
  talkHandler?: (request: Request) => Promise<Response>;
  authBaseUrl: string;
}

interface SpeechCall {
  id: string;
  phone: Peer;
  web: Peer;
  requestedContinuous: boolean;
  continuous: boolean;
  expires: number;
  timer?: ReturnType<typeof setTimeout>;
  conversationId?: string;
  turn?: SpeechTurn;
  utteranceIds: Set<string>;
}

export interface SpeechTurn {
  call: SpeechCall;
  id: string;
  phase: "validating" | "pending" | "approved" | "processing";
  abort: AbortController;
  stream?: Peer;
  started?: boolean;
  stopped?: boolean;
  live?: DeepgramLive;
}

const denied = () => Response.json({ error: "A current patient approval is required" }, { status: 403 });
const listen = (action: string, id: string) => ({ type: "listen", action, request_id: id, ts: Date.now() });
const validId = (id: unknown): id is string => typeof id === "string" && id.length <= 128 && id.trim().length > 0;

/** Bind the patient’s decision to the control sockets, and each input and result to one turn. */
export function createPhoneSpeech(
  options: SpeechOptions, pairing: Pairing,
  roomFor: (peer: Peer) => Map<Role, Peer> | undefined,
  send: (peer: Peer | undefined, message: Message) => boolean,
) {
  const calls = new Map<string, SpeechCall>();
  // Retire initial grant IDs across reconnects. Continuation IDs are scoped by their parent call ID.
  const seen = new WeakMap<Identity, Set<string>>();
  const account = (peer: Peer) => peer.data.identity.account.user.id;
  const scope = (call: SpeechCall) => call.continuous ? { call_id: call.id, continuous: true } : {};
  const matches = (call: SpeechCall, id: unknown) => call.continuous ? id === call.id : id == null;

  function reserve(phone: Peer, web: Peer, id: string) {
    const identities = [phone.data.identity, web.data.identity];
    const histories = identities.map(identity => seen.get(identity) ?? new Set<string>());
    if (histories.some(ids => ids.has(id) || ids.size >= 16_384)) return false;
    identities.forEach((identity, i) => seen.set(identity, histories[i]!.add(id)));
    return true;
  }

  function beginTurn(call: SpeechCall, id: string): SpeechTurn {
    const turn: SpeechTurn = { id, call, phase: "validating", abort: new AbortController() };
    call.turn = turn;
    return turn;
  }

  function discard(turn: SpeechTurn) {
    if (turn.call.turn !== turn) return;
    turn.call.turn = undefined;
    turn.abort.abort();
    turn.live?.close();
    turn.stream?.close(1000, "Utterance ended");
  }

  function finish(call: SpeechCall, canceled = true) {
    if (calls.get(account(call.phone)) !== call) return;
    calls.delete(account(call.phone));
    clearTimeout(call.timer);
    if (canceled) {
      const message = { ...listen("cancel", call.id), ...scope(call) };
      send(call.phone, message);
      send(call.web, message);
      send(call.turn?.stream, message);
    }
    if (call.turn) discard(call.turn);
  }

  function deadline(call: SpeechCall, ms?: number) {
    clearTimeout(call.timer);
    call.expires = Math.min(call.web.data.identity.expires, call.phone.data.identity.expires, ms === undefined ? Infinity : Date.now() + ms);
    // Periodic session checks revoke continuous calls. A valid connected call has no recording timer.
    if (ms !== undefined) call.timer = setTimeout(() => finish(call), Math.max(0, call.expires - Date.now()));
  }

  function currentCall(call: SpeechCall) {
    if (calls.get(account(call.phone)) !== call) return false;
    const room = roomFor(call.phone);
    if (Date.now() < call.expires && room?.get("phone") === call.phone && room.get("web") === call.web &&
        call.phone.readyState === 1 && call.web.readyState === 1 &&
        pairing.current(call.phone.data.identity) && pairing.current(call.web.data.identity)) return true;
    finish(call);
    return false;
  }

  const current = (turn: SpeechTurn) => currentCall(turn.call) && turn.call.turn === turn;

  async function authorized(turn: SpeechTurn) {
    if (!current(turn)) return false;
    const { call } = turn;
    try {
      const [phone, patient] = await Promise.all([pairing.valid(call.phone.data.identity), pairing.session(call.web.data.identity)]);
      if (phone && patient?.user.role === "patient") return current(turn);
    } catch { /* Session verification must succeed before forwarding any speech. */ }
    finish(call);
    return false;
  }

  function state(turn: SpeechTurn, value: string) {
    const message = { type: "speech_state", state: value, ...scope(turn.call), request_id: turn.id, ts: Date.now() };
    send(turn.call.web, message);
    send(turn.call.phone, message);
    send(turn.stream, message);
  }

  function end(turn: SpeechTurn, value: string) {
    if (!current(turn)) return;
    state(turn, value);
    if (turn.call.continuous) discard(turn);
    else finish(turn.call, false);
  }

  function start(turn: SpeechTurn) {
    const call = turn.call;
    turn.phase = "approved";
    const message = { ...listen("start", turn.id), ...scope(call), ...(!call.continuous && { expires_at_ms: call.expires }) };
    // The dashboard must know the turn ID before any result can arrive.
    if ((call.continuous && !send(call.web, message)) || !send(call.phone, message)) finish(call);
  }

  async function requestCall(peer: Peer, call: SpeechCall | undefined, id: string, continuous: boolean) {
    if (call?.id === id && call.phone === peer) return;
    const web = roomFor(peer)?.get("web");
    if (!web || call || !reserve(peer, web, id)) { send(peer, listen("cancel", id)); return; }
    const pending: SpeechCall = {
      id, phone: peer, web, requestedContinuous: continuous, continuous: false, expires: 0, utteranceIds: new Set([id]),
    };
    calls.set(account(peer), pending);
    const turn = beginTurn(pending, id);
    deadline(pending, 60_000);
    if (await authorized(turn) && current(turn)) {
      turn.phase = "pending";
      if (!send(web, { ...listen("request", id), continuous: pending.requestedContinuous, expires_at_ms: pending.expires })) finish(pending);
    }
  }

  async function nextTurn(peer: Peer, call: SpeechCall | undefined, id: string, callId: unknown) {
    if (!validId(callId)) return;
    if (!call?.continuous || call.id !== callId || peer !== call.phone) {
      send(peer, { ...listen("cancel", callId), call_id: callId }); return;
    }
    if (call.turn) {
      // Idempotent retry after a lost start. Never restart capture or accept overlapping IDs.
      if (call.turn.id === id && call.turn.phase === "approved") {
        if (!send(peer, { ...listen("start", id), ...scope(call) })) finish(call);
      }
      return;
    }
    if (call.utteranceIds.has(id)) return;
    call.utteranceIds.add(id);
    const next = beginTurn(call, id);
    if (await authorized(next) && current(next)) start(next);
  }

  async function control(peer: Peer, message: Message) {
    const id = message.request_id;
    if (!validId(id)) return;
    const existing = calls.get(account(peer));
    const call = existing && currentCall(existing) ? existing : undefined;
    if (peer.data.role === "phone") {
      if (message.action === "request") return requestCall(peer, call, id, message.continuous === true);
      if (message.action === "next") return nextTurn(peer, call, id, message.call_id);
    }
    if (!call || (peer !== call.web && peer !== call.phone)) {
      if (message.action === "start") send(peer, listen("cancel", id));
      return;
    }
    if (message.action === "cancel" && id === call.id && (message.call_id == null || message.call_id === call.id)) return finish(call);
    const turn = call.turn;
    if (!turn || id !== turn.id) return;
    if (peer === call.web && message.action === "start" && turn.phase === "pending") {
      if (message.call_id != null && message.call_id !== call.id) return;
      if (!await authorized(turn) || !current(turn) || turn.phase !== "pending") return;
      call.continuous = call.requestedContinuous && message.continuous === true;
      call.conversationId = typeof message.conversationId === "string" && message.conversationId ? message.conversationId : undefined;
      deadline(call, call.continuous ? undefined : 100_000);
      start(turn);
      return;
    }
    if (!matches(call, message.call_id)) return;
    if (call.continuous && peer === call.phone && message.action === "pause") end(turn, "paused");
    if (message.action === "stop" && turn.phase === "approved") {
      if (!send(peer === call.phone ? call.web : call.phone, { ...listen("stop", id), ...scope(call) })) return finish(call);
      stop(turn);
    }
  }

  function stop(turn: SpeechTurn) {
    if (turn.stopped) return;
    turn.stopped = true;
    if (turn.live) turn.live.finalize();
    else if (turn.stream) end(turn, "no_speech");
    // On-device recognizers deliver the final transcript by HTTP after stop.
  }

  async function process(turn: SpeechTurn, path: string, body: RequestInit["body"], signal?: AbortSignal) {
    if (turn.phase !== "approved" || !current(turn)) return denied();
    turn.phase = "processing"; // Reserve before awaiting so overlapping submissions cannot both win.
    try {
      if (!await authorized(turn) || !current(turn)) return denied();
      state(turn, "processing");
      const headers = new Headers(turn.call.web.data.identity.headers);
      if (typeof body === "string") headers.set("Content-Type", "application/json");
      if (!options.talkHandler) throw new Error("Speech service unavailable");
      const response = await options.talkHandler(new Request(new URL(path, options.authBaseUrl).toString(), {
        method: "POST", headers, body, signal: signal ? AbortSignal.any([signal, turn.abort.signal]) : turn.abort.signal,
      }));
      const result = await response.json() as Record<string, unknown>;
      if (!await authorized(turn) || !current(turn)) return denied();
      if (turn.stream && result.models && typeof result.models === "object") result.models = { ...result.models, stt: options.speech?.sttModel };
      if (!send(turn.call.web, { type: "talk_result", ...scope(turn.call), request_id: turn.id, result, ok: response.ok, ts: Date.now() })) {
        finish(turn.call); return denied();
      }
      if (response.ok && typeof result.conversationId === "string") turn.call.conversationId = result.conversationId;
      end(turn, !response.ok ? "failed" : result.status === "no_speech" ? "no_speech" : "ready");
      return new Response(null, { status: response.status });
    } catch {
      if (!current(turn)) return denied();
      end(turn, "failed");
      return Response.json({ error: "Speech processing failed. Please try again." }, { status: 502 });
    }
  }

  function approved(identity: Identity) {
    const turn = calls.get(identity.account.user.id)?.turn;
    return turn && turn.call.phone.data.identity === identity && current(turn) && turn.phase === "approved" ? turn : undefined;
  }

  async function upload(identity: Identity, request: Request) {
    const turn = approved(identity);
    if (!turn || turn.stream) return denied();
    let form;
    try { form = await request.formData(); } catch { return Response.json({ error: "Invalid speech upload" }, { status: 400 }); }
    if (form.get("utterance_id") !== turn.id || !matches(turn.call, form.get("call_id")) || turn.stream) return denied();
    const text = form.get("text");
    if (typeof text === "string") {
      return process(turn, "/api/talk/transcript", JSON.stringify({ text, confidence: Number(form.get("confidence") ?? -1), conversationId: turn.call.conversationId }), request.signal);
    }
    form.delete("conversationId");
    if (turn.call.conversationId) form.set("conversationId", turn.call.conversationId);
    return process(turn, "/api/talk/utterance", form as RequestInit["body"], request.signal);
  }

  function streamMessage(turn: SpeechTurn, peer: Peer, raw: string | Buffer) {
    if (turn.stream !== peer || !current(turn) || turn.phase !== "approved") return;
    if (typeof raw === "string") {
      let command;
      try { command = JSON.parse(raw); } catch { end(turn, "failed"); return; }
      if (command?.request_id !== turn.id || !matches(turn.call, command.call_id)) return;
      if (command.action === "cancel" || command.action === "pause") return turn.call.continuous ? end(turn, "paused") : finish(turn.call);
      if (command.action === "start" && !turn.stopped) turn.started = true;
      if (command.action === "stop") stop(turn);
      return;
    }
    if (!turn.started || turn.stopped || !options.speech) return;
    if (!raw.length || raw.length > 8192 || raw.length % 2) return end(turn, "failed");
    try {
      turn.live ??= new DeepgramLive(options.speech, {
        activity: () => { if (current(turn)) state(turn, "listening"); },
        error: () => end(turn, "failed"),
        final: (text, confidence) => {
          if (!current(turn)) return;
          if (!text || confidence < .55) return end(turn, "no_speech");
          void process(turn, "/api/talk/transcript", JSON.stringify({ text, confidence, conversationId: turn.call.conversationId }));
        },
      }, options.connectSpeech);
      turn.live.audio(raw);
    } catch { end(turn, "failed"); }
  }

  function phoneState(peer: Peer, message: Message) {
    const turn = calls.get(account(peer))?.turn;
    if (!turn || turn.call.phone !== peer || !matches(turn.call, message.call_id) || turn.phase !== "approved" || !current(turn) || message.request_id !== turn.id) return;
    if (message.state === "no_speech" || message.state === "failed") end(turn, message.state);
    else if (message.state === "listening" || message.state === "processing") state(turn, message.state);
  }

  return {
    control, upload, streamMessage, phoneState,
    async authorizeStream(identity: Identity, query: URLSearchParams) {
      const turn = approved(identity);
      if (!turn || !matches(turn.call, query.get("call_id"))) return;
      if (turn.call.continuous && query.get("request_id") !== turn.id) return;
      return await authorized(turn) && current(turn) && turn.phase === "approved" ? turn : undefined;
    },
    checkRole(peer: Peer, role?: string | null) {
      const call = calls.get(account(peer));
      if (call?.web === peer && role !== "patient") finish(call);
    },
    openStream(turn: SpeechTurn, peer: Peer) {
      if (!current(turn) || turn.phase !== "approved" || turn.stream) {
        if (!turn.call.continuous && turn.stream && current(turn)) finish(turn.call);
        peer.close(1008, "Speech approval unavailable");
        return;
      }
      turn.stream = peer;
      if (turn.stopped) end(turn, "no_speech");
    },
    disconnect(peer: Peer) {
      const call = calls.get(account(peer));
      if (!call) return;
      if (call.phone === peer || call.web === peer) finish(call);
      else if (call.turn?.stream === peer) {
        if (call.continuous) end(call.turn, "failed");
        else finish(call);
      }
    },
  };
}
