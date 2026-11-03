/// <reference types="bun" />
import { expect, test } from "bun:test";
import { createAuthClient } from "better-auth/client";
import { authFailureMessage, runAuthAction } from "../src/lib/auth-actions";

for (const action of ["google", "email", "signup", "signout"] as const) {
  test(`${action}: a rejected SDK fetch is handled and controls become retryable`, async () => {
    const client = createAuthClient({
      baseURL: "http://auth.test",
      disableDefaultFetchPlugins: true,
      fetchOptions: { customFetchImpl: async () => { throw new TypeError("Failed to fetch"); } },
    });
    const request = () => {
      if (action === "google") return client.signIn.social({ provider: "google", callbackURL: "http://app.test/" });
      if (action === "email") return client.signIn.email({ email: "test@example.invalid", password: "test-password" });
      if (action === "signup") return client.signUp.email({ name: "Test", email: "test@example.invalid", password: "test-password" });
      return client.signOut();
    };
    let busy = true; const errors: string[] = []; let successes = 0;
    const result = await runAuthAction(request, {
      provider: action === "google" ? "google" : undefined,
      onError: (message) => errors.push(message),
      onSuccess: () => successes++,
      onSettled: () => { busy = false; },
    });
    expect(result).toBe(false); expect(busy).toBe(false); expect(successes).toBe(0);
    expect(errors).toEqual(["Cannot reach the sign-in server. Check your connection and try again."]);
  });
}

test("invalid credentials keep the server's useful validation message", async () => {
  const errors: string[] = []; let settled = 0;
  const result = await runAuthAction(async () => ({ error: { status: 401, message: "Invalid email or password" } }), {
    onError: (message) => errors.push(message), onSettled: () => settled++,
  });
  expect(result).toBe(false); expect(errors).toEqual(["Invalid email or password"]); expect(settled).toBe(1);
});

test("disabled Google, timeouts and server failures have distinct recovery messages", () => {
  expect(authFailureMessage({ status: 404, code: "PROVIDER_NOT_FOUND" }, "google")).toContain("Google sign-in is unavailable");
  expect(authFailureMessage(new DOMException("Request cancelled", "AbortError"))).toContain("timed out");
  expect(authFailureMessage({ status: 503, message: "internal details" })).toBe("The sign-in server is unavailable. Please try again shortly.");
});

test("successful Google initiation completes and releases the pending button", async () => {
  const client = createAuthClient({
    baseURL: "http://auth.test", disableDefaultFetchPlugins: true,
    fetchOptions: { customFetchImpl: async () => Response.json({ url: "https://accounts.google.com/o/oauth2/v2/auth", redirect: true }) },
  });
  const events: string[] = [];
  const result = await runAuthAction(() => client.signIn.social({ provider: "google", callbackURL: "http://app.test/" }), {
    onError: (message) => events.push(message), onSuccess: () => events.push("success"), onSettled: () => events.push("settled"),
  });
  expect(result).toBe(true); expect(events).toEqual(["success", "settled"]);
});
