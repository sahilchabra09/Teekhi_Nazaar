import { conversation, conversationTurn } from "@Teekhi_Nazaar/db/schema/care";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";

import { db } from "../services";

/**
 * Conversation = one stretch of talking with someone near the robot.
 * All of its turns (and its AutoSage chat) stay together; once it ends, the next utterance opens
 * a new one. A conversation also ends by itself after 10 minutes of silence.
 */

export type Conversation = typeof conversation.$inferSelect;
export type Turn = { role: "heard" | "spoken"; text: string };

const IDLE_MS = 10 * 60 * 1000;

/** The patient's open conversation with this id, or a brand-new one. */
export async function openConversation(patientId: string, conversationId?: string | null): Promise<Conversation> {
  if (conversationId) {
    const [existing] = await db
      .select()
      .from(conversation)
      .where(and(eq(conversation.id, conversationId), eq(conversation.patientId, patientId), isNull(conversation.endedAt)))
      .limit(1);
    if (existing && Date.now() - existing.lastActivityAt.getTime() < IDLE_MS) return existing;
    if (existing) await endConversation(patientId, existing.id);
  }

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
