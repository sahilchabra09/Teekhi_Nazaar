import AuthPanel from "@/components/auth-panel";
import { ClayShapes } from "@/components/iris/clay-shapes";
import { IrisWordmark } from "@/components/iris/logo";

export default function LoginPage() {
  return (
    <main className="relative isolate flex min-h-svh items-center overflow-hidden bg-mist">
      <ClayShapes variant="sign-in" />

      <div className="relative mx-auto grid w-full max-w-6xl items-center gap-12 px-5 py-10 lg:grid-cols-[1.1fr_1fr] lg:px-10">
        <section className="max-w-xl">
          <IrisWordmark size={44} />
          <h1 className="mt-8 font-display text-[clamp(2.4rem,5vw,4rem)] leading-[0.95] font-extrabold tracking-[-0.03em] text-pine">
            Your eyes.
            <br />
            Your voice.
            <br />
            Your world.
          </h1>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-pine-soft">
            Steer the IRIS robot and answer the people around it, using only where you look.
          </p>
        </section>

        <div className="flex justify-center lg:justify-end">
          <AuthPanel />
        </div>
      </div>
    </main>
  );
}
