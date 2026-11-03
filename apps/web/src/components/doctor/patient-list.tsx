"use client";

import { ChevronRight, FileText, Loader2, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { ApiError, doctorApi, type PatientSummary } from "@/lib/doctor";

import { fieldClass, relativeDate } from "./ui";

export function PatientList() {
  const [patients, setPatients] = useState<PatientSummary[] | null>(null);
  const [email, setEmail] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      setPatients((await doctorApi.patients()).patients);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Couldn’t load your patients.");
      setPatients([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setAdding(true);
    try {
      const { patient } = await doctorApi.addPatient(email.trim());
      toast.success(`${patient.name} added to your patients`);
      setEmail("");
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Couldn’t add that patient.");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="font-display text-4xl font-extrabold tracking-tight text-pine">Your patients</h1>
          <p className="mt-1.5 text-pine-soft">Open a patient to write notes, upload reports, and ask about their history.</p>
        </div>

        <form onSubmit={add} className="flex w-full max-w-md items-center gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Patient’s email"
            aria-label="Patient’s email"
            className={fieldClass}
          />
          <button
            type="submit"
            disabled={adding || !email.trim()}
            className="flex h-11 shrink-0 items-center gap-2 rounded-xl bg-teal px-4 text-sm font-semibold text-white transition-colors hover:bg-[#1d6a5e] disabled:opacity-50"
          >
            {adding ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
            Add patient
          </button>
        </form>
      </div>

      <div className="mt-8">
        {patients === null ? (
          <div className="grid place-items-center py-24 text-pine-soft">
            <Loader2 className="size-6 animate-spin" />
          </div>
        ) : patients.length === 0 ? (
          <div className="clay flex flex-col items-center rounded-[2rem] px-6 py-16 text-center">
            <span className="clay-tone tone-sky grid size-16 place-items-center rounded-2xl text-pine">
              <Users className="size-8" />
            </span>
            <h2 className="mt-5 font-display text-2xl font-bold text-pine">No patients yet</h2>
            <p className="mt-2 max-w-md text-pine-soft">
              Add a patient with the email they signed up with. They need an IRIS account with the “Patient” role first.
            </p>
          </div>
        ) : (
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {patients.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/doctor/patients/${p.id}`}
                  className="clay clay-press group flex h-full flex-col rounded-[2rem] p-6 transition-transform hover:-translate-y-0.5"
                >
                  <div className="flex items-center gap-3">
                    <span className="clay-tone tone-teal grid size-12 shrink-0 place-items-center rounded-2xl font-display text-lg font-bold text-white">
                      {p.name.trim().charAt(0).toUpperCase() || "?"}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-display text-xl font-bold text-pine">{p.name}</span>
                      <span className="block truncate text-sm text-pine-soft">{p.email}</span>
                    </span>
                    <ChevronRight className="ml-auto size-5 shrink-0 text-pine-soft transition-transform group-hover:translate-x-0.5" />
                  </div>
                  <div className="mt-5 flex items-center gap-4 text-sm text-pine-soft">
                    <span className="flex items-center gap-1.5">
                      <FileText className="size-4" />
                      {p.records} {p.records === 1 ? "record" : "records"}
                    </span>
                    <span>{p.lastRecordAt ? `Updated ${relativeDate(p.lastRecordAt)}` : `Added ${relativeDate(p.assignedAt)}`}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
