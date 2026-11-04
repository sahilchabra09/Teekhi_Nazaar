import { DeepgramLive, type DeepgramConfig } from "../talk/deepgram";
import type { Message, Peer, Role } from "./gateway";
import type { Identity, Pairing } from "./pairing";

export interface SpeechOptions {
  speech?: DeepgramConfig;
  connectSpeech?: (url: string, key: string) => WebSocket;
  talkHandler?: (request: Request) => Promise<Response>;
  authBaseUrl: string;
}

export interface SpeechTurn {
  id: string;
  phone: Peer;
  web: Peer;
  phase: "validating" | "pending" | "approved" | "processing";
  expires: number;
  timer?: ReturnType<typeof setTimeout>;
  abort: AbortController;
  conversationId?: string;
  stream?: Peer;
  started?: boolean;
  stopped?: boolean;
  live?: DeepgramLive;
}

const denied = () => Response.json({ error: "A current patient approval is required" }, { status: 403 });
const listen = (action: string, id: string) => ({ type: "listen", action, request_id: id, ts: Date.now() });
const validId = (id: unknown): id is string => typeof id === "string" && id.length <= 128 && id.trim().length > 0;

/** Each grant belongs to two exact control sockets and permits one input and one result. */
export function createPhoneSpeech(
  options: SpeechOptions, pairing: Pairing,
  roomFor: (peer: Peer) => Map<Role, Peer> | undefined,
  send: (peer: Peer | undefined, message: Message) => boolean,
) {
  const turns = new Map<string, SpeechTurn>();
  // IDs stay retired for this bearer across reconnects. Bound memory and fail closed at capacity.
  const seen = new WeakMap<Identity, Set<string>>();
  const account = (peer: Peer) => peer.data.identity.account.user.id;

  function finish(turn: SpeechTurn, canceled = false) {
    if (turns.get(account(turn.phone)) !== turn) return;
    turns.delete(account(turn.phone));
    clearTimeout(turn.timer);
    turn.abort.abort();
    turn.live?.close();
    if (canceled) {
      const message = listen("cancel", turn.id);
      send(turn.phone, message);
      send(turn.web, message);
      send(turn.stream, message);
    }
    turn.stream?.close(1000, "Utterance ended");
  }

  function deadline(turn: SpeechTurn, ms: number) {
    clearTimeout(turn.timer);
    turn.expires = Math.min(Date.now() + ms, turn.web.data.identity.expires, turn.phone.data.identity.expires);
    turn.timer = setTimeout(() => finish(turn, true), Math.max(0, turn.expires - Date.now()));
  }

  function current(turn: SpeechTurn) {
    if (turns.get(account(turn.phone)) !== turn) return false;
    const room = roomFor(turn.phone);
    if (Date.now() < turn.expires && room?.get("phone") === turn.phone && room.get("web") === turn.web &&
        turn.phone.readyState === 1 && turn.web.readyState === 1 &&
        pairing.current(turn.phone.data.identity) && pairing.current(turn.web.data.identity)) return true;
    finish(turn, true);
    return false;
  }

  async function authorized(turn: SpeechTurn) {
    if (!current(turn)) return false;
    try {
      const [phone, patient] = await Promise.all([pairing.valid(turn.phone.data.identity), pairing.session(turn.web.data.identity)]);
      if (phone && patient?.user.role === "patient" && current(turn)) return true;
    } catch { /* Session verification must succeed before forwarding any speech. */ }
    finish(turn, true);
    return false;
  }

  function state(turn: SpeechTurn, value: string) {
    const message = { type: "speech_state", state: value, request_id: turn.id, ts: Date.now() };
    send(turn.web, message);
    send(turn.phone, message);
    send(turn.stream, message);
  }

  function end(turn: SpeechTurn, value: string) {
    if (!current(turn)) return;
    state(turn, value);
    finish(turn);
  }

  async function control(peer: Peer, message: Message) {
    const id = message.request_id;
    if (!validId(id)) return;
    const key = account(peer);
    const existing = turns.get(key);
    const turn = existing && current(existing) ? existing : undefined;
    if (peer.data.role === "phone" && message.action === "request") {
      if (turn?.id === id && turn.phone === peer) return; // duplicate while live
      const web = roomFor(peer)?.get("web");
      if (!web || turn) { send(peer, listen("cancel", id)); return; }
      const identities = [peer.data.identity, web.data.identity];
      const histories = identities.map(identity => seen.get(identity) ?? new Set<string>());
      if (histories.some(ids => ids.has(id) || ids.size >= 16_384)) { send(peer, listen("cancel", id)); return; }
      identities.forEach((identity, i) => seen.set(identity, histories[i]!.add(id)));
      const pending: SpeechTurn = { id, phone: peer, web, phase: "validating", abort: new AbortController(), expires: 0 };
      turns.set(key, pending);
      deadline(pending, 60_000);
      if (await authorized(pending) && current(pending)) {
        pending.phase = "pending";
        if (!send(web, { ...listen("request", id), expires_at_ms: pending.expires })) finish(pending, true);
      }
      return;
    }
    if (!turn || turn.id !== id || (peer !== turn.web && peer !== turn.phone)) {
      if (message.action === "start") send(peer, listen("cancel", id));
      return;
    }
    if (message.action === "cancel") return finish(turn, true);
    if (peer === turn.web && message.action === "start" && turn.phase === "pending") {
      if (!await authorized(turn) || !current(turn) || turn.phase !== "pending") return;
      turn.phase = "approved";
      turn.conversationId = typeof message.conversationId === "string" && message.conversationId ? message.conversationId : undefined;
      deadline(turn, 100_000);
      if (!send(turn.phone, { ...listen("start", id), expires_at_ms: turn.expires })) finish(turn, true);
    } else if (message.action === "stop" && turn.phase === "approved") {
      if (!send(peer === turn.phone ? turn.web : turn.phone, listen("stop", id))) return finish(turn, true);
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
      const headers = new Headers(turn.web.data.identity.headers);
      if (typeof body === "string") headers.set("Content-Type", "application/json");
      if (!options.talkHandler) throw new Error("Speech service unavailable");
      const response = await options.talkHandler(new Request(new URL(path, options.authBaseUrl).toString(), {
        method: "POST", headers, body, signal: signal ? AbortSignal.any([signal, turn.abort.signal]) : turn.abort.signal,
      }));
      const result = await response.json() as Record<string, unknown>;
      if (!await authorized(turn) || !current(turn)) return denied();
      if (turn.stream && result.models && typeof result.models === "object") result.models = { ...result.models, stt: options.speech?.sttModel };
      if (!send(turn.web, { type: "talk_result", request_id: turn.id, result, ok: response.ok, ts: Date.now() })) {
        finish(turn, true); return denied();
      }
      end(turn, !response.ok ? "failed" : result.status === "no_speech" ? "no_speech" : "ready");
      return new Response(null, { status: response.status });
    } catch {
      if (!current(turn)) return denied();
      end(turn, "failed");
      return Response.json({ error: "Speech processing failed. Please try again." }, { status: 502 });
    }
  }

  function approved(identity: Identity) {
    const turn = turns.get(identity.account.user.id);
    return turn && turn.phone.data.identity === identity && current(turn) && turn.phase === "approved" ? turn : undefined;
  }

  async function upload(identity: Identity, request: Request) {
    const turn = approved(identity);
    if (!turn || turn.stream) return denied();
    let form;
    try { form = await request.formData(); } catch { return Response.json({ error: "Invalid speech upload" }, { status: 400 }); }
    if (form.get("utterance_id") !== turn.id || turn.stream) return denied();
    const text = form.get("text");
    if (typeof text === "string") {
      return process(turn, "/api/talk/transcript", JSON.stringify({ text, confidence: Number(form.get("confidence") ?? -1), conversationId: turn.conversationId }), request.signal);
    }
    form.delete("conversationId");
    if (turn.conversationId) form.set("conversationId", turn.conversationId);
    return process(turn, "/api/talk/utterance", form as RequestInit["body"], request.signal);
  }

  function streamMessage(turn: SpeechTurn, peer: Peer, raw: string | Buffer) {
    if (turn.stream !== peer || !current(turn) || turn.phase !== "approved") return;
    if (typeof raw === "string") {
      let command;
      try { command = JSON.parse(raw); } catch { finish(turn, true); return; }
      if (command?.request_id !== turn.id) return;
      if (command.action === "cancel" || command.action === "pause") return finish(turn, true);
      if (command.action === "start" && !turn.stopped) turn.started = true;
      if (command.action === "stop") stop(turn);
      return;
    }
    if (!turn.started || turn.stopped || !options.speech) return;
    if (!raw.length || raw.length > 8192 || raw.length % 2) return finish(turn, true);
    try {
      turn.live ??= new DeepgramLive(options.speech, {
        activity: () => { if (current(turn)) state(turn, "listening"); },
        error: () => end(turn, "failed"),
        final: (text, confidence) => {
          if (!current(turn)) return;
          if (!text || confidence < .55) return end(turn, "no_speech");
          void process(turn, "/api/talk/transcript", JSON.stringify({ text, confidence, conversationId: turn.conversationId }));
        },
      }, options.connectSpeech);
      turn.live.audio(raw);
    } catch { end(turn, "failed"); }
  }

  function phoneState(peer: Peer, message: Message) {
    const turn = turns.get(account(peer));
    if (!turn || turn.phone !== peer || turn.phase !== "approved" || !current(turn) || message.request_id !== turn.id) return;
    if (message.state === "no_speech" || message.state === "failed") end(turn, message.state);
    else if (message.state === "listening" || message.state === "processing") state(turn, message.state);
  }

  return {
    control, upload, streamMessage, phoneState,
    async authorizeStream(identity: Identity) {
      const turn = approved(identity);
      return turn && await authorized(turn) && current(turn) && turn.phase === "approved" ? turn : undefined;
    },
    checkRole(peer: Peer, role?: string | null) {
      const turn = turns.get(account(peer));
      if (turn?.web === peer && role !== "patient") finish(turn, true);
    },
    openStream(turn: SpeechTurn, peer: Peer) {
      if (!current(turn) || turn.phase !== "approved" || turn.stream) {
        if (turn.stream && current(turn)) finish(turn, true);
        peer.close(1008, "Speech approval unavailable");
        return;
      }
      turn.stream = peer;
      if (turn.stopped) end(turn, "no_speech");
    },
    disconnect(peer: Peer) {
      const turn = turns.get(account(peer));
      if (turn && (turn.phone === peer || turn.web === peer || turn.stream === peer)) finish(turn, true);
    },
  };
}
