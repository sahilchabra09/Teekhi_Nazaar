"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ScanEye } from "lucide-react";
import { useDwell } from "./use-dwell";
import { ScreenDwell, type ScreenSample } from "@/lib/gaze/dwell";

const Workspace = dynamic(() => import("@/lib/gaze/screens/eye-tracking-workspace").then(m => m.EyeTrackingWorkspace), {
  ssr: false,
  loading: () => <p className="p-5" role="status">Opening eye tracker…</p>,
});

export type PatientMode = "welcome" | "setup" | "live" | "manual";

function hasOpenDialog() {
  return Array.from(document.querySelectorAll('dialog[open], [aria-modal="true"]')).some(
    modal => !modal.closest('dialog:not([open]), [inert], [hidden], [aria-hidden="true"]'),
  );
}

export function ScreenGazeControls({ mode, setMode }: {
  mode: PatientMode;
  setMode: (mode: PatientMode) => void;
}) {
  const [tracking, setTracking] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const cursor = useRef<HTMLDivElement>(null);
  const latest = useRef<ScreenSample | null>(null);
  const onSample = useCallback((sample: ScreenSample | null) => { latest.current = sample; }, []);
  const openSetup = useCallback(() => setMode("setup"), [setMode]);
  const close = useCallback(() => setMode("manual"), [setMode]);
  const useTracking = useCallback(() => setMode("live"), [setMode]);
  const setup = useDwell(openSetup);
  const [dwell] = useState(() => new ScreenDwell());

  useEffect(() => {
    if (mode === "setup") dialog.current?.showModal();
    else dialog.current?.close();
    if (mode !== "live" && mode !== "setup") return;

    const point = cursor.current;
    let raf = 0;
    let focused = document.hasFocus();
    let acceptAfter = performance.now();
    const hide = () => {
      if (point && !point.hidden) {
        point.hidden = true;
        setTracking(false);
      }
      dwell.leave();
    };
    const reset = () => {
      latest.current = null;
      acceptAfter = performance.now();
      hide();
    };
    const blur = () => { focused = false; reset(); };
    const focus = () => { focused = document.hasFocus(); reset(); };
    const visible = () => { if (document.hidden) blur(); else focus(); };
    const tick = () => {
      const sample = latest.current;
      const age = sample ? performance.now() - sample.time : Infinity;
      if (focused && !document.hidden && sample && sample.time >= acceptAfter &&
          age >= 0 && age < 350 && (mode === "setup" || !hasOpenDialog())) {
        const x = sample.x * window.innerWidth, y = sample.y * window.innerHeight;
        if (point) {
          if (point.hidden) {
            point.hidden = false;
            setTracking(true);
          }
          point.style.left = x + "px";
          point.style.top = y + "px";
        }
        // Only the validated handoff button accepts gaze inside setup.
        const selector = mode === "setup" ? "[data-gaze-continue]" : "[data-gaze-target]";
        const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>(selector);
        dwell.update(hit && !hit.matches(":disabled,[aria-disabled=true]") ? hit : null, x, y, sample.time);
      } else {
        hide();
      }
      raf = requestAnimationFrame(tick);
    };
    setTracking(false);
    raf = requestAnimationFrame(tick);
    window.addEventListener("blur", blur);
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", visible);
    return () => {
      cancelAnimationFrame(raf);
      dwell.leave();
      latest.current = null;
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [mode, dwell]);

  const active = mode === "live";
  return <>
    <span role="status" className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-pine-soft">
      <span aria-hidden className={`size-2 rounded-full ${active && tracking ? "bg-teal" : "bg-pine/30"}`} />
      {active ? tracking ? "Gaze active" : "Finding gaze" : "Gaze off"}
    </span>
    <button ref={setup.ref} {...setup.props} type="button" aria-haspopup="dialog" aria-expanded={mode === "setup"}
      className="patient-tool">
      <span className="dwell-fill" /><ScanEye aria-hidden className="relative size-5" /><span className="relative">Setup</span>
    </button>
    {(active || mode === "setup") && createPortal(<>
      <dialog ref={dialog} aria-label="Screen 1 eye tracking" onCancel={close}
        style={{ position: "fixed", inset: 0, width: "100vw", height: "100dvh", maxWidth: "none",
          maxHeight: "none", margin: 0, padding: 0, border: 0 }}>
        <Workspace controlling={active} onSetupRequired={openSetup} onSample={onSample} onUse={useTracking} onClose={close}/>
      </dialog>
      {active && <div hidden aria-hidden ref={cursor} className="pointer-events-none fixed z-50 size-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-teal bg-white/40 shadow-sm" />}
    </>, document.body)}
  </>;
}
