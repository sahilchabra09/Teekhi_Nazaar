"use client";

import { useEffect, useRef, useState } from "react";
import type { useRobotConnection } from "@/lib/robot/use-robot-connection";
import { accountRequest, accountServer } from "@/lib/hub/account";

type LinkCode = { code: string; expires_at_ms: number; email: string };

export function ConnectionBar({ connection }: { connection: ReturnType<typeof useRobotConnection> }) {
  const [code, setCode] = useState<LinkCode>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [now, setNow] = useState(Date.now);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!code) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [code]);
  useEffect(() => { if (connection.phone) setCode(undefined); }, [connection.phone]);
  const active = connection.hub !== null;
  const link = async () => {
    setBusy(true); setError(undefined); setCode(undefined);
    const controller = new AbortController(); request.current = controller;
    const timer = setTimeout(() => controller.abort(), 15_000);
    try { setCode(await accountRequest<LinkCode>("/api/mobile/link-code", controller.signal)); setNow(Date.now()); }
    catch (cause) { setError(controller.signal.aborted ? "Link request timed out. Try again." : cause instanceof Error ? cause.message : "Could not link phone"); }
    finally { clearTimeout(timer); setBusy(false); }
  };
  return (
    <section aria-label="Robot connection" className="clay-sm shrink-0 rounded-3xl px-4 py-3 text-pine">
      <div className="flex flex-wrap items-center gap-3">
        <span className="mr-auto text-sm font-semibold">Your account · your IRIS</span>
        <button disabled={busy || connection.phone} className="clay-press rounded-full bg-honey px-4 py-2 text-sm font-semibold disabled:opacity-50" onClick={() => void link()}>
          {busy ? "Creating code…" : "Link phone"}
        </button>
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
      {code && <div className="clay-well mt-3 rounded-2xl px-4 py-3 text-sm" aria-live="polite">
        <p>On the phone, enter this laptop’s IP with port <strong>3000</strong>, then enter this code to sign in as <strong>{code.email}</strong>.</p>
        {now < code.expires_at_ms ? <p className="my-2 select-all font-mono text-2xl font-bold tracking-widest">{code.code.slice(0, 4)} {code.code.slice(4, 8)} {code.code.slice(8)}</p> : <p className="font-semibold">Code expired. Click Link phone to create another.</p>}
        <p>One use · expires in {Math.max(0, Math.ceil((code.expires_at_ms - now) / 1000))}s. Only share it with your own phone.</p>
      </div>}
      {(error || connection.error) && <p role="alert" className="mt-2 text-sm text-red-700">{error || connection.error}</p>}
      {connection.status === "unauthorized" && <p role="alert" className="mt-2 text-sm text-red-700">Your account session is unavailable. Sign in again, then disconnect and reconnect here.</p>}
      {connection.status === "replaced" && <p role="alert" className="mt-2 text-sm text-red-700">Another console tab took the web connection. Close it, then disconnect and reconnect here.</p>}
    </section>
  );
}
