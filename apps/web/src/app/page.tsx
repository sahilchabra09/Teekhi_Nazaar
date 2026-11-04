import { redirect } from "next/navigation";

import Console from "@/components/console/console";
import { getSessionUser } from "@/lib/session";

/** Entry point: sends each role to its own dashboard (docs/care.md §2). */
export default async function HomePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!user.role) redirect("/onboarding");
  if (user.role === "doctor") redirect("/doctor");

  const appliancePassword = process.env.APPLIANCE_CONTROL_PASSWORD ?? "";
  return <Console userName={user.name || user.email} appliancePassword={appliancePassword} />;
}
