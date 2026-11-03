import { user } from "@Teekhi_Nazaar/db/schema/auth";
import { careRelation, medicalRecord, patientProfile, RECORD_CATEGORIES } from "@Teekhi_Nazaar/db/schema/care";
import { and, count, desc, eq, max, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { autosage, autosageConfigured } from "../autosage/client";
import { patientKbId, replyModel } from "../autosage/provision";
import { autoResync, markStaleUploads, refreshSyncStatuses, resyncRecord, syncNewFile, syncNote, UPLOADABLE_TYPES } from "../autosage/records";
import { type AuthedEnv, requireRole, requireSession, treats } from "../rbac";
import { db } from "../services";

const MAX_FILE_BYTES = 25 * 1024 * 1024;

export const doctorRoutes = new Hono<AuthedEnv>();

doctorRoutes.use("*", requireSession, requireRole("doctor"));

const fail = (status: 400 | 403 | 404 | 409 | 413 | 415 | 502 | 503, error: string, message: string) => ({ status, body: { error, message } });

async function patientOf(doctorId: string, patientId: string) {
  if (!(await treats(doctorId, patientId))) return null;
  const [p] = await db.select({ id: user.id, name: user.name, email: user.email, image: user.image }).from(user).where(eq(user.id, patientId)).limit(1);
  return p ?? null;
}

/** GET /api/doctor/patients → the doctor's patients with record counts. */
doctorRoutes.get("/patients", async (c) => {
  const doctor = c.get("user");
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      assignedAt: careRelation.createdAt,
      records: count(medicalRecord.id),
      lastRecordAt: max(medicalRecord.createdAt),
    })
    .from(careRelation)
    .innerJoin(user, eq(user.id, careRelation.patientId))
    .leftJoin(medicalRecord, eq(medicalRecord.patientId, careRelation.patientId))
    .where(eq(careRelation.doctorId, doctor.id))
    .groupBy(user.id, careRelation.createdAt)
    .orderBy(desc(sql`coalesce(${max(medicalRecord.createdAt)}, ${careRelation.createdAt})`));
  return c.json({ patients: rows });
});

/** POST /api/doctor/patients { email } → assign an existing patient account to this doctor. */
doctorRoutes.post("/patients", async (c) => {
  const body = z.object({ email: z.email() }).safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: "VALIDATION_ERROR", message: "Enter a valid email address." }, 400);

  const [patient] = await db
    .select({ id: user.id, name: user.name, email: user.email, role: user.role })
    .from(user)
    .where(eq(sql`lower(${user.email})`, body.data.email.toLowerCase()))
    .limit(1);
  if (!patient) {
    return c.json({ error: "NOT_FOUND", message: "No IRIS account uses that email. Ask the patient to sign up and choose “Patient” first." }, 404);
  }
  if (patient.role !== "patient") {
    return c.json({ error: "NOT_A_PATIENT", message: patient.role === "doctor" ? "That account belongs to a doctor." : "That person hasn't chosen “Patient” as their role yet." }, 409);
  }

  await db
    .insert(careRelation)
    .values({ id: crypto.randomUUID(), doctorId: c.get("user").id, patientId: patient.id })
    .onConflictDoNothing();
  await db.insert(patientProfile).values({ userId: patient.id }).onConflictDoNothing();

  return c.json({ patient: { id: patient.id, name: patient.name, email: patient.email } }, 201);
});

/** DELETE /api/doctor/patients/:patientId → stop treating this patient (their records stay). */
doctorRoutes.delete("/patients/:patientId", async (c) => {
  await db
    .delete(careRelation)
    .where(and(eq(careRelation.doctorId, c.get("user").id), eq(careRelation.patientId, c.req.param("patientId"))));
  return c.json({ ok: true });
});

/** GET /api/doctor/patients/:patientId → profile, records (with fresh sync status) and care team. */
doctorRoutes.get("/patients/:patientId", async (c) => {
  const patient = await patientOf(c.get("user").id, c.req.param("patientId"));
  if (!patient) return c.json({ error: "NOT_FOUND", message: "This patient isn't assigned to you." }, 404);

  const records = await db
    .select({
      record: medicalRecord,
      authorName: user.name,
    })
    .from(medicalRecord)
    .leftJoin(user, eq(user.id, medicalRecord.authorId))
    .where(eq(medicalRecord.patientId, patient.id))
    .orderBy(desc(medicalRecord.createdAt));

  const refreshed = await refreshSyncStatuses(await markStaleUploads(records.map((r) => r.record)));
  autoResync(refreshed, patient);
  const authorById = new Map(records.map((r) => [r.record.id, r.authorName]));

  const doctors = await db
    .select({ id: user.id, name: user.name })
    .from(careRelation)
    .innerJoin(user, eq(user.id, careRelation.doctorId))
    .where(eq(careRelation.patientId, patient.id));

  const [profile] = await db.select().from(patientProfile).where(eq(patientProfile.userId, patient.id)).limit(1);

  return c.json({
    patient,
    knowledgeBase: { connected: Boolean(profile?.autosageKbId), autosageConfigured: autosageConfigured() },
    careTeam: doctors,
    records: refreshed.map((r) => ({ ...r, authorName: authorById.get(r.id) ?? null })),
  });
});

/** POST /api/doctor/patients/:patientId/notes { category, title?, body } → note → Markdown doc → KB. */
doctorRoutes.post("/patients/:patientId/notes", async (c) => {
  const doctor = c.get("user");
  const patient = await patientOf(doctor.id, c.req.param("patientId"));
  if (!patient) return c.json({ error: "NOT_FOUND", message: "This patient isn't assigned to you." }, 404);

  const body = z
    .object({
      category: z.enum(RECORD_CATEGORIES).default("general"),
      title: z.string().trim().max(120).optional(),
      body: z.string().trim().min(3, "Write a little more.").max(20_000),
    })
    .safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: "VALIDATION_ERROR", message: body.error.issues[0]?.message ?? "Invalid note." }, 400);

  const [record] = await db
    .insert(medicalRecord)
    .values({
      id: crypto.randomUUID(),
      patientId: patient.id,
      authorId: doctor.id,
      kind: "note",
      category: body.data.category,
      title: body.data.title || defaultTitle(body.data.category, body.data.body),
      body: body.data.body,
    })
    .returning();

  void syncNote(record!, patient, { id: doctor.id, name: doctor.name });
  return c.json({ record: { ...record!, syncStatus: "uploading", authorName: doctor.name } }, 201);
});

/** POST /api/doctor/patients/:patientId/files (multipart: file, category, title?) → straight into the KB. */
doctorRoutes.post("/patients/:patientId/files", async (c) => {
  const doctor = c.get("user");
  const patient = await patientOf(doctor.id, c.req.param("patientId"));
  if (!patient) return c.json({ error: "NOT_FOUND", message: "This patient isn't assigned to you." }, 404);

  const form = await c.req.parseBody();
  const file = form.file;
  if (!(file instanceof File)) return c.json({ error: "VALIDATION_ERROR", message: "Choose a file to upload." }, 400);
  if (file.size === 0) return c.json({ error: "VALIDATION_ERROR", message: "That file is empty." }, 400);
  if (file.size > MAX_FILE_BYTES) return c.json({ error: "FILE_TOO_LARGE", message: "Files can be up to 25 MB." }, 413);

  const mimeType = normaliseMime(file);
  if (!UPLOADABLE_TYPES[mimeType]) {
    return c.json({ error: "UNSUPPORTED_MEDIA", message: "Upload a PDF, Word, Excel, text, CSV, JSON or image file." }, 415);
  }

  const category = z.enum(RECORD_CATEGORIES).catch("report").parse(form.category);
  const title = typeof form.title === "string" && form.title.trim() ? form.title.trim().slice(0, 120) : file.name.replace(/\.[^.]+$/, "");

  const [record] = await db
    .insert(medicalRecord)
    .values({
      id: crypto.randomUUID(),
      patientId: patient.id,
      authorId: doctor.id,
      kind: "file",
      category,
      title,
      fileName: file.name,
      mimeType,
      sizeBytes: file.size,
    })
    .returning();

  const bytes = new Uint8Array(await file.arrayBuffer());
  void syncNewFile(record!, patient, { bytes, fileName: safeFileName(file.name) });
  return c.json({ record: { ...record!, syncStatus: "uploading", authorName: doctor.name } }, 201);
});

/** POST /api/doctor/records/:recordId/retry → re-sync a record that didn't reach the knowledge base. */
doctorRoutes.post("/records/:recordId/retry", async (c) => {
  const doctor = c.get("user");
  const [record] = await db.select().from(medicalRecord).where(eq(medicalRecord.id, c.req.param("recordId"))).limit(1);
  const patient = record && (await patientOf(doctor.id, record.patientId));
  if (!record || !patient) return c.json({ error: "NOT_FOUND", message: "Record not found." }, 404);

  if (record.kind === "file") {
    const ok = await resyncRecord(record, patient).catch(() => true);
    if (!ok) return c.json({ error: "RETRY_UNAVAILABLE", message: "The original file is no longer kept. Upload it again." }, 409);
    return c.json({ ok: true });
  }
  void resyncRecord(record, patient);
  return c.json({ ok: true });
});

/** DELETE /api/doctor/records/:recordId → remove from IRIS and from the knowledge base. */
doctorRoutes.delete("/records/:recordId", async (c) => {
  const doctor = c.get("user");
  const [record] = await db.select().from(medicalRecord).where(eq(medicalRecord.id, c.req.param("recordId"))).limit(1);
  if (!record || !(await treats(doctor.id, record.patientId))) return c.json({ error: "NOT_FOUND", message: "Record not found." }, 404);

  if (record.autosageDocumentId && autosageConfigured()) {
    try {
      await autosage.deleteDocument(record.autosageDocumentId);
    } catch (error) {
      const r = fail(502, "AUTOSAGE_DELETE_FAILED", error instanceof Error ? error.message : "Couldn't remove it from the knowledge base.");
      return c.json(r.body, r.status);
    }
  }
  await db.delete(medicalRecord).where(eq(medicalRecord.id, record.id));
  return c.json({ ok: true });
});

/** GET /api/doctor/records/:recordId/download → { url } short-lived link to the original file. */
doctorRoutes.get("/records/:recordId/download", async (c) => {
  const doctor = c.get("user");
  const [record] = await db.select().from(medicalRecord).where(eq(medicalRecord.id, c.req.param("recordId"))).limit(1);
  if (!record || !(await treats(doctor.id, record.patientId))) return c.json({ error: "NOT_FOUND", message: "Record not found." }, 404);
  if (!record.autosageDocumentId) return c.json({ error: "NOT_SYNCED", message: "This file hasn't reached the knowledge base yet." }, 409);
  try {
    const url = await autosage.documentDownloadUrl(record.autosageDocumentId);
    if (!url) throw new Error("No download link returned.");
    return c.json({ url });
  } catch (error) {
    return c.json({ error: "AUTOSAGE_ERROR", message: error instanceof Error ? error.message : "Download failed." }, 502);
  }
});

/** POST /api/doctor/patients/:patientId/ask { question } → grounded answer from the patient's records. */
doctorRoutes.post("/patients/:patientId/ask", async (c) => {
  const doctor = c.get("user");
  const patient = await patientOf(doctor.id, c.req.param("patientId"));
  if (!patient) return c.json({ error: "NOT_FOUND", message: "This patient isn't assigned to you." }, 404);
  if (!autosageConfigured()) return c.json({ error: "AI_NOT_CONFIGURED", message: "AutoSage isn't configured on the server." }, 503);

  const body = z.object({ question: z.string().trim().min(3).max(1000) }).safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: "VALIDATION_ERROR", message: "Ask a question about this patient." }, 400);

  try {
    const t0 = performance.now();
    const { text } = await autosage.fastQuery({
      kbId: await patientKbId(patient),
      model: await replyModel(),
      subjectId: `doctor:${doctor.id}`,
      content: [
        `A clinician (Dr. ${doctor.name}) asks about patient ${patient.name}:`,
        body.data.question,
        "",
        "Answer briefly from this patient's records only, mention the date or document a fact comes from, and say clearly if the records don't contain the answer.",
      ].join("\n"),
    });
    return c.json({ answer: text || "No answer came back.", ms: Math.round(performance.now() - t0) });
  } catch (error) {
    return c.json({ error: "AUTOSAGE_ERROR", message: error instanceof Error ? error.message : "AutoSage didn't answer." }, 502);
  }
});

function defaultTitle(category: (typeof RECORD_CATEGORIES)[number], body: string) {
  const label = { medication: "Medication", progress: "Progress", diagnosis: "Diagnosis", report: "Report", general: "Note" }[category];
  const firstLine = body.split("\n")[0]!.trim();
  const short = firstLine.length <= 60 ? firstLine : `${firstLine.slice(0, 60).replace(/\s+\S*$/, "")}…`;
  return short ? `${label}: ${short}` : label;
}

function normaliseMime(file: File) {
  const type = file.type.split(";")[0]!.trim().toLowerCase();
  if (type && type !== "application/octet-stream") return type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  return (
    { pdf: "application/pdf", md: "text/markdown", txt: "text/plain", csv: "text/csv", json: "application/json", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", doc: "application/msword", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", tif: "image/tiff", tiff: "image/tiff" } as Record<string, string>
  )[ext ?? ""] ?? type;
}

function safeFileName(name: string) {
  // AutoSage rejects path separators and control characters.
  return name.replace(/[\\/\u0000-\u001f]+/g, "_").slice(0, 180) || "document";
}
