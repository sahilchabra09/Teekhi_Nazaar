"use client";

import { useEffect, useState } from "react";
import type { useRobotConnection } from "@/lib/robot/use-robot-connection";

export function ConnectionBar({ connection }: { connection: ReturnType<typeof useRobotConnection> }) {
  const [address, setAddress] = useState(process.env.NEXT_PUBLIC_ROBOT_HUB_URL || process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3000");
  useEffect(() => {
    try { const saved = localStorage.getItem("iris-media-hub"); if (saved) setAddress(saved); } catch { /* Storage may be unavailable. */ }
  }, []);
  const active = connection.hub !== null;
  return (
    <section aria-label="Robot connection" className="shrink-0 rounded-2xl bg-white/85 px-4 py-3 text-pine shadow-sm ring-1 ring-pine/5">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex min-w-48 flex-1 items-center gap-2 text-sm font-semibold">Media hub
          <input value={address} onChange={(event) => setAddress(event.target.value)} disabled={active}
            placeholder="http://localhost:3000" className="min-w-0 flex-1 rounded-lg border border-pine/15 bg-mist/40 px-3 py-2 font-normal" />
        </label>
        <button className="rounded-full bg-pine px-4 py-2 text-sm font-semibold text-white" onClick={() => {
          if (active) connection.disconnect();
          else connection.connect(address);
        }}>{active ? "Disconnect" : "Connect phone"}</button>
        <button className="rounded-full bg-mist px-4 py-2 text-sm font-semibold" disabled={!active || connection.cameraBusy}
          onClick={() => connection.camera ? connection.stopCamera() : void connection.openCamera()}>
          {connection.cameraBusy ? "Opening camera…" : connection.camera ? "Stop sharing my camera" : "Share my camera with phone"}
        </button>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs" aria-live="polite">
          <span>Hub: {connection.status}</span>
          <span>Phone: {connection.phone ? "connected" : "offline"}</span>
          <span>Video: {connection.media.state}</span>
          <span>My camera: {connection.camera ? "sharing" : "off"}</span>
        </div>
      </div>
      {connection.error && <p role="alert" className="mt-2 text-sm text-red-700">{connection.error}</p>}
      {connection.status === "replaced" && <p role="alert" className="mt-2 text-sm text-red-700">Another console tab took the web connection. Close it, then disconnect and reconnect here.</p>}
    </section>
  );
}
