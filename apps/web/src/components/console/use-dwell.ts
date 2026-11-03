"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Options = {
  /** How long the gaze (or mouse) must rest on the target before it fires. */
  ms?: number;
  /** After firing, keep firing every `repeatMs` while the gaze stays (used for driving). */
  repeatMs?: number;
  disabled?: boolean;
};

/**
 * Dwell-to-select for a gaze target.
 * - Mouse mode: hovering for `ms` selects; clicking selects immediately.
 * - Gaze mode: the gaze module (docs/interfaces.md §6) dispatches gaze:enter / gaze:leave /
 *   gaze:select / gaze:hold on any [data-gaze-target] element, and this hook listens for them.
 */
export function useDwell<T extends HTMLElement = HTMLButtonElement>(
  onSelect: () => void,
  { ms = 900, repeatMs, disabled = false }: Options = {},
) {
  const ref = useRef<T>(null);
  const cb = useRef(onSelect);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeater = useRef<ReturnType<typeof setInterval> | null>(null);
  const [dwelling, setDwelling] = useState(false);
  /**
   * A target that appears under a pointer/gaze that is already resting there (e.g. the card in the
   * same spot on the next screen) must not select itself. It only arms once the pointer has left it,
   * or if the first enter happens after a short grace period.
   */
  const mountedAt = useRef(0);
  const armed = useRef(false);
  useEffect(() => {
    mountedAt.current = performance.now();
    armed.current = false;
  }, []);
  const mayStart = () => armed.current || performance.now() - mountedAt.current > 700;

  useEffect(() => {
    cb.current = onSelect;
  }, [onSelect]);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (repeater.current) clearInterval(repeater.current);
    timer.current = null;
    repeater.current = null;
  }, []);

  const fire = useCallback(() => {
    setDwelling(false);
    cb.current();
    if (repeatMs) repeater.current = setInterval(() => cb.current(), repeatMs);
  }, [repeatMs]);

  const start = useCallback(() => {
    if (disabled) return;
    if (!mayStart()) return; // resting pointer from the previous screen
    armed.current = true;
    clear();
    setDwelling(true);
    timer.current = setTimeout(fire, ms);
  }, [clear, disabled, fire, ms]);

  const leave = useCallback(() => {
    armed.current = true; // pointer really moved: next enter may dwell
  }, []);

  const cancel = useCallback(() => {
    clear();
    setDwelling(false);
  }, [clear]);

  // Gaze-module events
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onEnter = () => !disabled && mayStart() && setDwelling(true);
    const onLeave = () => {
      leave();
      cancel();
    };
    const onSel = () => !disabled && mayStart() && fire();
    const onHold = () => !disabled && repeatMs && cb.current();
    el.addEventListener("gaze:enter", onEnter);
    el.addEventListener("gaze:leave", onLeave);
    el.addEventListener("gaze:select", onSel);
    el.addEventListener("gaze:hold", onHold);
    return () => {
      el.removeEventListener("gaze:enter", onEnter);
      el.removeEventListener("gaze:leave", onLeave);
      el.removeEventListener("gaze:select", onSel);
      el.removeEventListener("gaze:hold", onHold);
    };
  }, [cancel, disabled, fire, leave, repeatMs]);

  useEffect(() => clear, [clear]);
  useEffect(() => {
    if (disabled) cancel();
  }, [disabled, cancel]);

  return {
    ref,
    dwelling,
    props: {
      "data-gaze-target": "",
      "data-gaze-dwell": ms,
      "data-dwelling": dwelling,
      style: { "--dwell-ms": `${ms}ms` } as React.CSSProperties,
      onPointerEnter: start,
      onPointerLeave: () => {
        leave();
        cancel();
      },
      onClick: () => {
        if (disabled) return;
        cancel();
        cb.current();
      },
    },
  };
}
