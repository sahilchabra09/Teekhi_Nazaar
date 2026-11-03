"use client";

import { LogOut, Stethoscope } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { IrisWordmark } from "@/components/iris/logo";
import { authClient } from "@/lib/auth-client";

export function DoctorHeader({ name }: { name: string }) {
  const router = useRouter();

  async function signOut() {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-20 border-b border-pine/10 bg-mist/85 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-4 px-5">
        <Link href="/doctor" className="shrink-0">
          <IrisWordmark size={34} />
        </Link>
        <span className="hidden items-center gap-1.5 rounded-full bg-honey/25 px-3 py-1 text-xs font-bold text-pine sm:flex">
          <Stethoscope className="size-3.5" />
          Doctor
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-full bg-teal font-display text-sm font-bold text-white">
            {name.trim().charAt(0).toUpperCase() || "?"}
          </span>
          <span className="hidden max-w-48 truncate text-sm font-semibold text-pine sm:block">Dr. {name}</span>
          <button
            onClick={signOut}
            aria-label="Sign out"
            title="Sign out"
            className="grid size-9 place-items-center rounded-full text-pine-soft transition-colors hover:bg-white hover:text-pine"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
