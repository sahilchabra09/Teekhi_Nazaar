/** Fetch helper for the IRIS server (apps/server). Sends the session cookie, throws ApiError on failure. */

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function serverUrl(path: string) {
  return `${(process.env.NEXT_PUBLIC_SERVER_URL ?? "").replace(/\/$/, "")}${path}`;
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(serverUrl(path), {
      ...rest,
      credentials: "include",
      headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...rest.headers },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError("NETWORK", "Can’t reach the IRIS server. Is it running?", 0);
  }
  const payload = (await response.json().catch(() => null)) as (T & { error?: string; message?: string }) | null;
  if (!response.ok) {
    throw new ApiError(payload?.error ?? `HTTP_${response.status}`, payload?.message ?? "Something went wrong.", response.status);
  }
  return payload as T;
}
