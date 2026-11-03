"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { broker, TOPICS } from "./broker";

/**
 * Appliance board (Gaze Connect firmware, appliances_control_hardware):
 *   control → gazeconnect/appliances/control  {"password":"…","pins":{"d1":"on"}}  (QoS 1, retain=false)
 *   state   ← gazeconnect/appliances/state    {"d0":"off","d1":"on",…}  (retained, published after
 *             every accepted command and when the board connects)
 * The board silently ignores a wrong password, so a command that never shows up in the state
 * report is flagged as unconfirmed.
 */
/** IRIS exposes three appliances (one per card); the board itself has d0–d8. */
export const APPLIANCE_PINS = ["d1", "d2", "d3"] as const;
export type AppliancePin = (typeof APPLIANCE_PINS)[number];
export type PinState = "on" | "off";

const CONFIRM_TIMEOUT_MS = 5_000;

export function useAppliances() {
  const [states, setStates] = useState<Partial<Record<AppliancePin, PinState>>>({});
  const [lastReportAt, setLastReportAt] = useState<number | null>(null);
  const [pending, setPending] = useState<Partial<Record<AppliancePin, PinState>>>({});
  const [unconfirmed, setUnconfirmed] = useState<Partial<Record<AppliancePin, true>>>({});
  const timers = useRef(new Map<AppliancePin, ReturnType<typeof setTimeout>>());
  const pendingRef = useRef(pending);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  useEffect(
    () =>
      broker.subscribe(TOPICS.applianceState, (raw) => {
        let report: Record<string, unknown>;
        try {
          report = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          return;
        }
        if (!report || typeof report !== "object") return;
        const next: Partial<Record<AppliancePin, PinState>> = {};
        for (const pin of APPLIANCE_PINS) {
          const v = String(report[pin] ?? "").toLowerCase();
          if (v === "on" || v === "high") next[pin] = "on";
          else if (v === "off" || v === "low") next[pin] = "off";
        }
        if (Object.keys(next).length === 0) return;
        setStates((s) => ({ ...s, ...next }));
        setLastReportAt(Date.now());
        // A report matching what we asked for confirms the command.
        const confirmed = (Object.keys(pendingRef.current) as AppliancePin[]).filter((p) => next[p] === pendingRef.current[p]);
        if (confirmed.length) {
          for (const p of confirmed) {
            clearTimeout(timers.current.get(p));
            timers.current.delete(p);
          }
          setPending((cur) => {
            const copy = { ...cur };
            for (const p of confirmed) delete copy[p];
            return copy;
          });
          setUnconfirmed((cur) => {
            const copy = { ...cur };
            for (const p of confirmed) delete copy[p];
            return copy;
          });
        }
      }),
    [],
  );

  useEffect(() => {
    const t = timers.current;
    return () => t.forEach((timer) => clearTimeout(timer));
  }, []);

  /** Flip one pin. Rejects if the broker didn't accept the command. */
  const toggle = useCallback(
    async (pin: AppliancePin, password: string) => {
      const target: PinState = (pendingRef.current[pin] ?? states[pin]) === "on" ? "off" : "on";
      setPending((p) => ({ ...p, [pin]: target }));
      setUnconfirmed((u) => {
        const copy = { ...u };
        delete copy[pin];
        return copy;
      });
      try {
        await broker.publish(TOPICS.applianceControl, { password, pins: { [pin]: target } });
      } catch (error) {
        setPending((p) => {
          const copy = { ...p };
          delete copy[pin];
          return copy;
        });
        throw error;
      }
      clearTimeout(timers.current.get(pin));
      timers.current.set(
        pin,
        setTimeout(() => {
          timers.current.delete(pin);
          if (pendingRef.current[pin] === undefined) return;
          setPending((p) => {
            const copy = { ...p };
            delete copy[pin];
            return copy;
          });
          setUnconfirmed((u) => ({ ...u, [pin]: true }));
        }, CONFIRM_TIMEOUT_MS),
      );
      return target;
    },
    [states],
  );

  return { states, pending, unconfirmed, lastReportAt, toggle };
}
