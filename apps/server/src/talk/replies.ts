import { autosage, autosageConfigured } from "../autosage/client";
import { patientKbId, replyModel, tenantId } from "../autosage/provision";
import { suggestReplies } from "./ai";
import { type Conversation, markSent, recentTurns, setAutosageChat, unsentSpoken } from "./conversations";

const REPLY_COUNT = 3;

export type ReplySet = { replies: string[]; unclear: boolean; source: "autosage" | "openrouter"; model: string };

/**
 * Reply suggestions for what was just heard.
 *
 * Primary: AutoSage fast-query on the PATIENT'S knowledge base, inside the conversation's AutoSage
 * chat, so answers can use their medical records ("what did your last report say?") and every
 * message of the conversation stays in one chat.
 * Fallback: OpenRouter (docs/talk.md) when AutoSage isn't configured or doesn't answer, so the
 * patient is never left without replies.
 */
export async function generateReplies(input: {
  patient: { id: string; name: string };
  conversation: Conversation;
  heard: string;
  avoid: string[];
  signal?: AbortSignal;
}): Promise<ReplySet> {
  if (autosageConfigured()) {
    try {
      return await autosageReplies(input);
    } catch (error) {
      console.warn("[talk] AutoSage replies failed, falling back to OpenRouter:", error instanceof Error ? error.message : error);
    }
  }

  // History without the "heard" turn we're answering (it's passed separately).
  const history = (await recentTurns(input.conversation.id)).slice(0, -1);
  const r = await suggestReplies({ heard: input.heard, history, avoid: input.avoid, signal: input.signal });
  return { ...r, source: "openrouter" };
}

async function autosageReplies({
  patient,
  conversation,
  heard,
  avoid,
  signal,
}: {
  patient: { id: string; name: string };
  conversation: Conversation;
  heard: string;
  avoid: string[];
  signal?: AbortSignal;
}): Promise<ReplySet> {
  const [kbId, model] = await Promise.all([patientKbId(patient), replyModel()]);

  // One AutoSage chat per conversation, created on its first query (chat id = our conversation id).
  let chatId = conversation.autosageChatId;
  if (!chatId) {
    chatId = await autosage.createChat({
      id: conversation.id,
      tenantId: await tenantId(),
      kbId,
      model,
      subjectId: patient.id,
      title: `Conversation ${conversation.startedAt.toISOString().slice(0, 16).replace("T", " ")}`,
    });
    await setAutosageChat(conversation.id, chatId);
  }

  // What the patient said since the last query rides along, so the chat holds the whole exchange.
  const spoken = await unsentSpoken(conversation.id);

  const { text } = await autosage.fastQuery({
    kbId,
    model,
    chatId,
    subjectId: patient.id,
    content: buildPrompt({ patientName: patient.name, heard, spoken: spoken.map((s) => s.text), avoid }),
    signal,
  });

  const parsed = parseReplies(text);
  await markSent(spoken.map((s) => s.id));
  return { ...parsed, source: "autosage", model };
}

function buildPrompt({ patientName, heard, spoken, avoid }: { patientName: string; heard: string; spoken: string[]; avoid: string[] }) {
  return [
    `[IRIS reply request for ${patientName}]`,
    `${patientName} has a severe motor impairment and answers by choosing one of your suggestions with their eyes; IRIS then says it out loud.`,
    "",
    ...spoken.map((s) => `${patientName} (through IRIS) said: "${s}"`),
    `Someone near ${patientName} just said: "${heard}"`,
    "",
    `Write exactly ${REPLY_COUNT} replies ${patientName} could say back:`,
    "- First person, natural spoken language, at most 12 words each.",
    "- Clearly different from each other (when it fits: one yes/positive, one no/negative, one that asks or buys time).",
    `- If it's about ${patientName}'s health, reports, results, medicines or progress, use the facts in their records. Never invent results, numbers, doses or diagnoses; if the records don't say, a reply should say they're not sure or will check with their doctor.`,
    "- Reply in the same language the speaker used. No emojis or numbering.",
    ...(avoid.length ? ["- Do not repeat these earlier suggestions:", ...avoid.map((a) => `  - ${a}`)] : []),
    "",
    'Respond with ONLY this JSON and nothing else: {"replies": ["…", "…", "…"], "unclear": false}',
    'Set "unclear" to true (and make the replies polite requests to repeat) if what was heard is garbled or makes no sense.',
  ].join("\n");
}

/** Lenient parser: JSON object/array (optionally in a code fence), else numbered/bulleted lines. */
export function parseReplies(raw: string): { replies: string[]; unclear: boolean } {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const objectLike = (fenced ?? text).match(/\{[\s\S]*\}|\[[\s\S]*\]/)?.[0];

  let replies: string[] = [];
  let unclear = false;
  if (objectLike) {
    try {
      const parsed = JSON.parse(objectLike) as unknown;
      if (Array.isArray(parsed)) replies = parsed.filter((v): v is string => typeof v === "string");
      else if (parsed && typeof parsed === "object") {
        const p = parsed as { replies?: unknown; options?: unknown; unclear?: unknown };
        const list = Array.isArray(p.replies) ? p.replies : Array.isArray(p.options) ? p.options : [];
        replies = list.filter((v): v is string => typeof v === "string");
        unclear = p.unclear === true;
      }
    } catch {
      /* fall through to line parsing */
    }
  }
  if (replies.length < REPLY_COUNT) {
    replies = text
      .split("\n")
      .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.):])\s*/, "").trim())
      .filter((l) => l && !/^[{}[\]]/.test(l) && l.length <= 140);
  }

  const cleaned = [
    ...new Map(
      replies
        .map((r) => r.trim().replace(/^["“']+|["”']+$/g, "").trim())
        .filter(Boolean)
        .map((r) => [r.toLowerCase(), r]),
    ).values(),
  ].slice(0, REPLY_COUNT);

  if (cleaned.length < REPLY_COUNT) throw new Error(`AutoSage returned ${cleaned.length} usable replies.`);
  return { replies: cleaned, unclear };
}
