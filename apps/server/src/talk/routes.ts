import { Hono } from "hono";
import { z } from "zod";

import { autosageConfigured } from "../autosage/client";
import { ENV } from "../env.server";
import { type AuthedEnv, requireRole, requireSession } from "../rbac";
import { isLowConfidence, models, speechToText, TalkError } from "./ai";
import { addShownReplies, addTurn, endConversation, getConversation, lastHeard, openConversation } from "./conversations";
import { generateReplies } from "./replies";
import { hasAudiblePcmWav } from "./audio-quality";

const MAX_AUDIO_BYTES = 5 * 1024 * 1024; // ~2.5 min of 16 kHz WAV; utterances are a few seconds
const MIN_AUDIO_BYTES = 8 * 1024; // < ~0.25 s of 16 kHz WAV: nothing worth sending to STT

export const talkRoutes = new Hono<AuthedEnv>();

// Say something is the patient's feature (docs/care.md §2).
talkRoutes.use("*", requireSession, requireRole("patient"));

talkRoutes.onError((error, c) => {
  if (error instanceof TalkError) return c.json({ error: error.code, message: error.message }, error.status);
  console.error("[talk] unexpected error", error);
  return c.json({ error: "INTERNAL_ERROR", message: "Something went wrong. Try again." }, 500);
});

/**
 * POST /api/talk/utterance   (multipart: audio=<file>, conversationId?=<id>)
 * audio → speech-to-text → reply suggestions, inside one conversation (= one AutoSage chat).
 * Without a conversationId (or with an ended/stale one) a new conversation starts.
 */
talkRoutes.post("/utterance", async (c) => {
  const patient = c.get("user");
  const form = await c.req.parseBody();
  const file = form.audio;

  if (!(file instanceof File)) throw new TalkError(400, "VALIDATION_ERROR", "Send the recording in the 'audio' field.");
  if (file.size > MAX_AUDIO_BYTES) throw new TalkError(413, "AUDIO_TOO_LARGE", "Recording is too long. Keep it under a minute.");
  if (file.type && !file.type.startsWith("audio/")) throw new TalkError(415, "UNSUPPORTED_MEDIA", "Only audio files are accepted.");

  const conversation = await openConversation(patient.id, typeof form.conversationId === "string" ? form.conversationId : null);

  const t0 = performance.now();
  if (file.size < MIN_AUDIO_BYTES) return c.json(noSpeech(conversation.id, t0));

  const audio = new Uint8Array(await file.arrayBuffer());
  if (hasAudiblePcmWav(audio) === false) return c.json(noSpeech(conversation.id, t0));
  const stt = await speechToText(audio, c.req.raw.signal);
  const t1 = performance.now();

  // Silence or a single filler word: don't spend an LLM call, tell the UI nothing was caught.
  if (stt.text.replace(/[^\p{L}\p{N}]+/gu, "").length < 2) return c.json(noSpeech(conversation.id, t0, t1, stt.model));
  // Do not contaminate conversation history or generate answers from unreliable words.
  if (isLowConfidence(stt.confidence)) return c.json(noSpeech(conversation.id, t0, t1, stt.model));

  await addTurn(conversation.id, "heard", stt.text);
  const result = await generateReplies({
    patient,
    conversation: { ...conversation, shownReplies: [] },
    heard: stt.text,
    avoid: [],
    signal: c.req.raw.signal,
  });
  await addShownReplies({ ...conversation, shownReplies: [] }, result.replies);
  const t2 = performance.now();

  return c.json({
    status: "ok" as const,
    conversationId: conversation.id,
    heard: stt.text,
    replies: result.replies,
    lowConfidence: result.unclear || isLowConfidence(stt.confidence),
    language: stt.language ?? null,
    source: result.source,
    timings: { sttMs: Math.round(t1 - t0), repliesMs: Math.round(t2 - t1), totalMs: Math.round(t2 - t0) },
    models: { stt: stt.model, replies: result.model },
  });
});

/**
 * POST /api/talk/transcript { text, conversationId? }
 * Same as /utterance but for text that was already transcribed (the phone's on-device STT fallback,
 * mobile.md M11, or testing without a microphone).
 */
talkRoutes.post("/transcript", async (c) => {
  const patient = c.get("user");
  const body = z
    .object({ text: z.string().trim().min(1).max(1000), confidence: z.number().min(-1).max(1).optional(), conversationId: z.string().min(1).optional() })
    .safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) throw new TalkError(400, "VALIDATION_ERROR", "Send { text, conversationId? }.");

  const conversation = await openConversation(patient.id, body.data.conversationId ?? null);
  const t0 = performance.now();
  if (body.data.confidence !== undefined && body.data.confidence >= 0 && isLowConfidence(body.data.confidence)) return c.json(noSpeech(conversation.id, t0));
  await addTurn(conversation.id, "heard", body.data.text);
  const result = await generateReplies({
    patient,
    conversation: { ...conversation, shownReplies: [] },
    heard: body.data.text,
    avoid: [],
    signal: c.req.raw.signal,
  });
  await addShownReplies({ ...conversation, shownReplies: [] }, result.replies);

  return c.json({
    status: "ok" as const,
    conversationId: conversation.id,
    heard: body.data.text,
    replies: result.replies,
    lowConfidence: result.unclear,
    source: result.source,
    timings: { sttMs: 0, repliesMs: Math.round(performance.now() - t0), totalMs: Math.round(performance.now() - t0) },
    models: { stt: null, replies: result.model },
  });
});

/** POST /api/talk/replies { conversationId } → a fresh set for the last thing heard, avoiding earlier ones. */
talkRoutes.post("/replies", async (c) => {
  const patient = c.get("user");
  const body = z.object({ conversationId: z.string().min(1) }).safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) throw new TalkError(400, "VALIDATION_ERROR", "Send the conversationId.");

  const conversation = await getConversation(patient.id, body.data.conversationId);
  if (!conversation || conversation.endedAt) throw new TalkError(400, "CONVERSATION_ENDED", "That conversation has ended. Listen again.");
  const heard = await lastHeard(conversation.id);
  if (!heard) throw new TalkError(400, "NOTHING_HEARD", "There's nothing to reply to yet.");

  const t0 = performance.now();
  const result = await generateReplies({
    patient,
    conversation,
    heard,
    avoid: conversation.shownReplies.flat(),
    signal: c.req.raw.signal,
  });
  await addShownReplies(conversation, result.replies);

  return c.json({
    conversationId: conversation.id,
    heard,
    replies: result.replies,
    lowConfidence: result.unclear,
    source: result.source,
    timings: { repliesMs: Math.round(performance.now() - t0) },
    models: { replies: result.model },
  });
});

/** POST /api/talk/spoken { conversationId, text } → what the patient said; joins the conversation's chat. */
talkRoutes.post("/spoken", async (c) => {
  const patient = c.get("user");
  const body = z
    .object({ conversationId: z.string().min(1), text: z.string().trim().min(1).max(500) })
    .safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) throw new TalkError(400, "VALIDATION_ERROR", "Send { conversationId, text }.");

  const conversation = await getConversation(patient.id, body.data.conversationId);
  if (!conversation) throw new TalkError(400, "VALIDATION_ERROR", "Unknown conversation.");
  await addTurn(conversation.id, "spoken", body.data.text);
  return c.json({ ok: true });
});

/** POST /api/talk/conversations/:id/end → conversation is over; the next utterance starts a new chat. */
talkRoutes.post("/conversations/:id/end", async (c) => {
  await endConversation(c.get("user").id, c.req.param("id"));
  return c.json({ ok: true });
});

/** GET /api/talk/status → what's configured (handy for the UI and debugging). */
talkRoutes.get("/status", (c) =>
  c.json({
    ready: Boolean(ENV.OPENROUTER_API_KEY?.trim()),
    autosage: autosageConfigured(),
    models: { stt: models.stt, replies: autosageConfigured() ? ["autosage fast-query", models.reply] : [models.reply, models.replyFallback] },
  }),
);

function noSpeech(conversationId: string, t0: number, t1 = performance.now(), sttModel?: string) {
  return {
    status: "no_speech" as const,
    conversationId,
    timings: { sttMs: Math.round(t1 - t0), totalMs: Math.round(performance.now() - t0) },
    models: { stt: sttModel ?? null },
  };
}
