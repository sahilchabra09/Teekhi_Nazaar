import { inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

function getServerUrl(url: string) {
  const processEnv = typeof process === "undefined" ? undefined : process.env;
  if (typeof window === "undefined" && processEnv?.SERVER_URL) {
    return processEnv.SERVER_URL.endsWith("/")
      ? processEnv.SERVER_URL.slice(0, -1)
      : processEnv.SERVER_URL;
  }

  return url.endsWith("/") ? url.slice(0, -1) : url;
}

export const authClient = createAuthClient({
  baseURL: new URL("/api/auth", getServerUrl(process.env.NEXT_PUBLIC_SERVER_URL!)).toString(),
  fetchOptions: { credentials: "include", timeout: 15_000 },
  // RBAC: the user row carries `role` ("patient" | "doctor" | null), see packages/auth.
  plugins: [inferAdditionalFields({ user: { role: { type: "string", required: false, input: false } } })],
});

export type Role = "patient" | "doctor";
