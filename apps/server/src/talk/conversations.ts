import { conversation, conversationTurn } from "@Teekhi_Nazaar/db/schema/care";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";

import { db } from "../services";

/**
 * Conversation = one stretch of talking with someone near the robot.
 * All of its turns (and its AutoSage chat) stay together; once it ends, the next utterance opens
 * a new one. It also ends after 90 s of silence, or when someone new starts talking (turn-taking.ts).
 */

export type Conversation = typeof conversation.$inferSelect;
export type Turn = { role: "heard" | "spoken"; text: string };

import { looksLikeOpener, OPENER_GAP_MS, SILENCE_MS } from "./turn-taking";

export { looksLikeOpener, OPENER_GAP_MS, SILENCE_MS };

/** Why the returned conversation was picked. "silence"/"greeting" mean we switched away from an open one. */
export type OpenReason = "continued" | "first" | "silence" | "greeting";

/**
 * The conversation this utterance belongs to: the open one, or a new one when it ended, went quiet
 * for SILENCE_MS, or the new line sounds like a different person starting over.
 */
export async function openConversation(
  patientId: string,
  conversationId: string | null | undefined,
  heard?: string,
): Promise<{ conversation: Conversation; reason: OpenReason }> {
  if (conversationId) {
    const [existing] = await db
      .select()
      .from(conversation)
      .where(and(eq(conversation.id, conversationId), eq(conversation.patientId, patientId), isNull(conversation.endedAt)))
      .limit(1);
    if (existing) {
      const quietFor = Date.now() - existing.lastActivityAt.getTime();
      const reason: OpenReason | null =
        quietFor >= SILENCE_MS ? "silence" : heard && quietFor >= OPENER_GAP_MS && looksLikeOpener(heard) ? "greeting" : null;
      if (!reason) return { conversation: existing, reason: "continued" };
      await endConversation(patientId, existing.id);
      return { conversation: await createConversation(patientId), reason };
    }
  }
  return { conversation: await createConversation(patientId), reason: "first" };
}

async function createConversation(patientId: string) {
  const [created] = await db.insert(conversation).values({ id: crypto.randomUUID(), patientId }).returning();
  return created!;
}

export async function getConversation(patientId: string, conversationId: string) {
  const [row] = await db
    .select()
    .from(conversation)
    .where(and(eq(conversation.id, conversationId), eq(conversation.patientId, patientId)))
    .limit(1);
  return row ?? null;
}

export async function endConversation(patientId: string, conversationId: string) {
  await db
    .update(conversation)
    .set({ endedAt: new Date() })
    .where(and(eq(conversation.id, conversationId), eq(conversation.patientId, patientId), isNull(conversation.endedAt)));
}

export async function addTurn(conversationId: string, role: Turn["role"], text: string) {
  await db.insert(conversationTurn).values({ id: crypto.randomUUID(), conversationId, role, text });
  await db
    .update(conversation)
    .set({ lastActivityAt: new Date(), ...(role === "heard" ? { shownReplies: [] } : {}) })
    .where(eq(conversation.id, conversationId));
}

/** Last `limit` turns, oldest first. */
export async function recentTurns(conversationId: string, limit = 12): Promise<Turn[]> {
  const rows = await db
    .select({ role: conversationTurn.role, text: conversationTurn.text })
    .from(conversationTurn)
    .where(eq(conversationTurn.conversationId, conversationId))
    .orderBy(desc(conversationTurn.createdAt))
    .limit(limit);
  return rows.reverse();
}

export async function lastHeard(conversationId: string) {
  const [row] = await db
    .select({ text: conversationTurn.text })
    .from(conversationTurn)
    .where(and(eq(conversationTurn.conversationId, conversationId), eq(conversationTurn.role, "heard")))
    .orderBy(desc(conversationTurn.createdAt))
    .limit(1);
  return row?.text ?? null;
}

/** "spoken" turns not yet passed to the AutoSage chat (they ride along with the next query). */
export async function unsentSpoken(conversationId: string) {
  return db
    .select({ id: conversationTurn.id, text: conversationTurn.text })
    .from(conversationTurn)
    .where(
      and(
        eq(conversationTurn.conversationId, conversationId),
        eq(conversationTurn.role, "spoken"),
        isNull(conversationTurn.sentToAutosage),
      ),
    )
    .orderBy(asc(conversationTurn.createdAt));
}

export async function markSent(turnIds: string[]) {
  if (turnIds.length === 0) return;
  await db.update(conversationTurn).set({ sentToAutosage: new Date() }).where(inArray(conversationTurn.id, turnIds));
}

export async function setAutosageChat(conversationId: string, chatId: string) {
  await db.update(conversation).set({ autosageChatId: chatId }).where(eq(conversation.id, conversationId));
}

export async function addShownReplies(conv: Conversation, replies: string[]) {
  const shown = [...conv.shownReplies, replies].slice(-3);
  await db.update(conversation).set({ shownReplies: shown, lastActivityAt: new Date() }).where(eq(conversation.id, conv.id));
}
