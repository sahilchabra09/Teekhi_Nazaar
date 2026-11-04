"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { inputError, readInput, requestInput, saveInput, type InputKind } from "@/lib/media-inputs";
import { listMicrophones } from "@/lib/talk/recorder";

export const readSavedMic = () => readInput("microphone");

type PickerProps = {
  value: string;
  onChange: (id: string) => void;
  refreshKey?: string | number;
  disabled?: boolean;
};

export function MicPicker({ onChange, ...props }: PickerProps) {
  return <DevicePicker {...props} kind="microphone" onChange={(id) => {
    saveInput("microphone", id);
    onChange(id);
  }} />;
}

export function DevicePicker({ kind, value, onChange, refreshKey, disabled }: PickerProps & { kind: InputKind }) {
  const id = useId();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);
  const generation = useRef(0);
  const requesting = useRef(false);
  const isMic = kind === "microphone";

  const refresh = useCallback(async (askPermission = false) => {
    const request = ++generation.current;
    requesting.current = askPermission;
    setScanning(askPermission);
    let temporary: MediaStream | undefined;
    try {
      if (!navigator.mediaDevices?.enumerateDevices) throw new Error("Open the dashboard on HTTPS or localhost to list devices.");
      if (askPermission) {
        temporary = await requestInput({ audio: isMic, video: !isMic });
      }
      if (request !== generation.current) return;
      const inputs = isMic ? await listMicrophones() :
        (await navigator.mediaDevices.enumerateDevices()).filter((item) => item.kind === "videoinput");
      if (request !== generation.current) return;
      setDevices(inputs.filter((input) => input.deviceId && input.deviceId !== "default"));
      setError("");
    } catch (cause) {
      if (request === generation.current) setError(inputError(kind, cause));
    } finally {
      temporary?.getTracks().forEach((track) => track.stop());
      if (request === generation.current) {
        requesting.current = false;
        setScanning(false);
      }
    }
  }, [isMic, kind]);

  useEffect(() => {
    const discovered = () => { if (!requesting.current) void refresh(); };
    discovered();
    navigator.mediaDevices?.addEventListener?.("devicechange", discovered);
    return () => {
      generation.current++;
      requesting.current = false;
      navigator.mediaDevices?.removeEventListener?.("devicechange", discovered);
    };
  }, [refresh, refreshKey]);

  const label = isMic ? "Microphone" : "Shared camera";
  const missing = value && !devices.some((device) => device.deviceId === value);
  const hasNames = devices.some((device) => device.label);
  return <div>
    <label htmlFor={id} className="block text-sm font-bold text-pine">{label}</label>
    <p id={id + "-hint"} className="mt-1 text-sm leading-snug text-pine-soft">
      {isMic ? "Used by Say something on this computer." : "Local video shown on the paired phone when you share your camera."}
    </p>
    <div className="mt-2 flex flex-wrap gap-2">
      <select id={id} value={value} disabled={disabled || scanning} aria-describedby={id + "-hint"}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 min-w-0 flex-1 rounded-xl border border-pine/20 bg-white px-3 text-sm text-pine focus-visible:outline-2 focus-visible:outline-teal disabled:opacity-60">
        <option value="">Default {kind}</option>
        {missing && <option value={value}>Saved {kind} (unlisted)</option>}
        {devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>
          {device.label || `${isMic ? "Microphone" : "Camera"} ${index + 1}`}
        </option>)}
      </select>
      <button type="button" disabled={disabled || scanning} onClick={() => void refresh(!hasNames)}
        className="min-h-11 rounded-xl bg-mist px-3 text-sm font-semibold text-teal hover:bg-teal/10 focus-visible:outline-2 focus-visible:outline-teal disabled:opacity-60">
        {scanning ? "Searching…" : isMic ? "Find microphones" : "Find cameras"}
      </button>
    </div>
    {missing && !error && <p className="mt-1 text-xs text-pine-soft">Reconnect the saved {kind}, find devices, or choose the default.</p>}
    {error && <p role="alert" className="mt-1 text-sm text-red-700">{error}</p>}
  </div>;
}
