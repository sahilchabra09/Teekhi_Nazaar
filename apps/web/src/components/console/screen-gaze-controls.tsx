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

export type PatientMode = "welcome" | "setup" | "live" | "preview" | "manual" | "mouse";

function hasOpenDialog() {
  return Array.from(document.querySelectorAll('dialog[open], [aria-modal="true"]')).some(
    modal => !modal.closest('dialog:not([open]), [inert], [hidden], [aria-hidden="true"]'),
  );
}

export function ScreenGazeControls({ mode, setMode, settingsOpen, onTrackingLost }: {
  mode: PatientMode;
  settingsOpen: boolean;
  onTrackingLost: () => void;
  setMode: (mode: PatientMode) => void;
}) {
  const [tracking, setTracking] = useState(false);
  const [demoPreview, setDemoPreview] = useState(false);
  const [inputHint, setInputHint] = useState("");
  const [cursorHost, setCursorHost] = useState<Element | null>(null);
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
    if (mode === "manual" || mode === "welcome") {
      setInputHint("");
      setTracking(false);
      return;
    }

    const settings = settingsOpen ? document.querySelector('dialog[data-gaze-scope="settings"]') : null;
    setCursorHost(settings ?? document.body);
    let hint = "";
    const showHint = (next: string) => {
      if (next !== hint) { hint = next; setInputHint(next); }
    };
    let mouse: { x: number; y: number } | null = null;
    let lastEyeFrame: number | null = null;
    let raf = 0;
    let focused = document.hasFocus();
    let acceptAfter = performance.now();
    const hide = () => {
      showHint("");
      const point = cursor.current;
      if (point && !point.hidden) {
        point.hidden = true;
        setTracking(false);
      }
      dwell.leave();
    };
    const reset = () => {
      latest.current = null;
      mouse = null;
      lastEyeFrame = null;
      acceptAfter = performance.now();
      hide();
    };
    const blur = () => { focused = false; reset(); };
    const focus = () => { focused = document.hasFocus(); reset(); };
    const visible = () => { if (document.hidden) blur(); else focus(); };
    const tick = () => {
      const now = performance.now();
      const sample = mode === "mouse"
        ? mouse && { x: mouse.x / window.innerWidth, y: mouse.y / window.innerHeight, time: now }
        : latest.current;
      const age = sample ? now - sample.time : Infinity;
      if (mode === "live" && !settingsOpen && focused && !document.hidden) {
        if (sample && sample.time >= acceptAfter && age >= 0 && age < 350) lastEyeFrame = sample.time;
        else if (lastEyeFrame !== null && now - lastEyeFrame >= 350) {
          lastEyeFrame = null;
          onTrackingLost();
        }
      }
      const settingsVisible = settings?.matches("dialog[open]") === true;
      if (focused && !document.hidden && sample && sample.time >= acceptAfter && age >= 0 && age < 350 &&
          (settingsOpen ? settingsVisible : mode === "setup" || !hasOpenDialog())) {
        const x = sample.x * window.innerWidth, y = sample.y * window.innerHeight;
        const point = cursor.current;
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
        const target = hit && (!settingsVisible || settings?.contains(hit)) ? hit : null;
        const disabled = target?.matches(":disabled,[aria-disabled=true]") === true;
        const restricted = mode === "preview" && !!target && !target.hasAttribute("data-gaze-preview");
        showHint(disabled ? target?.dataset.gazeUnavailable ?? "Control unavailable"
          : restricted ? "Check accuracy in Setup to use this control" : "");
        const progress = dwell.update(target, x, y, sample.time, !restricted && !disabled);
        point?.querySelector("circle")?.setAttribute("stroke-dashoffset", String(1 - progress));
      } else {
        hide();
      }
      raf = requestAnimationFrame(tick);
    };
    // A mouse is an explicit, operator-controlled input. A stationary pointer
    // keeps dwelling; after a blur, click, or leaving the page, require fresh input.
    const move = (event: PointerEvent) => {
      if (event.isPrimary && event.pointerType === "mouse" && !event.buttons) {
        mouse = { x: event.clientX, y: event.clientY };
      } else if (mouse) reset();
    };
    const out = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.relatedTarget === null) {
        reset();
        onTrackingLost();
      }
    };
    if (mode === "mouse") {
      document.addEventListener("pointermove", move, true);
      document.addEventListener("pointerout", out, true);
      document.addEventListener("pointerdown", reset, true);
      document.addEventListener("pointercancel", reset, true);
    }
    setTracking(false);
    setInputHint("");
    raf = requestAnimationFrame(tick);
    window.addEventListener("blur", blur);
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", visible);
    return () => {
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerout", out, true);
      document.removeEventListener("pointerdown", reset, true);
      document.removeEventListener("pointercancel", reset, true);
      cancelAnimationFrame(raf);
      dwell.leave();
      latest.current = null;
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [mode, dwell, settingsOpen, onTrackingLost]);

  const active = mode === "live";
  const workspaceOpen = active || mode === "preview" || mode === "setup";
  const dashboardCursor = active || mode === "preview" || mode === "mouse";
  return <>
    <span role="status" className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-pine-soft">
      <span aria-hidden className={`size-2 rounded-full ${active && tracking ? "bg-teal" : "bg-pine/30"}`} />
      {inputHint || (mode === "mouse" ? "Mouse gaze" : mode === "preview" ? demoPreview ? "Demo preview · navigation" : tracking ? "Gaze preview · navigation" : "Finding gaze · preview"
        : active ? tracking ? "Gaze active" : "Finding gaze" : "Gaze off")}
    </span>
    <button ref={setup.ref} {...setup.props} data-gaze-preview="" type="button" aria-haspopup="dialog" aria-expanded={mode === "setup"}
      className="patient-tool">
      <span className="dwell-fill" /><ScanEye aria-hidden className="relative size-5" /><span className="relative">Setup</span>
    </button>
    {workspaceOpen && createPortal(
      <dialog ref={dialog} aria-label="Screen 1 eye tracking" onCancel={close}
        style={{ position: "fixed", inset: 0, width: "100vw", height: "100dvh", maxWidth: "none",
          maxHeight: "none", margin: 0, padding: 0, border: 0 }}>
        <Workspace mode={mode} onSetupRequired={openSetup} onSample={onSample} onUse={useTracking} onPreview={preview} onClose={close}/>
      </dialog>, document.body)}
    {dashboardCursor && cursorHost && createPortal(<div hidden aria-hidden ref={cursor} className="pointer-events-none fixed z-50 size-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-teal bg-white/40 shadow-sm">
        <svg viewBox="0 0 32 32" className="absolute -inset-1.5 size-9 -rotate-90 overflow-visible" fill="none">
          <circle cx="16" cy="16" r="14" pathLength="1" stroke="#f4b23e" strokeWidth="4" strokeDasharray="1" strokeDashoffset="1" />
        </svg>
      </div>, cursorHost)}
  </>;
}
