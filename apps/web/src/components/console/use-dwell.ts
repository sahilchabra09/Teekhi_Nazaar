"use client";

import { GAZE_DWELL_MS } from "@/lib/gaze/dwell";
import { useEffect, useRef, useState } from "react";

/** Screen 1 owns dwell timing. Keyboard and deliberate clicks also activate a card. */
export function useDwell<T extends HTMLElement = HTMLButtonElement>(
  onSelect: () => void,
  { ms = GAZE_DWELL_MS, disabled = false }: { ms?: number; disabled?: boolean } = {},
) {
  const ref = useRef<T>(null);
  const [dwelling, setDwelling] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const enter = () => setDwelling(true);
    const leave = () => { el.style.removeProperty("--gaze-progress"); setDwelling(false); };
    const progress = (event: Event) => el.style.setProperty("--gaze-progress", String((event as CustomEvent<{progress: number}>).detail.progress));
    const select = () => { leave(); if (!disabled) onSelect(); };
    el.addEventListener("gaze:enter", enter);
    el.addEventListener("gaze:leave", leave);
    el.addEventListener("gaze:progress", progress);
    el.addEventListener("gaze:select", select);
    return () => {
      el.removeEventListener("gaze:enter", enter);
      el.removeEventListener("gaze:leave", leave);
      el.removeEventListener("gaze:progress", progress);
      el.removeEventListener("gaze:select", select);
    };
  }, [onSelect, disabled]);
  return { ref, dwelling, props: {
    "data-gaze-target": "",
    "data-gaze-dwell": ms,
    "data-dwelling": dwelling,
    "aria-disabled": disabled || undefined,
    onClick: disabled ? undefined : onSelect,
  } };
}
