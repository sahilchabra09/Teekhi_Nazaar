"use client";

import {
  ArrowLeft,
  Brain,
  Download,
  FileText,
  FileUp,
  Loader2,
  NotebookPen,
  RotateCw,
  Send,
  Sparkles,
  Trash2,
  UserMinus,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Markdown } from "@/components/markdown";
import { ApiError, CATEGORIES, type Category, doctorApi, type MedicalRecord, type PatientDetail } from "@/lib/doctor";

import { CategoryBadge, fieldClass, isSyncing, relativeDate, SyncBadge, textareaClass } from "./ui";

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

export function PatientProfile({ patientId }: { patientId: string }) {
  const router = useRouter();
  const [data, setData] = useState<PatientDetail | null>(null);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await doctorApi.patient(patientId));
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) setNotFound(true);
      else toast.error(errorText(error, "Couldn’t load this patient."));
    }
  }, [patientId]);

  useEffect(() => {
    void load();
  }, [load]);

  // While anything is on its way into the knowledge base, keep the statuses fresh.
  const syncing = data?.records.some((r) => isSyncing(r.syncStatus)) ?? false;
  useEffect(() => {
    if (!syncing) return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [syncing, load]);

  const addRecord = (record: MedicalRecord) => setData((d) => (d ? { ...d, records: [record, ...d.records] } : d));

  async function unassign() {
    if (!data || !window.confirm(`Remove ${data.patient.name} from your patients? Their records stay in their medical memory.`)) return;
    try {
      await doctorApi.removePatient(patientId);
      toast.success("Patient removed from your list");
      router.push("/doctor");
    } catch (error) {
      toast.error(errorText(error, "Couldn’t remove this patient."));
    }
  }

  if (notFound) {
    return (
      <div className="clay mt-10 rounded-[2rem] p-10 text-center">
        <h1 className="font-display text-2xl font-bold text-pine">Patient not found</h1>
        <p className="mt-2 text-pine-soft">This patient isn’t assigned to you.</p>
        <Link href="/doctor" className="mt-6 inline-flex items-center gap-1.5 font-semibold text-teal">
          <ArrowLeft className="size-4" /> Back to your patients
        </Link>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="grid place-items-center py-32 text-pine-soft">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  const { patient, careTeam, records, knowledgeBase } = data;

  return (
    <div>
      <Link href="/doctor" className="inline-flex items-center gap-1.5 text-sm font-semibold text-pine-soft hover:text-pine">
        <ArrowLeft className="size-4" /> Your patients
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <span className="clay-tone tone-teal grid size-16 place-items-center rounded-2xl font-display text-2xl font-bold text-white">
          {patient.name.trim().charAt(0).toUpperCase() || "?"}
        </span>
        <div className="min-w-0">
          <h1 className="truncate font-display text-4xl font-extrabold tracking-tight text-pine">{patient.name}</h1>
          <p className="text-pine-soft">{patient.email}</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <MemoryPill kb={knowledgeBase} />
          <span className="rounded-full bg-white/70 px-3 py-1.5 text-sm text-pine-soft ring-1 ring-pine/10">
            Care team: <span className="font-semibold text-pine">{careTeam.map((d) => `Dr. ${d.name}`).join(", ")}</span>
          </span>
          <button
            onClick={unassign}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold text-pine-soft hover:bg-white hover:text-tomato"
          >
            <UserMinus className="size-4" /> Remove
          </button>
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <NoteComposer patientId={patient.id} onCreated={addRecord} />
          <Timeline records={records} onChange={load} />
        </div>
        <div className="space-y-6">
          <AskPanel patientId={patient.id} patientName={patient.name} />
          <UploadPanel patientId={patient.id} onCreated={addRecord} />
        </div>
      </div>
    </div>
  );
}

function MemoryPill({ kb }: { kb: PatientDetail["knowledgeBase"] }) {
  const ok = kb.autosageConfigured && kb.connected;
  return (
    <span
      title={ok ? "Notes and files sync into this patient’s AutoSage knowledge base." : kb.autosageConfigured ? "The knowledge base is created on the first note or upload." : "AutoSage isn’t configured on the server."}
      className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ${ok ? "bg-teal/15 text-teal" : "bg-honey/25 text-pine"}`}
    >
      <Brain className="size-4" />
      {ok ? "Medical memory connected" : kb.autosageConfigured ? "Memory starts with the first note" : "Memory offline"}
    </span>
  );
}

// ───────────────────────────── note composer ─────────────────────────────

function NoteComposer({ patientId, onCreated }: { patientId: string; onCreated: (r: MedicalRecord) => void }) {
  const [category, setCategory] = useState<Category>("progress");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (body.trim().length < 3) return;
    setSaving(true);
    try {
      const { record } = await doctorApi.addNote(patientId, { category, title: title.trim() || undefined, body: body.trim() });
      onCreated(record);
      setTitle("");
      setBody("");
      toast.success("Note saved. Adding it to the patient’s medical memory.");
    } catch (error) {
      toast.error(errorText(error, "Couldn’t save the note."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="clay rounded-[2rem] p-6">
      <div className="flex items-center gap-2">
        <NotebookPen className="size-5 text-teal" />
        <h2 className="font-display text-xl font-bold text-pine">Write a note</h2>
      </div>
      <p className="mt-1 text-sm text-pine-soft">New medicine, a change in progress, a diagnosis. It’s turned into a document and added to the patient’s medical memory.</p>

      <div className="mt-4 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Note type">
        {CATEGORIES.filter((c) => c.value !== "report").map((c) => (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={category === c.value}
            onClick={() => setCategory(c.value)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
              category === c.value ? "bg-pine text-white" : "bg-white text-pine-soft ring-1 ring-pine/10 hover:text-pine"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" className={`${fieldClass} mt-4`} maxLength={120} />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={
          category === "medication"
            ? "e.g. Started baclofen 10 mg twice daily for spasticity. Review in 2 weeks."
            : "e.g. Gaze control steadier this week; managed 20 minutes of conversation without fatigue."
        }
        className={`${textareaClass} mt-3`}
      />
      <div className="mt-4 flex justify-end">
        <button
          type="submit"
          disabled={saving || body.trim().length < 3}
          className="flex h-11 items-center gap-2 rounded-xl bg-teal px-5 text-sm font-semibold text-white shadow-[0_8px_20px_-8px_rgb(34_120_106/0.6)] transition-colors hover:bg-[#1d6a5e] disabled:opacity-50"
        >
          {saving && <Loader2 className="size-4 animate-spin" />}
          Save note
        </button>
      </div>
    </form>
  );
}

// ───────────────────────────── timeline ─────────────────────────────

function Timeline({ records, onChange }: { records: MedicalRecord[]; onChange: () => void }) {
  return (
    <section className="clay rounded-[2rem] p-6">
      <h2 className="font-display text-xl font-bold text-pine">Medical history</h2>
      {records.length === 0 ? (
        <p className="mt-3 text-pine-soft">No notes or reports yet. Anything you add here becomes part of what IRIS knows about this patient.</p>
      ) : (
        <ol className="mt-4 space-y-3">
          {records.map((r) => (
            <RecordItem key={r.id} record={r} onChange={onChange} />
          ))}
        </ol>
      )}
    </section>
  );
}

function RecordItem({ record, onChange }: { record: MedicalRecord; onChange: () => void }) {
  const [busy, setBusy] = useState<"retry" | "delete" | "download" | null>(null);
  const [expanded, setExpanded] = useState(false);

  async function run(kind: "retry" | "delete" | "download") {
    if (kind === "delete" && !window.confirm(`Delete “${record.title}”? It will also be removed from the patient’s medical memory.`)) return;
    setBusy(kind);
    try {
      if (kind === "retry") {
        await doctorApi.retry(record.id);
        toast("Syncing again…");
      } else if (kind === "delete") {
        await doctorApi.remove(record.id);
        toast.success("Record deleted");
      } else {
        const { url } = await doctorApi.download(record.id);
        window.open(url, "_blank", "noopener");
      }
      onChange();
    } catch (error) {
      toast.error(errorText(error, "That didn’t work."));
    } finally {
      setBusy(null);
    }
  }

  const long = (record.body?.length ?? 0) > 260;

  return (
    <li className="rounded-2xl bg-white/70 p-4 ring-1 ring-pine/8">
      <div className="flex flex-wrap items-center gap-2">
        {record.kind === "file" ? <FileText className="size-4 text-pine-soft" /> : <NotebookPen className="size-4 text-pine-soft" />}
        <span className="font-semibold text-pine">{record.title}</span>
        <CategoryBadge category={record.category} />
        <span className="ml-auto">
          <SyncBadge status={record.syncStatus} error={record.syncError} />
        </span>
      </div>

      {record.body && (
        <p className={`mt-2 text-[15px] leading-relaxed whitespace-pre-wrap text-pine/90 ${!expanded && long ? "line-clamp-3" : ""}`}>{record.body}</p>
      )}
      {long && (
        <button onClick={() => setExpanded((v) => !v)} className="mt-1 text-sm font-semibold text-teal">
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
      {record.kind === "file" && record.fileName && (
        <p className="mt-1 text-sm text-pine-soft">
          {record.fileName}
          {record.sizeBytes ? ` · ${formatBytes(record.sizeBytes)}` : ""}
        </p>
      )}
      {record.syncStatus === "failed" && record.syncError && <p className="mt-2 text-sm text-tomato">{record.syncError}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-pine-soft">
        <span>
          {relativeDate(record.createdAt)}
          {record.authorName ? ` · Dr. ${record.authorName}` : ""}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {(record.syncStatus === "failed" || record.syncStatus === "pending") && (
            <IconButton label="Sync again" busy={busy === "retry"} onClick={() => run("retry")} icon={RotateCw} />
          )}
          {record.kind === "file" && record.autosageDocumentId && (
            <IconButton label="Download" busy={busy === "download"} onClick={() => run("download")} icon={Download} />
          )}
          <IconButton label="Delete" busy={busy === "delete"} onClick={() => run("delete")} icon={Trash2} danger />
        </span>
      </div>
    </li>
  );
}

function IconButton({ label, busy, onClick, icon: Icon, danger }: { label: string; busy: boolean; onClick: () => void; icon: typeof Trash2; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      title={label}
      aria-label={label}
      className={`grid size-8 place-items-center rounded-full transition-colors hover:bg-white ${danger ? "hover:text-tomato" : "hover:text-pine"}`}
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" />}
    </button>
  );
}

// ───────────────────────────── upload ─────────────────────────────

function UploadPanel({ patientId, onCreated }: { patientId: string; onCreated: (r: MedicalRecord) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState<Category>("report");
  const [title, setTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  async function upload() {
    if (!file) return;
    setUploading(true);
    try {
      const { record } = await doctorApi.uploadFile(patientId, file, category, title.trim() || undefined);
      onCreated(record);
      setFile(null);
      setTitle("");
      if (input.current) input.current.value = "";
      toast.success("Uploaded. Adding it to the patient’s medical memory.");
    } catch (error) {
      toast.error(errorText(error, "Upload failed."));
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="clay rounded-[2rem] p-6">
      <div className="flex items-center gap-2">
        <FileUp className="size-5 text-teal" />
        <h2 className="font-display text-xl font-bold text-pine">Upload a report or document</h2>
      </div>

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files[0];
          if (f) setFile(f);
        }}
        className={`mt-4 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-colors ${
          dragging ? "border-teal bg-teal/5" : "border-pine/15 bg-white/60 hover:border-pine/30"
        }`}
      >
        <FileUp className="size-7 text-pine-soft" />
        <span className="mt-2 font-semibold text-pine">{file ? file.name : "Drop a file or click to choose"}</span>
        <span className="mt-0.5 text-xs text-pine-soft">{file ? formatBytes(file.size) : "PDF, Word, Excel, text, CSV, JSON or images · up to 25 MB"}</span>
        <input
          ref={input}
          type="file"
          className="sr-only"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.md,.csv,.json,.png,.jpg,.jpeg,.webp,.tif,.tiff"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </label>

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" className={fieldClass} maxLength={120} />
        <select value={category} onChange={(e) => setCategory(e.target.value as Category)} className={`${fieldClass} w-auto pr-8`} aria-label="Type">
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <button
        onClick={upload}
        disabled={!file || uploading}
        className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-teal text-sm font-semibold text-white transition-colors hover:bg-[#1d6a5e] disabled:opacity-50"
      >
        {uploading && <Loader2 className="size-4 animate-spin" />}
        Upload to medical memory
      </button>
    </section>
  );
}

// ───────────────────────────── ask ─────────────────────────────

function AskPanel({ patientId, patientName }: { patientId: string; patientName: string }) {
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<{ q: string; a: string } | null>(null);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (q.length < 3) return;
    setAsking(true);
    try {
      const { answer: a } = await doctorApi.ask(patientId, q);
      setAnswer({ q, a });
      setQuestion("");
    } catch (error) {
      toast.error(errorText(error, "Couldn’t get an answer."));
    } finally {
      setAsking(false);
    }
  }

  return (
    <section className="clay-tone tone-honey rounded-[2rem] p-6 text-pine">
      <div className="flex items-center gap-2">
        <Sparkles className="size-5" />
        <h2 className="font-display text-xl font-bold">Ask about {patientName.split(" ")[0]}</h2>
      </div>
      <p className="mt-1 text-sm opacity-80">Answers come only from this patient’s notes and reports.</p>

      <form onSubmit={ask} className="mt-4 flex gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="What was the result of the last MRI?"
          className={fieldClass}
        />
        <button
          type="submit"
          disabled={asking || question.trim().length < 3}
          aria-label="Ask"
          className="grid size-11 shrink-0 place-items-center rounded-xl bg-pine text-white transition-opacity disabled:opacity-50"
        >
          {asking ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </button>
      </form>

      {answer && (
        <div className="mt-4 rounded-2xl bg-white/80 p-4">
          <p className="text-sm font-semibold text-pine-soft">{answer.q}</p>
          <Markdown className="mt-1.5">{answer.a}</Markdown>
        </div>
      )}
    </section>
  );
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
