import { bytea, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { user } from "./auth";

/**
 * Care data for IRIS (docs/care.md).
 * Medical content itself lives in each patient's AutoSage knowledge base; these tables keep
 * ownership, access (who treats whom) and sync state.
 */

export const USER_ROLES = ["patient", "doctor"] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** A doctor treating a patient. Many-to-many: a patient can have several doctors and vice versa. */
export const careRelation = pgTable(
  "care_relation",
  {
    id: text("id").primaryKey(),
    doctorId: text("doctor_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    patientId: text("patient_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("care_relation_pair_idx").on(t.doctorId, t.patientId),
    index("care_relation_patient_idx").on(t.patientId),
  ],
);

/** One per patient: points at the patient's AutoSage knowledge base (their medical memory). */
export const patientProfile = pgTable("patient_profile", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  autosageKbId: text("autosage_kb_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const RECORD_KINDS = ["note", "file"] as const;
export const RECORD_CATEGORIES = ["medication", "progress", "diagnosis", "report", "general"] as const;
export const SYNC_STATUSES = ["pending", "uploading", "queued", "processing", "processed", "failed"] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

/** A note written by a doctor, or a file (report, scan, document) they uploaded. Each one is synced to AutoSage. */
export const medicalRecord = pgTable(
  "medical_record",
  {
    id: text("id").primaryKey(),
    patientId: text("patient_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    authorId: text("author_id").references(() => user.id, { onDelete: "set null" }),
    kind: text("kind").$type<(typeof RECORD_KINDS)[number]>().notNull(),
    category: text("category").$type<(typeof RECORD_CATEGORIES)[number]>().notNull().default("general"),
    title: text("title").notNull(),
    /** Note text (Markdown). Null for files. */
    body: text("body"),
    fileName: text("file_name"),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    autosageDocumentId: text("autosage_document_id"),
    syncStatus: text("sync_status").$type<SyncStatus>().notNull().default("pending"),
    syncError: text("sync_error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (t) => [index("medical_record_patient_idx").on(t.patientId, t.createdAt)],
);

/**
 * Bytes of an uploaded file that hasn't reached AutoSage yet (e.g. AutoSage was down).
 * Deleted as soon as the upload succeeds, so files can be re-synced without asking the doctor again.
 */
export const pendingUpload = pgTable("pending_upload", {
  recordId: text("record_id")
    .primaryKey()
    .references(() => medicalRecord.id, { onDelete: "cascade" }),
  bytes: bytea("bytes").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * One conversation = one AutoSage chat. Every utterance and reply of a conversation goes into the
 * same chat; when the patient leaves conversation mode it is ended and the next one starts fresh.
 */
export const conversation = pgTable(
  "conversation",
  {
    id: text("id").primaryKey(),
    patientId: text("patient_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Same id as our row when the AutoSage chat was created; null if AutoSage was unavailable. */
    autosageChatId: text("autosage_chat_id"),
    /** Reply batches already shown for the latest utterance, so "New replies" never repeats them. */
    shownReplies: jsonb("shown_replies").$type<string[][]>().notNull().default([]),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    lastActivityAt: timestamp("last_activity_at").defaultNow().notNull(),
    endedAt: timestamp("ended_at"),
  },
  (t) => [index("conversation_patient_idx").on(t.patientId, t.startedAt)],
);

export const TURN_ROLES = ["heard", "spoken"] as const;

/** What was heard near the robot, and what the patient said back through IRIS. */
export const conversationTurn = pgTable(
  "conversation_turn",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    role: text("role").$type<(typeof TURN_ROLES)[number]>().notNull(),
    text: text("text").notNull(),
    /** Set on "spoken" turns once they were included in an AutoSage query. */
    sentToAutosage: timestamp("sent_to_autosage"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("conversation_turn_conversation_idx").on(t.conversationId, t.createdAt)],
);
