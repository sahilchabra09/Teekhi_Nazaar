import { redirect } from "next/navigation";

import { RolePicker } from "@/components/role-picker";
import { ClayShapes } from "@/components/iris/clay-shapes";
import { IrisWordmark } from "@/components/iris/logo";
import { getSessionUser } from "@/lib/session";

export default async function OnboardingPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role) redirect("/");

  return (
    <main className="relative isolate flex min-h-svh items-center overflow-hidden bg-mist">
      <ClayShapes variant="sign-in" />
      <div className="relative mx-auto w-full max-w-4xl px-5 py-12">
        <IrisWordmark size={40} />
        <h1 className="mt-8 font-display text-[clamp(2rem,4vw,3.25rem)] leading-[1.02] font-extrabold tracking-[-0.02em] text-pine">
          Welcome, {user.name.split(" ")[0] || "there"}. How will you use IRIS?
        </h1>
        <p className="mt-3 max-w-xl text-lg text-pine-soft">You choose this once. It decides which dashboard you see and what you can open.</p>
        <RolePicker />
      </div>
    </main>
  );
}
