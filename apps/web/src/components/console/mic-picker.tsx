"use client";

import { Mic } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { listMicrophones } from "@/lib/talk/recorder";

const STORAGE_KEY = "iris.micDeviceId";

export function readSavedMic() {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

/**
 * Small microphone chooser for testing with the laptop mic.
 * (Later the robot phone's mic is used and this goes away.)
 */
export function MicPicker({ value, onChange, refreshKey }: { value: string; onChange: (id: string) => void; refreshKey: number }) {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);

  const refresh = useCallback(async () => {
    try {
      setMics(await listMicrophones());
    } catch {
      setMics([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
    navigator.mediaDevices?.addEventListener?.("devicechange", refresh);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", refresh);
  }, [refresh, refreshKey]);

  const choose = (id: string) => {
    onChange(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* storage blocked: still works for this session */
    }
  };

  return (
    <label className="flex min-w-0 items-center gap-1.5 rounded-full px-2 py-1 text-pine-soft hover:bg-white/60" title="Microphone used for “Say something”">
      <Mic className="size-3.5 shrink-0" />
      <select
        value={value}
        onChange={(e) => choose(e.target.value)}
        className="min-w-0 max-w-40 cursor-pointer truncate bg-transparent text-xs font-medium text-pine-soft outline-none"
      >
        <option value="">Default microphone</option>
        {mics
          .filter((m) => m.deviceId && m.deviceId !== "default")
          .map((m, i) => (
            <option key={m.deviceId} value={m.deviceId}>
              {m.label || `Microphone ${i + 1}`}
            </option>
          ))}
      </select>
    </label>
  );
}
