import { ENV } from "../env.server";

/**
 * Thin AutoSage REST client (https://docs.autosage.ai/developers/api/overview).
 * Only the calls IRIS needs: tenant/KB provisioning, document upload, chats and fast-query.
 * Field names follow the OpenAPI spec (snake_case requests, mixed-case responses), so response
 * readers are deliberately lenient.
 */

export class AutoSageError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "AutoSageError";
  }
}

export const autosageConfigured = () => Boolean(ENV.AUTOSAGE_API_KEY?.trim());

function baseUrl() {
  return `${(ENV.AUTOSAGE_BASE_URL || "https://api.autosage.ai").replace(/\/+$/, "")}/api/v1`;
}

async function request<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  opts: { query?: Record<string, string | undefined>; body?: unknown; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  const key = ENV.AUTOSAGE_API_KEY?.trim();
  if (!key) throw new AutoSageError(0, "AUTOSAGE_API_KEY is not set on the server.");

  const url = new URL(`${baseUrl()}${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, v);

  const timeout = AbortSignal.timeout(opts.timeoutMs ?? 25_000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal,
    });
  } catch (error) {
    const reason = error instanceof Error && error.name === "TimeoutError" ? "timed out" : "is unreachable";
    throw new AutoSageError(0, `AutoSage ${reason} (${method} ${path}).`);
  }

  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!response.ok) {
    const message =
      (payload && typeof payload === "object" && ("message" in payload || "error" in payload)
        ? String((payload as { message?: unknown; error?: unknown }).message ?? (payload as { error?: unknown }).error)
        : typeof payload === "string" && payload.length < 200
          ? payload
          : "") || `HTTP ${response.status}`;
    throw new AutoSageError(response.status, `AutoSage ${method} ${path} failed: ${message.trim()}`, payload);
  }
  return payload as T;
}

// ───────────────────────────── helpers for lenient response reading ─────────────────────────────

type Json = Record<string, unknown>;

/** Finds an id on a response that may wrap the entity (`{ tenant: {...} }`, `{ data: {...} }`, …). */
export function pickId(payload: unknown, wrappers: string[] = []): string | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Json;
  for (const w of [...wrappers, "data"]) {
    const inner = obj[w];
    if (inner && typeof inner === "object" && typeof (inner as Json).id === "string") return (inner as Json).id as string;
  }
  return typeof obj.id === "string" ? obj.id : null;
}

function pickArray(payload: unknown, keys: string[]): Json[] {
  if (Array.isArray(payload)) return payload as Json[];
  if (!payload || typeof payload !== "object") return [];
  for (const k of [...keys, "data", "items"]) {
    const v = (payload as Json)[k];
    if (Array.isArray(v)) return v as Json[];
  }
  return [];
}

/**
 * Pulls the answer text out of a chat/fast-query response. fast-query returns `final_answer`
 * (verified live on beta-api, 2026-11-04); the other shapes cover the regular chat endpoints.
 */
export function pickAnswer(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object") return "";
  const obj = payload as Json;
  const candidates: unknown[] = [
    obj.final_answer, // fast-query: { success, final_answer, sources, processingTimeMs, tokens }
    obj.finalAnswer,
    obj.answer,
    (obj.assistant_message as Json | undefined)?.content,
    (obj.assistantMessage as Json | undefined)?.content,
    (obj.response as Json | undefined)?.content,
    (obj.response as Json | undefined)?.answer,
    (obj.response as Json | undefined)?.text,
    obj.response,
    (obj.message as Json | undefined)?.content,
    obj.content,
    obj.text,
    (obj.data as Json | undefined)?.answer,
    (obj.data as Json | undefined)?.content,
  ];
  for (const c of candidates) if (typeof c === "string" && c.trim()) return c;
  return "";
}

// ───────────────────────────── API ─────────────────────────────

export type AutoSageModel = { id: string; tier?: string; provider?: string };
export type DocumentStatus = "pending_upload" | "queued" | "processing" | "processed" | "failed" | "deleted";

export const autosage = {
  /** API-key metadata: which environment/organization the key belongs to. */
  async me() {
    return request<{ environment?: { id?: string }; organization?: { id?: string } }>("GET", "/users/me");
  },

  async listTenants() {
    const res = await request<unknown>("GET", "/tenants/");
    return pickArray(res, ["tenants"]).map((t) => ({
      id: String(t.id),
      externalId: (t.externalId ?? t.external_id) as string | undefined,
    }));
  },

  async createTenant(input: { environmentId: string; name: string; externalId: string }) {
    const res = await request<unknown>("POST", "/tenants/", {
      body: {
        environment_id: input.environmentId,
        name: input.name,
        external_id: input.externalId,
        external_name: input.name,
      },
    });
    const id = pickId(res, ["tenant"]);
    if (!id) throw new AutoSageError(0, "AutoSage created a tenant but returned no id.", res);
    return id;
  },

  async listModels(): Promise<AutoSageModel[]> {
    const res = await request<unknown>("GET", "/chats/models");
    return pickArray(res, ["models"])
      .map((m) => ({
        id: String(m.id ?? m.model ?? m.name ?? ""),
        tier: m.tier as string | undefined,
        provider: m.provider as string | undefined,
      }))
      .filter((m) => m.id);
  },

  async createKnowledgeBase(input: { tenantId: string; name: string; description: string; instructions: string }) {
    const res = await request<unknown>("POST", "/knowledge-bases/", {
      body: {
        tenant_id: input.tenantId,
        name: input.name,
        description: input.description,
        instructions: input.instructions,
      },
    });
    const id = pickId(res, ["knowledgeBase", "knowledge_base"]);
    if (!id) throw new AutoSageError(0, "AutoSage created a knowledge base but returned no id.", res);
    return id;
  },

  /** Presign → PUT bytes. Processing starts automatically once the bytes arrive. */
  async uploadDocument(input: { tenantId: string; kbId: string; filename: string; mimeType: string; bytes: Uint8Array }) {
    const presign = await request<{ document_id?: string; upload_url?: string }>("POST", "/documents/presign", {
      body: {
        kb_id: input.kbId,
        tenant_id: input.tenantId,
        filename: input.filename,
        mime_type: input.mimeType,
        size_bytes: input.bytes.byteLength,
      },
    });
    if (!presign.document_id || !presign.upload_url) {
      throw new AutoSageError(0, "AutoSage presign returned no upload URL.", presign);
    }

    const put = await fetch(presign.upload_url, {
      method: "PUT",
      headers: { "Content-Type": input.mimeType },
      body: input.bytes,
      signal: AbortSignal.timeout(120_000),
    });
    if (!put.ok) {
      // Don't leave a half-created document stuck in "pending_upload" (it counts toward quotas).
      await request("DELETE", `/documents/${encodeURIComponent(presign.document_id)}`).catch(() => {});
      throw new AutoSageError(put.status, `Uploading the file to AutoSage storage failed (HTTP ${put.status}).`);
    }

    return presign.document_id;
  },

  async documentStatus(documentId: string) {
    const res = await request<{ status?: DocumentStatus }>("GET", "/documents/status", { query: { document_id: documentId } });
    return res.status ?? null;
  },

  async deleteDocument(documentId: string) {
    await request("DELETE", `/documents/${encodeURIComponent(documentId)}`);
  },

  async documentDownloadUrl(documentId: string) {
    const res = await request<Json>("GET", `/documents/${encodeURIComponent(documentId)}/download`);
    const url = res.url ?? res.download_url ?? res.downloadUrl ?? (res.data as Json | undefined)?.url;
    return typeof url === "string" ? url : null;
  },

  /** Creates an empty chat with a client-generated id; `quick` mode keeps answers fast. */
  async createChat(input: { id: string; tenantId: string; kbId: string; model: string; title: string; subjectId: string }) {
    await request("POST", "/chats/", {
      body: {
        id: input.id,
        tenant_id: input.tenantId,
        knowledge_base_id: input.kbId,
        model: input.model,
        title: input.title,
        agent_mode: "quick",
        external_subject_id: input.subjectId,
      },
    });
    return input.id;
  },

  /** KB-only fast path: one retrieval + answer. With `chatId` the turn is stored in that chat. */
  async fastQuery(input: {
    kbId: string;
    content: string;
    model: string;
    chatId?: string;
    subjectId?: string;
    chunkCount?: number;
    signal?: AbortSignal;
  }) {
    const res = await request<unknown>("POST", "/chats/fast-query", {
      body: {
        knowledge_base_id: input.kbId,
        content: input.content,
        model: input.model,
        chat_id: input.chatId,
        external_subject_id: input.subjectId,
        chunk_count: input.chunkCount ?? 12,
      },
      signal: input.signal,
      timeoutMs: 30_000,
    });
    return { text: pickAnswer(res), raw: res };
  },
};
