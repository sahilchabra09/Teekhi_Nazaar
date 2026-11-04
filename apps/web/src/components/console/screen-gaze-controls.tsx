"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { ScanEye } from "lucide-react";
import { ScreenDwell, type ScreenSample } from "@/lib/gaze/dwell";

const Workspace = dynamic(() => import("@/lib/gaze/screens/eye-tracking-workspace").then(m => m.EyeTrackingWorkspace), {
  ssr: false,
  loading: () => <p className="p-5" role="status">Opening eye tracker…</p>,
});

export function ScreenGazeControls() {
  const [mode, setMode] = useState<"off" | "setup" | "live">("off");
  const dialog = useRef<HTMLDialogElement>(null);
  const cursor = useRef<HTMLDivElement>(null);
  const latest = useRef<ScreenSample | null>(null);
  const onSample = useCallback((sample: ScreenSample | null) => { latest.current = sample; }, []);

  useEffect(() => {
    if (mode === "setup") dialog.current?.showModal();
    else dialog.current?.close();
    if (mode !== "live") return;
    const dwell = new ScreenDwell();
    // A frame measured during setup cannot start a dwell on the console.
    latest.current = null;
    let raf = 0;
    const pause = () => {
      dwell.leave();
      latest.current = null;
      setMode("setup");
    };
    const visible = () => { if (document.hidden) pause(); };
    const tick = () => {
      const sample = latest.current;
      const age = sample ? performance.now() - sample.time : Infinity;
      const point = cursor.current;
      if (sample && point && age >= 0 && age < 350 && !document.hidden &&
          !document.querySelector('dialog[open], [aria-modal="true"]')) {
        const x = sample.x * window.innerWidth, y = sample.y * window.innerHeight;
        point.hidden = false;
        point.style.left = x + "px";
        point.style.top = y + "px";
        const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-gaze-target]");
        dwell.update(hit && !hit.matches(":disabled,[aria-disabled=true]") ? hit : null, x, y, sample.time);
      } else {
        if (point) point.hidden = true;
        dwell.leave();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    window.addEventListener("blur", pause);
    window.addEventListener("resize", pause);
    document.addEventListener("visibilitychange", visible);
    return () => {
      cancelAnimationFrame(raf);
      dwell.leave();
      latest.current = null;
      window.removeEventListener("blur", pause);
      window.removeEventListener("resize", pause);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [mode]);

  const close = useCallback(() => setMode("off"), []);
  const useTracking = useCallback(() => setMode("live"), []);
  return <>
    <button type="button" aria-haspopup="dialog" onClick={() => setMode("setup")}
      className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold text-pine hover:bg-white">
      <ScanEye className="size-4" />{mode === "live" ? "Gaze active · adjust" : "Set up eye tracking"}
    </button>
    {mode !== "off" && <dialog ref={dialog} aria-label="Screen 1 eye tracking" onCancel={close}
      inert={mode === "live"} aria-hidden={mode === "live" || undefined}
      style={{ display: "block", visibility: mode === "live" ? "hidden" : undefined,
        position: "fixed", inset: 0, width: "100vw", height: "100dvh", maxWidth: "none", maxHeight: "none",
        margin: 0, padding: 0, border: 0 }}>
      <Workspace onSample={onSample} onUse={useTracking} onClose={close}/>
    </dialog>}
    {mode === "live" && <div hidden aria-hidden ref={cursor} className="pointer-events-none fixed z-50 size-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-teal bg-white/40 shadow-sm" />}
  </>;
}
