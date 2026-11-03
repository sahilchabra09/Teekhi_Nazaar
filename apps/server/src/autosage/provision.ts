import { patientProfile } from "@Teekhi_Nazaar/db/schema/care";
import { eq } from "drizzle-orm";

import { ENV } from "../env.server";
import { db } from "../services";
import { AutoSageError, autosage } from "./client";

/**
 * AutoSage layout for IRIS:
 *
 *   Environment (the API key's)
 *     └── Tenant "IRIS" (external_id "iris")      one tenant for the whole app
 *           ├── KB  patient A                      one knowledge base per patient = retrieval boundary,
 *           ├── KB  patient B                      so one patient's records can never ground another's answers
 *           └── …
 *   Chats live inside the patient's KB, owned by external_subject_id = the patient's user id.
 */

const TENANT_EXTERNAL_ID = "iris";

let tenantPromise: Promise<string> | null = null;
let modelPromise: Promise<string> | null = null;
const kbInFlight = new Map<string, Promise<string>>();

/** Cached tenant id: env override, else find by external id, else create. */
export function tenantId() {
  tenantPromise ??= resolveTenant().catch((error) => {
    tenantPromise = null; // retry on the next call
    throw error;
  });
  return tenantPromise;
}

async function resolveTenant() {
  if (ENV.AUTOSAGE_TENANT_ID?.trim()) return ENV.AUTOSAGE_TENANT_ID.trim();

  const existing = (await autosage.listTenants()).find((t) => t.externalId === TENANT_EXTERNAL_ID);
  if (existing) return existing.id;

  const me = await autosage.me();
  const environmentId = me.environment?.id;
  if (!environmentId) throw new AutoSageError(0, "Couldn't find the API key's environment to create the IRIS tenant in.");
  const id = await autosage.createTenant({ environmentId, name: "IRIS", externalId: TENANT_EXTERNAL_ID });
  console.info(`[autosage] created tenant ${id}. Set AUTOSAGE_TENANT_ID=${id} to skip discovery.`);
  return id;
}

/** Cached model id for fast-query: env override, else the first "Economic" model AutoSage offers. */
export function replyModel() {
  modelPromise ??= (async () => {
    if (ENV.AUTOSAGE_MODEL?.trim()) return ENV.AUTOSAGE_MODEL.trim();
    const models = await autosage.listModels();
    const pick = models.find((m) => /econom/i.test(m.tier ?? "")) ?? models.find((m) => /balanced/i.test(m.tier ?? "")) ?? models[0];
    if (!pick) throw new AutoSageError(0, "AutoSage returned no chat models.");
    console.info(`[autosage] using model ${pick.id} (${pick.tier ?? "no tier"})`);
    return pick.id;
  })().catch((error) => {
    modelPromise = null;
    throw error;
  });
  return modelPromise;
}

/** The patient's knowledge base id, created on first use. Safe to call concurrently. */
export async function patientKbId(patient: { id: string; name: string }) {
  const [row] = await db.select().from(patientProfile).where(eq(patientProfile.userId, patient.id)).limit(1);
  if (row?.autosageKbId) return row.autosageKbId;

  let pending = kbInFlight.get(patient.id);
  if (!pending) {
    pending = createPatientKb(patient).finally(() => kbInFlight.delete(patient.id));
    kbInFlight.set(patient.id, pending);
  }
  return pending;
}

async function createPatientKb(patient: { id: string; name: string }) {
  const kbId = await autosage.createKnowledgeBase({
    tenantId: await tenantId(),
    name: `Patient ${patient.name} (${patient.id.slice(0, 8)})`,
    description: `Medical memory for IRIS patient ${patient.name}: doctors' notes, reports and documents.`,
    instructions: [
      `This knowledge base holds the medical records of ${patient.name}, who has a severe motor impairment and speaks through IRIS by choosing replies with their eyes.`,
      "Records are written by their doctors (medication changes, progress, diagnoses) or are uploaded reports and documents.",
      "Use only facts found in these records. Never invent test results, numbers, dosages, diagnoses or dates. If the records don't contain something, say so.",
    ].join("\n"),
  });

  await db
    .insert(patientProfile)
    .values({ userId: patient.id, autosageKbId: kbId })
    .onConflictDoUpdate({ target: patientProfile.userId, set: { autosageKbId: kbId } });

  console.info(`[autosage] created knowledge base ${kbId} for patient ${patient.id}`);
  return kbId;
}

/** Makes sure a profile row exists (used when someone becomes a patient). KB creation is best-effort. */
export async function ensurePatientProfile(patient: { id: string; name: string }) {
  await db.insert(patientProfile).values({ userId: patient.id }).onConflictDoNothing();
  try {
    await patientKbId(patient);
  } catch (error) {
    console.warn(`[autosage] couldn't create KB for ${patient.id} yet:`, error instanceof Error ? error.message : error);
  }
}
