import { AlertTriangle, CheckCircle2, CircleDashed, Loader2, UploadCloud } from "lucide-react";

import type { Category, SyncStatus } from "@/lib/doctor";

/** Flat input style (no clay depth on inputs). */
export const fieldClass =
  "h-11 w-full rounded-xl border border-pine/15 bg-white px-3.5 text-[15px] text-pine outline-none transition-[border-color,box-shadow] placeholder:text-pine-soft/60 hover:border-pine/25 focus:border-teal focus:ring-4 focus:ring-teal/15 focus-visible:outline-none";

export const textareaClass = fieldClass.replace("h-11", "min-h-36 py-3 leading-relaxed resize-y");

export function relativeDate(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.round(h / 24);
  if (days < 7) return `${days} d ago`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

const CATEGORY_TONE: Record<Category, string> = {
  medication: "bg-honey/30 text-pine",
  progress: "bg-teal/15 text-teal",
  diagnosis: "bg-tomato/15 text-tomato",
  report: "bg-sky/35 text-pine",
  general: "bg-pine/8 text-pine-soft",
};

export function CategoryBadge({ category }: { category: Category }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold capitalize ${CATEGORY_TONE[category]}`}>{category}</span>
  );
}

/** Where a record is on its way into the patient's AutoSage knowledge base. */
export function SyncBadge({ status, error }: { status: SyncStatus; error: string | null }) {
  const map: Record<SyncStatus, { label: string; icon: React.ReactNode; className: string }> = {
    pending: { label: "Waiting to sync", icon: <CircleDashed className="size-3.5" />, className: "bg-pine/8 text-pine-soft" },
    uploading: { label: "Uploading", icon: <UploadCloud className="size-3.5" />, className: "bg-sky/30 text-pine" },
    queued: { label: "Indexing", icon: <Loader2 className="size-3.5 animate-spin" />, className: "bg-sky/30 text-pine" },
    processing: { label: "Indexing", icon: <Loader2 className="size-3.5 animate-spin" />, className: "bg-sky/30 text-pine" },
    processed: { label: "In memory", icon: <CheckCircle2 className="size-3.5" />, className: "bg-teal/15 text-teal" },
    failed: { label: "Sync failed", icon: <AlertTriangle className="size-3.5" />, className: "bg-tomato/15 text-tomato" },
  };
  const s = map[status];
  return (
    <span title={error ?? undefined} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${s.className}`}>
      {s.icon}
      {s.label}
    </span>
  );
}

export const isSyncing = (s: SyncStatus) => s === "uploading" || s === "queued" || s === "processing";
