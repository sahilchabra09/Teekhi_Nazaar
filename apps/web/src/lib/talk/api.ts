/** Client for the server's /api/talk routes (apps/server/src/talk/routes.ts). */

export type UtteranceResult =
  | {
      status: "ok";
      conversationId: string;
      heard: string;
      replies: string[];
      lowConfidence: boolean;
      language: string | null;
      /** "autosage" = grounded in the patient's medical records; "openrouter" = fallback. */
      source: "autosage" | "openrouter";
      timings: { sttMs: number; repliesMs: number; totalMs: number };
      models: { stt: string; replies: string };
    }
  | { status: "no_speech"; conversationId: string; timings: { sttMs: number; totalMs: number } };

export type RepliesResult = {
  conversationId: string;
  heard: string;
  replies: string[];
  lowConfidence: boolean;
  source: "autosage" | "openrouter";
  timings: { repliesMs: number };
};

export class TalkApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function serverUrl(path: string) {
  const base = (process.env.NEXT_PUBLIC_SERVER_URL ?? "").replace(/\/$/, "");
  return `${base}${path}`;
}

async function call<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(serverUrl(path), { ...init, credentials: "include" });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new TalkApiError("NETWORK", "Can’t reach the IRIS server. Is it running?", 0);
  }
  const payload = (await response.json().catch(() => null)) as (T & { error?: string; message?: string }) | null;
  if (!response.ok || !payload) {
    throw new TalkApiError(payload?.error ?? "HTTP_" + response.status, payload?.message ?? "Something went wrong.", response.status);
  }
  return payload;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const talkApi = {
  /**
   * Audio → speech-to-text → three reply suggestions, in one request.
   * Pass the current conversationId to keep every turn in the same conversation (= one AutoSage chat).
   */
  utterance(wav: Blob, conversationId: string | null, signal?: AbortSignal) {
    const form = new FormData();
    form.append("audio", wav, `utterance-${Date.now()}.wav`);
    if (conversationId) form.append("conversationId", conversationId);
    return call<UtteranceResult>("/api/talk/utterance", { method: "POST", body: form, signal });
  },

  /** A fresh set of replies for the last thing heard, avoiding the ones already shown. */
  moreReplies(conversationId: string, signal?: AbortSignal) {
    return call<RepliesResult>("/api/talk/replies", { ...json({ conversationId }), signal });
  },

  /** Tell the server what the patient actually said, so the next replies have context. */
  spoken(conversationId: string, text: string) {
    return call<{ ok: true }>("/api/talk/spoken", json({ conversationId, text }));
  },

  /** The conversation is over: the next utterance starts a new one (and a new AutoSage chat). */
  endConversation(conversationId: string) {
    return call<{ ok: true }>(`/api/talk/conversations/${encodeURIComponent(conversationId)}/end`, json({}));
  },
};
