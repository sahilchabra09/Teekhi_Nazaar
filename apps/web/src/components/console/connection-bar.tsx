"use client";

import type { ReactNode } from "react";
import type { useRobotConnection } from "@/lib/robot/use-robot-connection";
import { accountServer } from "@/lib/hub/account";
import { useDwell } from "./use-dwell";

/** A connection or media action accepts the same dwell as an action card. */
export function VideoTool({ onSelect, disabled, label, className, children }: {
  onSelect: () => void; disabled?: boolean; label?: string; className: string; children: ReactNode;
}) {
  const { ref, props } = useDwell(onSelect, { disabled });
  return <button type="button" ref={ref} {...props} disabled={disabled} aria-label={label}
    className={`patient-video-tool ${className}`}>
    <span className="dwell-fill" /><span className="relative inline-flex items-center gap-1.5">{children}</span>
  </button>;
}

export function ConnectionBar({ connection }: { connection: ReturnType<typeof useRobotConnection> }) {
  const active = connection.hub !== null;
  const connect = () => {
    if (active) connection.disconnect();
    else connection.connect(accountServer());
  };
  const share = () => {
    if (connection.camera) connection.stopCamera();
    else void connection.openCamera();
  };
  const problem = connection.error || (connection.status === "unauthorized" ? "Sign in again to connect this phone." :
    connection.status === "replaced" ? "Another console has this connection." : null);
  return <>
    {active && <span className="text-xs font-semibold text-white/75" role="status">
      {connection.phone ? "Phone connected" : connection.status === "connected" ? "Waiting for phone" : connection.status}
    </span>}
    <VideoTool onSelect={connect} className="bg-white text-pine">{active ? "Disconnect" : "Connect phone"}</VideoTool>
    {active && connection.status === "connected" && <VideoTool onSelect={share} disabled={connection.cameraBusy} className="bg-white/15 text-white">
      {connection.cameraBusy ? "Opening camera…" : connection.camera ? "Stop sharing" : "Share camera"}
    </VideoTool>}
    {problem && <p role="alert" className="basis-full text-sm text-white">{problem}</p>}
  </>;
}
