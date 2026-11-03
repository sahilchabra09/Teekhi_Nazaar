"use client";

import { Eye, EyeOff, KeyRound, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { broker, BROKER_URL, type BrokerStatus, useBrokerStatus } from "@/lib/mqtt/broker";
import { saveControlSettings, useControlSettings } from "@/lib/mqtt/settings";

const STATUS_TEXT: Record<BrokerStatus, string> = {
  idle: "Not connected",
  connecting: "Connecting…",
  connected: "Connected",
  reconnecting: "Reconnecting…",
  offline: "Offline",
  error: "Error",
};

export function brokerDot(status: BrokerStatus) {
  return status === "connected" ? "bg-teal" : status === "connecting" || status === "reconnecting" ? "bg-honey animate-pulse" : "bg-tomato";
}

/** Footer chip: shows the MQTT connection and opens the settings. */
export function ControlsChip({ onOpen }: { onOpen: () => void }) {
  const { status } = useBrokerStatus();
  return (
    <button
      onClick={onOpen}
      title="Robot & appliance controls"
      className="flex min-w-0 items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium text-pine-soft hover:bg-white/60 hover:text-pine"
    >
      <span className={`size-2 shrink-0 rounded-full ${brokerDot(status)}`} />
      <span className="truncate">Controls · {STATUS_TEXT[status].toLowerCase()}</span>
    </button>
  );
}

/** Passwords for the robot and the appliance board + MQTT status. Stored in this browser only. */
export function ControlSettingsDialog({ open, onClose, reason }: { open: boolean; onClose: () => void; reason?: string | null }) {
  const saved = useControlSettings();
  const { status, error } = useBrokerStatus();
  const [robotPassword, setRobotPassword] = useState("");
  const [appliancePassword, setAppliancePassword] = useState("");
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRobotPassword(saved.robotPassword);
    setAppliancePassword(saved.appliancePassword);
    setShow(false);
  }, [open, saved.robotPassword, saved.appliancePassword]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    saveControlSettings({ robotPassword, appliancePassword });
    toast.success("Control passwords saved on this browser");
    onClose();
  };

  const field =
    "h-11 w-full rounded-xl border border-pine/15 bg-white px-3.5 pr-11 text-[15px] text-pine outline-none placeholder:text-pine-soft/60 hover:border-pine/25 focus:border-teal focus:ring-4 focus:ring-teal/15";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-pine/40 p-4 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        onSubmit={save}
        role="dialog"
        aria-modal="true"
        aria-labelledby="controls-title"
        className="w-full max-w-md rounded-[1.75rem] bg-white p-6 shadow-[0_24px_60px_-20px_rgb(18_56_50/0.5)]"
      >
        <div className="flex items-start gap-3">
          <span className="clay-tone tone-honey grid size-11 shrink-0 place-items-center rounded-2xl text-pine">
            <KeyRound className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="controls-title" className="font-display text-xl font-bold text-pine">
              Robot & appliance controls
            </h2>
            <p className="text-sm text-pine-soft">Saved only in this browser and sent inside each command, as the devices expect.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-9 place-items-center rounded-full text-pine-soft hover:bg-mist">
            <X className="size-4" />
          </button>
        </div>

        {reason && <p className="mt-4 rounded-xl bg-honey/20 px-3 py-2 text-sm font-medium text-pine">{reason}</p>}

        <label className="mt-5 block">
          <span className="mb-1.5 block text-[13px] font-semibold text-pine">Robot password</span>
          <div className="relative">
            <input
              type={show ? "text" : "password"}
              value={robotPassword}
              onChange={(e) => setRobotPassword(e.target.value)}
              placeholder="Control password set on the robot"
              autoComplete="off"
              className={field}
            />
            <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide passwords" : "Show passwords"} className="absolute top-1/2 right-2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-pine-soft hover:bg-mist">
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          <span className="mt-1 block text-xs text-pine-soft">Sent to carbot/command when you click the robot video.</span>
        </label>

        <label className="mt-4 block">
          <span className="mb-1.5 block text-[13px] font-semibold text-pine">Appliance password</span>
          <input
            type={show ? "text" : "password"}
            value={appliancePassword}
            onChange={(e) => setAppliancePassword(e.target.value)}
            placeholder="Control password set on the appliance board"
            autoComplete="off"
            className={field}
          />
          <span className="mt-1 block text-xs text-pine-soft">Sent to gazeconnect/appliances/control. A wrong password is ignored by the board.</span>
        </label>

        <div className="mt-5 flex items-center gap-2 rounded-xl bg-mist/60 px-3 py-2.5 text-sm">
          <span className={`size-2.5 shrink-0 rounded-full ${brokerDot(status)}`} />
          <span className="min-w-0 flex-1 truncate text-pine">
            <span className="font-semibold">{STATUS_TEXT[status]}</span>
            <span className="text-pine-soft"> · {BROKER_URL.replace("wss://", "")}</span>
          </span>
          <button type="button" onClick={() => broker.reconnect()} className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-teal hover:bg-white">
            <RefreshCw className="size-3.5" /> Reconnect
          </button>
        </div>
        {error && status !== "connected" && <p className="mt-2 text-sm text-tomato">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-11 rounded-xl px-4 text-sm font-semibold text-pine-soft hover:bg-mist">
            Cancel
          </button>
          <button type="submit" className="h-11 rounded-xl bg-teal px-5 text-sm font-semibold text-white hover:bg-[#1d6a5e]">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
