/// <reference types="bun" />
import { afterEach, expect, mock, test } from "bun:test";
import { createApplicationHub, type HubState } from "../src/lib/hub/client";
import { authenticatedHubUrl } from "../src/lib/hub/account";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; mock.restore(); });
async function until(check: () => boolean) {
  const end = Date.now() + 1500;
  while (!check()) { if (Date.now() > end) throw new Error("Timed out waiting for client"); await Bun.sleep(5); }
}

test("browser credentials are exchanged over HTTP for a socket ticket without putting account secrets in the URL", async () => {
  let seenUrl = "", seenOptions: RequestInit | undefined;
  globalThis.fetch = mock(async (input: string | URL | Request, options?: RequestInit) => {
    seenUrl = String(input); seenOptions = options;
    return Response.json({ ticket: "one-use-ticket" });
  }) as unknown as typeof fetch;
  const url = await authenticatedHubUrl("https://api.example/ws?role=web", new AbortController().signal);
  expect(seenUrl).toBe("https://api.example/api/mobile/web-ticket");
  expect(seenOptions?.credentials).toBe("include");
  expect(seenOptions?.method).toBe("POST");
  expect(url.toString()).toBe("wss://api.example/ws?role=web&ticket=one-use-ticket");
  expect(url.searchParams.has("token")).toBe(false);
});

test("a rejected browser session stops the client without an unauthenticated WebSocket fallback", async () => {
  let requests = 0;
  globalThis.fetch = mock(async () => { requests++; return Response.json({ error: "Unauthorized" }, { status: 401 }); }) as unknown as typeof fetch;
  const states: HubState[] = [];
  const hub = createApplicationHub("http://127.0.0.1:1", (state) => states.push(state));
  try {
    await until(() => states.includes("unauthorized"));
    await Bun.sleep(550);
    expect(requests).toBe(1);
    expect(states).toEqual(["connecting", "unauthorized"]);
    expect(() => hub.send({ type: "speak" })).toThrow();
  } finally { hub.close(); }
});

test("closing during ticket exchange cancels the request and never opens a late socket", async () => {
  let signal: AbortSignal | undefined;
  let complete!: (response: Response) => void;
  globalThis.fetch = mock(async (_input: unknown, options?: RequestInit) => {
    signal = options?.signal ?? undefined;
    return new Promise<Response>((resolve) => { complete = resolve; });
  }) as unknown as typeof fetch;
  const states: HubState[] = [];
  const hub = createApplicationHub("http://127.0.0.1:1", (state) => states.push(state));
  hub.close();
  expect(signal?.aborted).toBe(true);
  complete(Response.json({ ticket: "too-late" }));
  await Bun.sleep(10);
  expect(states).toEqual(["connecting", "disconnected"]);
});

test("a temporary account-server outage retries ticket exchange and still stops on a real authorization rejection", async () => {
  let requests = 0;
  globalThis.fetch = mock(async () => {
    if (++requests === 1) throw new TypeError("Failed to fetch");
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }) as unknown as typeof fetch;
  const states: HubState[] = [];
  const hub = createApplicationHub("http://127.0.0.1:1", (state) => states.push(state));
  try {
    await until(() => states.includes("unauthorized"));
    expect(requests).toBe(2);
    expect(states).toContain("reconnecting");
    expect(states.at(-1)).toBe("unauthorized");
  } finally { hub.close(); }
});
