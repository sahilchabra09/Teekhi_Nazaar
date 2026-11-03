"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import z from "zod";

import { authClient } from "@/lib/auth-client";

type Mode = "sign-in" | "sign-up";

const signInSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(8, "Password needs at least 8 characters"),
});
const signUpSchema = signInSchema.extend({
  name: z.string().trim().min(2, "Enter your name"),
});

export default function AuthPanel() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [values, setValues] = useState({ name: "", email: "", password: "" });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof values, string>>>({});
  const [busy, setBusy] = useState<"email" | "google" | null>(null);

  const set = (key: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setValues((v) => ({ ...v, [key]: e.target.value }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = (mode === "sign-up" ? signUpSchema : signInSchema).safeParse(values);
    if (!parsed.success) {
      const next: typeof errors = {};
      for (const issue of parsed.error.issues) next[issue.path[0] as keyof typeof values] ??= issue.message;
      setErrors(next);
      return;
    }

    setBusy("email");
    const handlers = {
      onSuccess: () => {
        toast.success(mode === "sign-up" ? "Account created" : "Signed in");
        router.push("/");
        router.refresh();
      },
      onError: (ctx: { error: { message?: string; statusText?: string } }) => {
        toast.error(ctx.error.message || ctx.error.statusText || "Couldn't reach the server. Is it running?");
      },
    };
    if (mode === "sign-up") {
      await authClient.signUp.email(
        { name: values.name.trim(), email: values.email, password: values.password },
        handlers,
      );
    } else {
      await authClient.signIn.email({ email: values.email, password: values.password }, handlers);
    }
    setBusy(null);
  }

  async function google() {
    setBusy("google");
    const origin = window.location.origin;
    const { error } = await authClient.signIn.social({
      provider: "google",
      callbackURL: `${origin}/`,
      errorCallbackURL: `${origin}/login`,
    });
    if (error) {
      toast.error(
        error.status === 404 || /provider/i.test(error.message ?? "")
          ? "Google sign-in isn't set up yet. Add the keys from docs/google.md."
          : error.message || "Google sign-in failed",
      );
      setBusy(null);
    }
  }

  return (
    <div className="w-full max-w-[400px] rounded-[1.75rem] bg-white/90 p-7 shadow-[0_1px_2px_rgb(18_56_50/0.06),0_24px_48px_-16px_rgb(18_56_50/0.22)] ring-1 ring-pine/5 backdrop-blur-sm sm:p-8">
      <h2 className="font-display text-2xl font-bold text-pine">
        {mode === "sign-in" ? "Welcome back" : "Create your account"}
      </h2>
      <p className="mt-1 text-sm text-pine-soft">
        {mode === "sign-in" ? "New to IRIS? " : "Already have an account? "}
        <button
          type="button"
          onClick={() => {
            setMode(mode === "sign-in" ? "sign-up" : "sign-in");
            setErrors({});
          }}
          className="font-semibold text-teal underline-offset-4 hover:underline"
        >
          {mode === "sign-in" ? "Create an account" : "Sign in"}
        </button>
      </p>

      <button
        type="button"
        onClick={google}
        disabled={busy !== null}
        className="mt-6 flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-pine/15 bg-white text-[15px] font-semibold text-pine transition-colors hover:bg-mist/40 disabled:opacity-60"
      >
        {busy === "google" ? <Loader2 className="size-5 animate-spin" /> : <GoogleG />}
        Continue with Google
      </button>

      <div className="my-5 flex items-center gap-3 text-xs font-medium text-pine-soft">
        <span className="h-px flex-1 bg-pine/10" />
        or
        <span className="h-px flex-1 bg-pine/10" />
      </div>

      <form onSubmit={submit} noValidate className="space-y-3.5">
        {mode === "sign-up" && (
          <Field label="Name" error={errors.name}>
            <input autoComplete="name" value={values.name} onChange={set("name")} className={inputClass(errors.name)} />
          </Field>
        )}
        <Field label="Email" error={errors.email}>
          <input
            type="email"
            autoComplete="email"
            value={values.email}
            onChange={set("email")}
            className={inputClass(errors.email)}
          />
        </Field>
        <Field label="Password" error={errors.password}>
          <input
            type="password"
            autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
            value={values.password}
            onChange={set("password")}
            className={inputClass(errors.password)}
          />
        </Field>

        <button
          type="submit"
          disabled={busy !== null}
          className="!mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-teal text-[15px] font-semibold text-white shadow-[0_8px_20px_-8px_rgb(34_120_106/0.6)] transition-colors hover:bg-[#1d6a5e] disabled:opacity-60"
        >
          {busy === "email" && <Loader2 className="size-4 animate-spin" />}
          {mode === "sign-up" ? "Create account" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

const inputClass = (error?: string) =>
  `h-11 w-full rounded-xl border bg-white px-3.5 text-[15px] text-pine outline-none transition-[border-color,box-shadow] focus-visible:outline-none ${
    error
      ? "border-tomato/70 focus:ring-4 focus:ring-tomato/15"
      : "border-pine/15 hover:border-pine/25 focus:border-teal focus:ring-4 focus:ring-teal/15"
  }`;

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-semibold text-pine">{label}</span>
      {children}
      {error && <span className="mt-1 block text-[13px] text-tomato">{error}</span>}
    </label>
  );
}

function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" className="size-5" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
