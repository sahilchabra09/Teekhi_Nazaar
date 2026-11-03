import type { HubClient, HubMessage } from "../rtc/robot-stream";
import { authenticatedHubUrl, HubAuthorizationError } from "./account";
import { hubWebSocketUrl } from "./address";
export { hubWebSocketUrl } from "./address";

export type HubState = "connecting" | "connected" | "reconnecting" | "disconnected" | "replaced" | "unauthorized";
export interface ApplicationHub extends HubClient { close(): void }

/** Better Auth sessions are exchanged for short-lived, single-use WebSocket tickets. */
export function createApplicationHub(address: string, changed: (state: HubState) => void): ApplicationHub {
  const url = hubWebSocketUrl(address);
  const handlers = new Map<string, Set<(message: HubMessage) => void>>();
  let socket: WebSocket | null = null;
  let stopped = false;
  let attempts = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let peers: HubMessage | null = null;
  let pending: AbortController | undefined;
  const emit = (message: HubMessage) => {
    if (message.type === "peer_status") peers = message;
    handlers.get(message.type)?.forEach((callback) => callback(message));
  };
  const connect = async () => {
    if (stopped) return;
    changed(attempts ? "reconnecting" : "connecting");
    let ws: WebSocket;
    pending = new AbortController();
    const timeout = setTimeout(() => pending?.abort(), 15_000);
    try {
      const authenticated = await authenticatedHubUrl(url.toString(), pending.signal);
      if (stopped) return;
      ws = new WebSocket(authenticated);
    } catch (cause) {
      if (!stopped) {
        if (cause instanceof HubAuthorizationError) { stopped = true; changed("unauthorized"); }
        else { changed("reconnecting"); retry = setTimeout(connect, Math.min(500 * 2 ** attempts++, 30_000)); }
      }
      return;
    } finally { clearTimeout(timeout); }
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
      if (event.code === 4001 || event.code === 1008) { stopped = true; changed(event.code === 1008 ? "unauthorized" : "replaced"); return; }
      changed("reconnecting");
      retry = setTimeout(connect, Math.min(500 * 2 ** attempts++, 30_000));
    };
  };
  void connect();
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
      stopped = true; pending?.abort(); socket?.close();
      emit({ type: "peer_status", phone: false, web: false, ts: Date.now() });
      changed("disconnected"); handlers.clear();
    },
  };
}
