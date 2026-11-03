"use client";

import { Eye, Loader2, Stethoscope } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import type { Role } from "@/lib/auth-client";

const ROLES: { role: Role; title: string; body: string; icon: typeof Eye; tone: string }[] = [
  {
    role: "patient",
    title: "I’m a patient",
    body: "Steer the IRIS robot and talk with people using your eyes. Your doctors’ notes help IRIS suggest replies.",
    icon: Eye,
    tone: "tone-teal text-white",
  },
  {
    role: "doctor",
    title: "I’m a doctor",
    body: "See your patients, write notes and upload reports. IRIS keeps each patient’s medical memory up to date.",
    icon: Stethoscope,
    tone: "tone-honey text-pine",
  },
];

export function RolePicker() {
  const router = useRouter();
  const [busy, setBusy] = useState<Role | null>(null);

  async function choose(role: Role) {
    setBusy(role);
    try {
      await api("/api/me/role", { method: "POST", json: { role } });
      router.replace("/");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Couldn’t save your role. Try again.");
      setBusy(null);
    }
  }

  return (
    <div className="mt-10 grid gap-6 sm:grid-cols-2">
      {ROLES.map(({ role, title, body, icon: Icon, tone }) => (
        <button
          key={role}
          onClick={() => choose(role)}
          disabled={busy !== null}
          className={`clay-tone clay-press flex min-h-64 flex-col items-start justify-between rounded-[2.25rem] p-7 text-left disabled:opacity-70 ${tone}`}
        >
          <span className="grid size-16 place-items-center rounded-2xl bg-white/25 shadow-[inset_2px_3px_6px_rgb(255_255_255/0.5),inset_-2px_-3px_6px_rgb(0_0_0/0.1)]">
            {busy === role ? <Loader2 className="size-8 animate-spin" /> : <Icon className="size-8" strokeWidth={2.25} />}
          </span>
          <span>
            <span className="block font-display text-3xl font-extrabold">{title}</span>
            <span className="mt-2 block text-[15px] leading-relaxed font-medium opacity-85">{body}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
