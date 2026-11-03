import { user } from "@Teekhi_Nazaar/db/schema/auth";
import { medicalRecord, pendingUpload, type SyncStatus } from "@Teekhi_Nazaar/db/schema/care";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";

import { db } from "../services";
import { AutoSageError, autosage, autosageConfigured } from "./client";
import { patientKbId, tenantId } from "./provision";

type Record = typeof medicalRecord.$inferSelect;
type Person = { id: string; name: string };

const CATEGORY_LABEL: { [k in Record["category"]]: string } = {
  medication: "Medication change",
  progress: "Progress update",
  diagnosis: "Diagnosis",
  report: "Report",
  general: "Clinical note",
};

/**
 * A doctor's note as a self-contained Markdown document. The header repeats who/what/when so
 * retrieval chunks still carry that context ("results of my current report", "new medicine").
 */
export function noteToMarkdown(record: Record, patient: Person, author: Person | null) {
  const date = record.createdAt.toISOString().slice(0, 10);
  return [
    `# ${record.title}`,
    "",
    `- **Patient:** ${patient.name}`,
    `- **Type:** ${CATEGORY_LABEL[record.category]}`,
    `- **Date:** ${date}`,
    `- **Written by:** ${author ? `Dr. ${author.name}` : "a doctor"}`,
    "",
    "## Note",
    "",
    record.body?.trim() ?? "",
    "",
  ].join("\n");
}

export function noteFileName(record: Record) {
  const slug = record.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
  return `${record.createdAt.toISOString().slice(0, 10)}-${record.category}-${slug || "note"}-${record.id.slice(0, 6)}.md`;
}

async function setStatus(id: string, status: SyncStatus, extra: Partial<Record> = {}) {
  await db
    .update(medicalRecord)
    .set({ syncStatus: status, syncError: null, ...extra })
    .where(eq(medicalRecord.id, id));
}

/**
 * Upload one record's bytes to the patient's knowledge base. Runs in the background; the UI polls
 * the record list, which refreshes processing statuses (refreshSyncStatuses).
 */
export async function syncToKnowledgeBase(
  record: Record,
  patient: Person,
  file: { bytes: Uint8Array; mimeType: string; fileName: string },
) {
  if (!autosageConfigured()) {
    await setStatus(record.id, "pending", { syncError: "AutoSage isn't configured on the server yet." });
    return;
  }
  // Claim the record atomically so two syncs (auto-resync + a manual retry) never upload it twice.
  const claimed = await db
    .update(medicalRecord)
    .set({ syncStatus: "uploading", syncError: null })
    .where(and(eq(medicalRecord.id, record.id), isNull(medicalRecord.autosageDocumentId), ne(medicalRecord.syncStatus, "uploading")))
    .returning({ id: medicalRecord.id });
  if (claimed.length === 0) return;

  try {
    const documentId = await autosage.uploadDocument({
      tenantId: await tenantId(),
      kbId: await patientKbId(patient),
      filename: file.fileName,
      mimeType: file.mimeType,
      bytes: file.bytes,
    });
    await setStatus(record.id, "queued", { autosageDocumentId: documentId });
    await db.delete(pendingUpload).where(eq(pendingUpload.recordId, record.id));
  } catch (error) {
    console.warn(`[autosage] sync failed for record ${record.id}:`, error instanceof Error ? error.message : error);
    const message = friendlySyncError(error);
    await db.update(medicalRecord).set({ syncStatus: "failed", syncError: message }).where(eq(medicalRecord.id, record.id));
  }
}

export async function syncNote(record: Record, patient: Person, author: Person | null) {
  const markdown = noteToMarkdown(record, patient, author);
  await syncToKnowledgeBase(record, patient, {
    bytes: new TextEncoder().encode(markdown),
    mimeType: "text/markdown",
    fileName: noteFileName(record),
  });
}

/** What a doctor should read when a record didn't reach the knowledge base. */
function friendlySyncError(error: unknown) {
  if (error instanceof AutoSageError) {
    if (error.status === 0 || error.status >= 500) return "AutoSage is unreachable right now. This will sync automatically when it’s back.";
    if (error.status === 401 || error.status === 403) return "AutoSage refused the request. Check the API key and its permissions.";
    if (error.status === 413) return "This file is too large for the patient’s knowledge base.";
    return error.message.replace(/^AutoSage [A-Z]+ \S+ failed: /, "AutoSage: ");
  }
  return "Couldn’t add this to the knowledge base. Try again.";
}

/** Keep a file's bytes until AutoSage has them, then upload. */
export async function syncNewFile(record: Record, patient: Person, file: { bytes: Uint8Array; fileName: string }) {
  await db.insert(pendingUpload).values({ recordId: record.id, bytes: Buffer.from(file.bytes) }).onConflictDoNothing();
  await syncToKnowledgeBase(record, patient, { bytes: file.bytes, mimeType: record.mimeType ?? "application/octet-stream", fileName: file.fileName });
}

/** Re-sync one record (note: rebuilt from its text; file: from the kept bytes). False if a file's bytes are gone. */
export async function resyncRecord(record: Record, patient: Person) {
  if (record.kind === "note") {
    const [author] = record.authorId ? await db.select({ id: user.id, name: user.name }).from(user).where(eq(user.id, record.authorId)).limit(1) : [];
    await syncNote(record, patient, author ?? null);
    return true;
  }
  const [blob] = await db.select().from(pendingUpload).where(eq(pendingUpload.recordId, record.id)).limit(1);
  if (!blob) return false;
  await syncToKnowledgeBase(record, patient, {
    bytes: new Uint8Array(blob.bytes),
    mimeType: record.mimeType ?? "application/octet-stream",
    fileName: (record.fileName ?? "document").replace(/[\\/\u0000-\u001f]+/g, "_"),
  });
  return true;
}

const lastAutoResync = new Map<string, number>();

/**
 * Records that never reached AutoSage (it was down or unconfigured) are retried automatically,
 * at most every 2 minutes per patient, whenever a doctor opens the profile.
 */
export function autoResync(records: Record[], patient: Person) {
  if (!autosageConfigured()) return;
  const now = Date.now();
  if (now - (lastAutoResync.get(patient.id) ?? 0) < 2 * 60 * 1000) return;
  const stuck = records.filter((r) => !r.autosageDocumentId && (r.syncStatus === "failed" || r.syncStatus === "pending"));
  if (stuck.length === 0) return;
  lastAutoResync.set(patient.id, now);
  void (async () => {
    for (const r of stuck.slice(0, 10)) await resyncRecord(r, patient).catch(() => {});
  })();
}

/** Records that were mid-upload when the server restarted would otherwise look "uploading" forever. */
export async function markStaleUploads(records: Record[]) {
  const stale = records.filter((r) => r.syncStatus === "uploading" && Date.now() - r.updatedAt.getTime() > 3 * 60 * 1000);
  if (stale.length === 0) return records;
  await db
    .update(medicalRecord)
    .set({ syncStatus: "failed", syncError: "Upload was interrupted." })
    .where(and(inArray(medicalRecord.id, stale.map((r) => r.id)), eq(medicalRecord.syncStatus, "uploading")));
  const ids = new Set(stale.map((r) => r.id));
  return records.map((r) => (ids.has(r.id) ? { ...r, syncStatus: "failed" as const, syncError: "Upload was interrupted." } : r));
}

/** Ask AutoSage how far processing got for records still in flight. Best effort, bounded. */
export async function refreshSyncStatuses(records: Record[]) {
  if (!autosageConfigured()) return records;
  const inFlight = records.filter((r) => r.autosageDocumentId && (r.syncStatus === "queued" || r.syncStatus === "processing")).slice(0, 15);

  const updates = await Promise.all(
    inFlight.map(async (r) => {
      try {
        const status = await autosage.documentStatus(r.autosageDocumentId!);
        const next: SyncStatus | null =
          status === "processed" ? "processed" : status === "failed" ? "failed" : status === "processing" ? "processing" : status === "queued" || status === "pending_upload" ? "queued" : null;
        if (next && next !== r.syncStatus) {
          const syncError = next === "failed" ? processingFailedMessage(r) : null;
          await db.update(medicalRecord).set({ syncStatus: next, syncError }).where(eq(medicalRecord.id, r.id));
          return { ...r, syncStatus: next, syncError };
        }
      } catch {
        /* keep the last known status */
      }
      return r;
    }),
  );

  const byId = new Map(updates.map((r) => [r.id, r]));
  return records.map((r) => byId.get(r.id) ?? r);
}

/**
 * AutoSage reports processing failures without a reason. Verified 2026-11-04 on beta-api: text PDFs,
 * Markdown and text files process fine, but anything that needs OCR (scanned PDFs, photos) fails.
 */
function processingFailedMessage(r: Record) {
  const needsOcr = r.kind === "file" && (r.mimeType === "application/pdf" || r.mimeType?.startsWith("image/"));
  return needsOcr
    ? "AutoSage couldn’t read this file. Scanned PDFs and photos fail on AutoSage’s side right now. Upload a text-based PDF, or write the key results as a note."
    : "AutoSage couldn’t process this document.";
}

/** File types AutoSage ingests (presign mime_type enum) that make sense for medical records. */
export const UPLOADABLE_TYPES: { [mime: string]: string } = {
  "application/pdf": "PDF",
  "text/plain": "Text",
  "text/markdown": "Markdown",
  "text/csv": "CSV",
  "application/msword": "Word",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
  "application/vnd.ms-excel": "Excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel",
  "application/json": "JSON",
  "image/jpeg": "Image",
  "image/png": "Image",
  "image/webp": "Image",
  "image/tiff": "Image",
};
