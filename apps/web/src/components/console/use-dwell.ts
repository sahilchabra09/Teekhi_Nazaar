"use client";

import { useEffect, useRef, useState } from "react";

/** Screen 1 owns dwell timing. Keyboard and deliberate clicks also activate a card. */
export function useDwell<T extends HTMLElement = HTMLButtonElement>(
  onSelect: () => void,
  { ms = 900, disabled = false }: { ms?: number; disabled?: boolean } = {},
) {
  const ref = useRef<T>(null);
  const [dwelling, setDwelling] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || disabled) return;
    const enter = () => setDwelling(true);
    const leave = () => setDwelling(false);
    const select = () => { leave(); onSelect(); };
    el.addEventListener("gaze:enter", enter);
    el.addEventListener("gaze:leave", leave);
    el.addEventListener("gaze:select", select);
    return () => {
      el.removeEventListener("gaze:enter", enter);
      el.removeEventListener("gaze:leave", leave);
      el.removeEventListener("gaze:select", select);
    };
  }, [onSelect, disabled]);
  return { ref, dwelling, props: {
    "data-gaze-target": "",
    "data-gaze-dwell": ms,
    "data-dwelling": !disabled && dwelling,
    "aria-disabled": disabled || undefined,
    style: { "--dwell-ms": ms + "ms" } as React.CSSProperties,
    onClick: disabled ? undefined : onSelect,
  } };
}
