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

export type PatientMode = "welcome" | "setup" | "live" | "preview" | "manual";

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
  const [demoPreview, setDemoPreview] = useState(false);
  const [protectedTarget, setProtectedTarget] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const cursor = useRef<HTMLDivElement>(null);
  const latest = useRef<ScreenSample | null>(null);
  const onSample = useCallback((sample: ScreenSample | null) => { latest.current = sample; }, []);
  const openSetup = useCallback(() => setMode("setup"), [setMode]);
  const close = useCallback(() => setMode("manual"), [setMode]);
  const preview = useCallback((demo: boolean) => { setDemoPreview(demo); setMode("preview"); }, [setMode]);
  const useTracking = useCallback(() => setMode("live"), [setMode]);
  const setup = useDwell(openSetup);
  const [dwell] = useState(() => new ScreenDwell());

  useEffect(() => {
    if (mode === "setup") dialog.current?.showModal();
    else dialog.current?.close();
    if (mode === "manual" || mode === "welcome") return;

    const point = cursor.current;
    const ring = point?.querySelector<SVGCircleElement>("circle");
    let blocked = false;
    const markProtected = (next: boolean) => {
      if (blocked !== next) { blocked = next; setProtectedTarget(next); }
    };
    let raf = 0;
    let focused = document.hasFocus();
    let acceptAfter = performance.now();
    const hide = () => {
      markProtected(false);
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
        const selector = mode === "setup" ? "[data-gaze-continue]" : "[data-gaze-target]";
        const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>(selector);
        const restricted = mode === "preview" && !!hit && !hit.hasAttribute("data-gaze-preview");
        markProtected(restricted);
        const target = hit && !restricted && !hit.matches(":disabled,[aria-disabled=true]") ? hit : null;
        const progress = dwell.update(target, x, y, sample.time);
        ring?.setAttribute("stroke-dashoffset", String(1 - progress));
      } else {
        hide();
      }
      raf = requestAnimationFrame(tick);
    };
    setTracking(false);
    setProtectedTarget(false);
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
  const dashboardCursor = active || mode === "preview";
  return <>
    <span role="status" className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-pine-soft">
      <span aria-hidden className={`size-2 rounded-full ${active && tracking ? "bg-teal" : "bg-pine/30"}`} />
      {mode === "preview" ? protectedTarget ? "Check accuracy to use this control"
        : demoPreview ? "Demo preview · navigation" : tracking ? "Gaze preview · navigation" : "Finding gaze · preview"
        : active ? tracking ? "Gaze active" : "Finding gaze" : "Gaze off"}
    </span>
    <button ref={setup.ref} {...setup.props} data-gaze-preview="" type="button" aria-haspopup="dialog" aria-expanded={mode === "setup"}
      className="patient-tool">
      <span className="dwell-fill" /><ScanEye aria-hidden className="relative size-5" /><span className="relative">Setup</span>
    </button>
    {(dashboardCursor || mode === "setup") && createPortal(<>
      <dialog ref={dialog} aria-label="Screen 1 eye tracking" onCancel={close}
        style={{ position: "fixed", inset: 0, width: "100vw", height: "100dvh", maxWidth: "none",
          maxHeight: "none", margin: 0, padding: 0, border: 0 }}>
        <Workspace mode={mode} onSetupRequired={openSetup} onSample={onSample} onUse={useTracking} onPreview={preview} onClose={close}/>
      </dialog>
      {dashboardCursor && <div hidden aria-hidden ref={cursor} className="pointer-events-none fixed z-50 size-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-teal bg-white/40 shadow-sm">
        <svg viewBox="0 0 32 32" className="absolute -inset-1.5 size-9 -rotate-90 overflow-visible" fill="none">
          <circle cx="16" cy="16" r="14" pathLength="1" stroke="#f4b23e" strokeWidth="4" strokeDasharray="1" strokeDashoffset="1" />
        </svg>
      </div>}
    </>, document.body)}
  </>;
}
