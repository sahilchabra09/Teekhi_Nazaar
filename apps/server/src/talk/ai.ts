import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, Output, transcribe } from "ai";
import { z } from "zod";

import { ENV } from "../env.server";
import type { Turn } from "./conversations";
import { openRouterTranscription } from "./openrouter-transcription";

const APP_NAME = "IRIS";

export class TalkError extends Error {
  constructor(
    readonly status: 400 | 413 | 415 | 502 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function apiKey() {
  const key = ENV.OPENROUTER_API_KEY?.trim();
  if (!key) throw new TalkError(503, "AI_NOT_CONFIGURED", "OPENROUTER_API_KEY is not set on the server.");
  return key;
}

export const models = {
  stt: [ENV.OPENROUTER_STT_MODEL, ENV.OPENROUTER_STT_FALLBACK_MODEL].filter(Boolean),
  reply: ENV.OPENROUTER_REPLY_MODEL,
  replyFallback: ENV.OPENROUTER_REPLY_FALLBACK_MODEL,
};

// ───────────────────────────── speech → text ─────────────────────────────

/** Below this provider confidence (0–1) we ask the user to repeat instead of trusting the text. */
const LOW_CONFIDENCE = 0.55;

export async function speechToText(audio: Uint8Array, signal?: AbortSignal) {
  const key = apiKey();
  let lastError: unknown;

  // Primary model first, fallback model second (OpenRouter routing prefs don't apply to STT).
  for (const modelId of models.stt) {
    try {
      const result = await transcribe({
        model: openRouterTranscription(modelId, { apiKey: key, appName: APP_NAME }),
        audio, // transcribe() sniffs the format (wav, webm, mp3, m4a…) from the bytes
        abortSignal: signal,
        maxRetries: 0,
      });
      const meta = result.providerMetadata?.openrouter as { confidence?: number | null } | undefined;
      return {
        text: result.text.trim(),
        language: result.language,
        durationSeconds: result.durationInSeconds,
        confidence: typeof meta?.confidence === "number" ? meta.confidence : null,
        model: modelId,
      };
    } catch (error) {
      lastError = error;
      console.warn(`[talk] STT failed on ${modelId}:`, error instanceof Error ? error.message : error);
    }
  }

  throw new TalkError(502, "STT_FAILED", lastError instanceof Error ? lastError.message : "Transcription failed.");
}

export const isLowConfidence = (confidence: number | null) => confidence !== null && confidence < LOW_CONFIDENCE;

// ───────────────────────────── text → replies ─────────────────────────────

const REPLY_COUNT = 3;

const replySchema = z.object({
  replies: z
    .array(z.string().min(1).max(120))
    .length(REPLY_COUNT)
    .describe("Exactly three different first-person replies the patient could say out loud."),
  unclear: z
    .boolean()
    .describe("True when the heard text is garbled, cut off, or too ambiguous to answer confidently."),
});

const SYSTEM = `You write reply options for IRIS, a telepresence robot used by a person with severe motor impairment.
The person cannot speak or type. Someone near the robot just said something; the person will pick ONE of your options with their eyes and the robot will say it out loud for them.

Write exactly ${REPLY_COUNT} replies:
- First person, as the patient speaking. Natural spoken language, not text-message style.
- Short: at most 12 words each, so they are quick to read and say.
- Clearly different from each other. When it fits, cover: one yes/positive, one no/negative, one that asks a question or buys time.
- Directly answer what was said. Use the recent conversation to resolve "it", "that", names, etc.
- Reply in the same language the other person used.
- These are options, not facts: never claim medical facts, diagnoses, or medication details.
- No emojis, no quotation marks, no numbering.

People come and go near the robot and IRIS cannot tell voices apart: the latest line may be from a different person than the recent conversation. If it could be a greeting or a fresh start, reply to it on its own and don't bring up earlier topics.

If what was heard is garbled, cut off, background noise, or makes no sense, set "unclear" to true and make the replies polite ways to ask them to repeat or clarify.`;

function formatTurns(turns: Turn[]) {
  if (turns.length === 0) return "(this is the start of the conversation)";
  return turns.map((t) => `${t.role === "heard" ? "Other person" : "Patient (via IRIS)"}: ${t.text}`).join("\n");
}

export async function suggestReplies({
  heard,
  history,
  avoid,
  signal,
}: {
  heard: string;
  history: Turn[];
  avoid: string[];
  signal?: AbortSignal;
}) {
  const openrouter = createOpenRouter({ apiKey: apiKey(), headers: { "X-Title": APP_NAME } });

  const prompt = [
    `Recent conversation (oldest first):\n${formatTurns(history)}`,
    `The other person just said:\n"""${heard}"""`,
    avoid.length ? `Already offered — write different ones:\n${avoid.map((a) => `- ${a}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const { output, response } = await generateText({
      // OpenRouter tries the fallback model automatically if the primary is down or rate-limited.
      model: openrouter.chat(models.reply, {
        models: [models.replyFallback],
        // Both flash models (GLM-5.3 / DeepSeek V4) are hybrid reasoners; thinking would add seconds for 3 short lines.
        reasoning: { enabled: false, effort: "none", exclude: true },
        usage: { include: true },
      }),
      system: SYSTEM,
      prompt,
      output: Output.object({ schema: replySchema }),
      temperature: avoid.length ? 0.9 : 0.6,
      maxOutputTokens: 300,
      maxRetries: 1,
      abortSignal: signal,
    });

    const replies = dedupe(output.replies.map(clean)).slice(0, REPLY_COUNT);
    if (replies.length < REPLY_COUNT) throw new Error("Model returned duplicate replies.");
    return { replies, unclear: output.unclear, model: response.modelId };
  } catch (error) {
    if (error instanceof TalkError) throw error;
    console.warn("[talk] reply generation failed:", error instanceof Error ? error.message : error);
    throw new TalkError(502, "REPLIES_FAILED", "Couldn't generate replies right now.");
  }
}

const clean = (s: string) => s.trim().replace(/^["“'\-\d.)\s]+|["”']+$/g, "").trim();
const dedupe = (list: string[]) => [...new Map(list.filter(Boolean).map((s) => [s.toLowerCase(), s])).values()];
