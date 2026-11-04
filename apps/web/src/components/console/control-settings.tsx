"use client";

import { ChevronDown, ChevronUp, MousePointer2, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { broker, BROKER_URL, type BrokerStatus, useBrokerStatus } from "@/lib/mqtt/broker";
import type { useRobotConnection } from "@/lib/robot/use-robot-connection";
import { DevicePicker, MicPicker, SettingsButton } from "./mic-picker";

const STATUS_TEXT: Record<BrokerStatus, string> = {
  idle: "Not connected", connecting: "Connecting…", connected: "Connected",
  reconnecting: "Reconnecting…", offline: "Offline", error: "Error",
};

type SettingsProps = {
  open: boolean;
  onClose: () => void;
  mouseGaze: boolean;
  onToggleMouseGaze: () => void;
  micId: string;
  onMicChange: (id: string) => void;
  micListVersion: number;
  connection: ReturnType<typeof useRobotConnection>;
};

export function ControlSettingsDialog({ open, ...props }: SettingsProps) {
  return open ? <SettingsContents {...props} /> : null;
}

function SettingsContents({ onClose, mouseGaze, onToggleMouseGaze, micId, onMicChange, micListVersion, connection }: Omit<SettingsProps, "open">) {
  const { status, error } = useBrokerStatus();
  const dialog = useRef<HTMLDialogElement>(null);
  const [scroll, setScroll] = useState({ up: false, down: false });

  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement;
    if (!element) return;
    element.showModal();
    const measure = () => {
      const up = element.scrollTop > 1;
      const down = element.scrollTop + element.clientHeight < element.scrollHeight - 1;
      setScroll((prev) => prev.up === up && prev.down === down ? prev : { up, down });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    element.addEventListener("scroll", measure);
    measure();
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", measure);
      element.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  function scrollPage(direction: number) {
    const element = dialog.current;
    if (element) element.scrollBy(0, direction * Math.max(48, element.clientHeight - 84));
  }

  return <dialog ref={dialog} data-gaze-scope="settings" aria-labelledby="dashboard-settings-title"
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100%-2rem))] overflow-y-auto rounded-3xl border-0 bg-white p-0 text-pine shadow-2xl backdrop:bg-pine/45">
    <div className="p-5 sm:p-6">
      <header className="sticky top-0 z-10 flex items-center gap-1 bg-white py-1">
        <h2 id="dashboard-settings-title" className="mr-auto font-display text-2xl font-bold">Settings</h2>
        {(scroll.up || scroll.down) && <>
          <SettingsButton label="Scroll settings up" disabled={!scroll.up} onSelect={() => scrollPage(-1)}>
            <ChevronUp aria-hidden="true" className="size-5" />
          </SettingsButton>
          <SettingsButton label="Scroll settings down" disabled={!scroll.down} onSelect={() => scrollPage(1)}>
            <ChevronDown aria-hidden="true" className="size-5" />
          </SettingsButton>
        </>}
        <SettingsButton onSelect={onClose} label="Close settings"><X aria-hidden="true" className="size-5" /></SettingsButton>
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
        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-xl bg-mist/60 px-3 py-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold" role="status">MQTT · {STATUS_TEXT[status]}</p>
            <p className="break-all text-xs text-pine-soft">{BROKER_URL.replace(/^wss?:\/\//, "")}</p>
          </div>
          <SettingsButton onSelect={() => broker.reconnect()} className="bg-white text-teal hover:bg-teal/10">
            <RefreshCw aria-hidden="true" className="size-4" />Reconnect
          </SettingsButton>
        </div>
        {error && status !== "connected" && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      </section>
      <section aria-labelledby="input-settings-title" className="mt-4 border-t border-pine/15 pt-3">
        <h3 id="input-settings-title" className="text-xs font-bold uppercase tracking-widest text-teal">Input</h3>
        <p className="my-2 text-sm text-pine-soft">Hover the mouse over a control to try gaze selection.</p>
        <SettingsButton onSelect={onToggleMouseGaze}>
          <MousePointer2 aria-hidden="true" className="size-4" />{mouseGaze ? "Turn off mouse gaze" : "Use mouse gaze"}
        </SettingsButton>
      </section>
      <footer className="mt-4 flex justify-end">
        <SettingsButton onSelect={onClose} className="bg-pine px-5 text-white hover:bg-teal">Done</SettingsButton>
      </footer>
    </div>
  </dialog>;
}
