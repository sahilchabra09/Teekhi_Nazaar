import { hubWebSocketUrl } from "./address";

export class HubAuthorizationError extends Error {}

/** Use the Better Auth API origin rather than an independently editable media hub. */
export function accountServer() {
  const value = process.env.NEXT_PUBLIC_SERVER_URL;
  if (!value) throw new Error("The sign-in server is not configured");
  return new URL(value).origin;
}

export async function accountRequest<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(new URL(path, accountServer()), {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
    body: "{}", signal: signal ?? AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "The account server is unavailable");
  return body as T;
}

export async function authenticatedHubUrl(address: string, signal: AbortSignal) {
  const url = hubWebSocketUrl(address);
  const ticketUrl = new URL(url);
  ticketUrl.protocol = url.protocol === "wss:" ? "https:" : "http:";
  ticketUrl.pathname = "/api/mobile/web-ticket"; ticketUrl.search = "";
  const response = await fetch(ticketUrl, { method: "POST", credentials: "include", signal,
    headers: { "Content-Type": "application/json" }, body: "{}" });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) throw new HubAuthorizationError("Sign in to the account server before connecting your phone");
  if (!response.ok || typeof body.ticket !== "string") throw new Error("The account server is unavailable");
  url.searchParams.set("ticket", body.ticket);
  return url;
}
