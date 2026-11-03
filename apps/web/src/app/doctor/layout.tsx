import { redirect } from "next/navigation";

import { DoctorHeader } from "@/components/doctor/doctor-header";
import { getSessionUser } from "@/lib/session";

/** Doctor area: only signed-in users with the doctor role (patients go to the console). */
export default async function DoctorLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!user.role) redirect("/onboarding");
  if (user.role !== "doctor") redirect("/");

  return (
    <div className="min-h-svh bg-mist">
      <DoctorHeader name={user.name || user.email} />
      <main className="mx-auto w-full max-w-6xl px-5 pt-6 pb-16">{children}</main>
    </div>
  );
}
