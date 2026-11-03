export function hubWebSocketUrl(address: string): URL {
  const raw = address.trim();
  if (!raw) throw new Error("Enter the account server address");
  const url = new URL(raw.includes("://") ? raw : `http://${raw}`);
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol) || url.username || url.password) throw new Error("Use an HTTP or WebSocket URL without credentials");
  if (!["/", "/ws"].includes(url.pathname)) throw new Error("The server address must point to / or /ws");
  if (!raw.includes("://") && !url.port) url.port = "3000";
  url.protocol = ["https:", "wss:"].includes(url.protocol) ? "wss:" : "ws:";
  url.pathname = "/ws"; url.search = "role=web"; url.hash = "";
  return url;
}
