"use client";

import type { useRobotConnection } from "@/lib/robot/use-robot-connection";
import { accountServer } from "@/lib/hub/account";

export function ConnectionBar({ connection }: { connection: ReturnType<typeof useRobotConnection> }) {
  const active = connection.hub !== null;
  return (
    <section aria-label="Robot connection" className="clay-sm shrink-0 rounded-3xl px-4 py-3 text-pine">
      <div className="flex flex-wrap items-center gap-3">
        <span className="mr-auto text-sm font-semibold">Sign in with the same Google email on your phone</span>
        <button className="rounded-full bg-pine px-4 py-2 text-sm font-semibold text-white" onClick={() => {
          if (active) connection.disconnect();
          else connection.connect(accountServer());
        }}>{active ? "Disconnect" : "Connect phone"}</button>
        <button className="rounded-full bg-mist px-4 py-2 text-sm font-semibold" disabled={!active || connection.cameraBusy}
          onClick={() => connection.camera ? connection.stopCamera() : void connection.openCamera()}>
          {connection.cameraBusy ? "Opening camera…" : connection.camera ? "Stop sharing my camera" : "Share my camera with phone"}
        </button>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs" aria-live="polite">
          <span>Account: {connection.status}</span>
          <span>Phone: {connection.phone ? "connected" : "offline"}</span>
          <span>Video: {connection.media.state}</span>
          <span>My camera: {connection.camera ? "sharing" : "off"}</span>
        </div>
      </div>
      {connection.error && <p role="alert" className="mt-2 text-sm text-red-700">{connection.error}</p>}
      {connection.status === "unauthorized" && <p role="alert" className="mt-2 text-sm text-red-700">Your account session is unavailable. Sign in again, then disconnect and reconnect here.</p>}
      {connection.status === "replaced" && <p role="alert" className="mt-2 text-sm text-red-700">Another console tab took the web connection. Close it, then disconnect and reconnect here.</p>}
    </section>
  );
}
