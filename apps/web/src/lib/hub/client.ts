import type { HubClient, HubMessage } from "../rtc/robot-stream";

export type HubState = "connecting" | "connected" | "reconnecting" | "disconnected" | "replaced";
export interface ApplicationHub extends HubClient { close(): void }

export function hubWebSocketUrl(address: string): URL {
  const raw = address.trim();
  if (!raw) throw new Error("Enter the media hub address");
  const url = new URL(raw.includes("://") ? raw : `http://${raw}`);
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol) || url.username || url.password) throw new Error("Use an HTTP or WebSocket hub URL without credentials");
  if (!["/", "/ws"].includes(url.pathname)) throw new Error("The hub address must point to / or /ws");
  if (!raw.includes("://") && !url.port) url.port = "3000";
  url.protocol = ["https:", "wss:"].includes(url.protocol) ? "wss:" : "ws:";
  url.pathname = "/ws"; url.search = "role=web"; url.hash = "";
  return url;
}

/** Console hub transport. Browser cookies accompany the connection;
 * the backend must authenticate them and authorize the phone/session being paired. */
export function createApplicationHub(address: string, changed: (state: HubState) => void): ApplicationHub {
  const url = hubWebSocketUrl(address);
  const handlers = new Map<string, Set<(message: HubMessage) => void>>();
  let socket: WebSocket | null = null;
  let stopped = false;
  let attempts = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let peers: HubMessage | null = null;
  const emit = (message: HubMessage) => {
    if (message.type === "peer_status") peers = message;
    handlers.get(message.type)?.forEach((callback) => callback(message));
  };
  const connect = () => {
    if (stopped) return;
    changed(attempts ? "reconnecting" : "connecting");
    let ws: WebSocket;
    try { ws = new WebSocket(url); }
    catch { changed("disconnected"); return; }
    socket = ws;
    ws.onopen = () => {
      if (stopped || socket !== ws) return;
      attempts = 0;
      ws.send(JSON.stringify({ type: "hello", role: "web", version: 1, ts: Date.now() }));
      changed("connected");
    };
    ws.onmessage = ({ data }) => {
      if (stopped || socket !== ws || typeof data !== "string" || data.length > 2_000_000) return;
      try {
        const message: unknown = JSON.parse(data);
        if (message && typeof message === "object" && "type" in message && typeof message.type === "string") emit(message as HubMessage);
      } catch { /* Ignore malformed messages without breaking the session. */ }
    };
    ws.onerror = () => ws.close();
    ws.onclose = (event) => {
      if (stopped || socket !== ws) return;
      emit({ type: "peer_status", phone: false, web: false, ts: Date.now() });
      // Do not fight another console tab for the single web role.
      if (event.code === 4001 || event.code === 1008) { stopped = true; changed("replaced"); return; }
      changed("reconnecting");
      retry = setTimeout(connect, Math.min(500 * 2 ** attempts++, 30_000));
    };
  };
  connect();
  return {
    send(message) {
      if (stopped || socket?.readyState !== WebSocket.OPEN) throw new Error("Media hub is disconnected");
      if (socket.bufferedAmount > 1_000_000) throw new Error("Media hub is busy; try again");
      socket.send(JSON.stringify(message));
    },
    on(type, callback) {
      const callbacks = handlers.get(type) ?? new Set();
      callbacks.add(callback); handlers.set(type, callbacks);
      // Effects may subscribe after the socket opened. Do not lose initial presence.
      const snapshot = peers;
      if (type === "peer_status" && snapshot) queueMicrotask(() => {
        if (!stopped && callbacks.has(callback) && peers === snapshot) callback(snapshot);
      });
      return () => { callbacks.delete(callback); };
    },
    close() {
      if (retry) clearTimeout(retry);
      stopped = true; socket?.close();
      emit({ type: "peer_status", phone: false, web: false, ts: Date.now() });
      changed("disconnected"); handlers.clear();
    },
  };
}
