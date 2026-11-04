"use client";

import { Eye, EyeOff, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { broker, BROKER_URL, type BrokerStatus, useBrokerStatus } from "@/lib/mqtt/broker";
import { saveControlSettings, useControlSettings } from "@/lib/mqtt/settings";
import type { useRobotConnection } from "@/lib/robot/use-robot-connection";
import { DevicePicker, MicPicker } from "./mic-picker";

const STATUS_TEXT: Record<BrokerStatus, string> = {
  idle: "Not connected", connecting: "Connecting…", connected: "Connected",
  reconnecting: "Reconnecting…", offline: "Offline", error: "Error",
};

type SettingsProps = {
  open: boolean;
  onClose: () => void;
  reason?: string | null;
  micId: string;
  onMicChange: (id: string) => void;
  micListVersion: number;
  connection: ReturnType<typeof useRobotConnection>;
};

export function ControlSettingsDialog({ open, ...props }: SettingsProps) {
  return open ? <SettingsContents {...props} /> : null;
}

function SettingsContents({ onClose, reason, micId, onMicChange, micListVersion, connection }: Omit<SettingsProps, "open">) {
  const saved = useControlSettings();
  const { status, error } = useBrokerStatus();
  const [password, setPassword] = useState(saved.appliancePassword);
  const [showPassword, setShowPassword] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const passwordField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement;
    element?.showModal();
    if (reason) passwordField.current?.focus();
    return () => {
      element?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [reason]);

  return <dialog ref={dialog} aria-labelledby="dashboard-settings-title"
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100%-2rem))] overflow-y-auto rounded-3xl border-0 bg-white p-0 text-pine shadow-2xl backdrop:bg-pine/45">
    <div className="p-5 sm:p-6">
      <header className="flex items-center justify-between gap-3">
        <h2 id="dashboard-settings-title" className="font-display text-2xl font-bold">Settings</h2>
        <button type="button" onClick={onClose} aria-label="Close settings"
          className="grid size-11 shrink-0 place-items-center rounded-full bg-mist hover:bg-teal/10 focus-visible:outline-2 focus-visible:outline-teal">
          <X aria-hidden className="size-5" />
        </button>
      </header>

      <section aria-labelledby="device-settings-title" className="mt-4 space-y-4">
        <h3 id="device-settings-title" className="text-xs font-bold uppercase tracking-widest text-teal">This computer</h3>
        {connection.phone ? <p className="text-sm text-pine-soft">Listening source: phone microphone</p>
          : <MicPicker value={micId} onChange={onMicChange} refreshKey={micListVersion} />}
        <DevicePicker kind="camera" value={connection.cameraId} disabled={connection.cameraBusy}
          refreshKey={connection.camera?.id} onChange={connection.selectCamera} />
        {connection.cameraBusy && <p role="status" className="text-sm text-pine-soft">Opening camera…</p>}
        {connection.cameraError && <p role="alert" className="text-sm text-red-700">{connection.cameraError}</p>}
      </section>

      <section aria-labelledby="appliance-settings-title" className="mt-5 border-t border-pine/15 pt-4">
        <h3 id="appliance-settings-title" className="text-xs font-bold uppercase tracking-widest text-teal">Hardware</h3>
        {reason && <p className="mt-3 rounded-lg bg-honey/20 px-3 py-2 text-sm font-medium">{reason}</p>}
        <form onSubmit={(event) => {
          event.preventDefault();
          saveControlSettings({ appliancePassword: password });
          toast.success("Appliance password saved");
          onClose();
        }} className="mt-3">
          <label htmlFor="appliance-password" className="text-sm font-bold">Appliance password</label>
          <div className="mt-2 flex flex-wrap gap-2">
            <div className="relative min-w-0 flex-1">
              <input ref={passwordField} id="appliance-password" type={showPassword ? "text" : "password"}
                value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="off"
                className="h-11 w-full rounded-xl border border-pine/20 bg-white px-3 pr-11 text-sm focus-visible:outline-2 focus-visible:outline-teal" />
              <button type="button" onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide appliance password" : "Show appliance password"}
                className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-xl text-pine-soft hover:text-pine focus-visible:outline-2 focus-visible:outline-teal">
                {showPassword ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
              </button>
            </div>
            <button type="submit" className="min-h-11 rounded-xl bg-mist px-3 text-sm font-semibold text-teal hover:bg-teal/10 focus-visible:outline-2 focus-visible:outline-teal">Save password</button>
          </div>
        </form>
        <p className="mt-2 text-xs text-pine-soft">Configure the robot driving password on the paired phone.</p>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-xl bg-mist/60 px-3 py-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold" role="status">MQTT · {STATUS_TEXT[status]}</p>
            <p className="break-all text-xs text-pine-soft">{BROKER_URL.replace(/^wss?:\/\//, "")}</p>
          </div>
          <button type="button" onClick={() => broker.reconnect()}
            className="flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-teal hover:bg-white focus-visible:outline-2 focus-visible:outline-teal">
            <RefreshCw aria-hidden className="size-4" />Reconnect
          </button>
        </div>
        {error && status !== "connected" && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      </section>
      <footer className="mt-5 flex justify-end">
        <button type="button" onClick={onClose} className="min-h-11 rounded-xl bg-pine px-5 text-sm font-semibold text-white hover:bg-teal focus-visible:outline-2 focus-visible:outline-teal">Done</button>
      </footer>
    </div>
  </dialog>;
}
