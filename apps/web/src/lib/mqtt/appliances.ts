"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { broker, TOPICS } from "./broker";

/**
 * ESP8266 appliance controls:
 *   control → gazeconnect/appliances/control  {"password":"…","pins":{"d1":"on"}}  (QoS 1, retain=false)
 *   state   ← gazeconnect/appliances/state    {"d1":"on","d2":"off","d3":"off"}  (retained, published after
 *             every accepted command and when the board connects)
 * The board silently ignores a wrong password, so a command that never shows up in the state
 * report is flagged as unconfirmed.
 */
/** Patient controls use d1 (GPIO16) and d2 (GPIO4). */
export const APPLIANCE_PINS = ["d1", "d2"] as const;
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
  const finish = useCallback((pin: AppliancePin) => {
    clearTimeout(timers.current.get(pin));
    timers.current.delete(pin);
    const next = { ...pendingRef.current };
    delete next[pin];
    pendingRef.current = next;
    setPending(next);
  }, []);

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
        for (const pin of APPLIANCE_PINS) {
          if (next[pin] !== undefined && next[pin] === pendingRef.current[pin]) finish(pin);
        }
        setUnconfirmed((previous) => {
          const remaining = { ...previous };
          for (const pin of APPLIANCE_PINS) if (next[pin] !== undefined) delete remaining[pin];
          return remaining;
        });
      }),
    [finish],
  );

  useEffect(() => {
    const t = timers.current;
    return () => { t.forEach(clearTimeout); t.clear(); };
  }, []);

  /** Flip one pin. Rejects if the broker didn't accept the command. */
  const toggle = useCallback(
    async (pin: AppliancePin, password: string) => {
      if (!password) throw new Error("Configure APPLIANCE_CONTROL_PASSWORD on the web server to switch appliances.");
      if (!states[pin] || pendingRef.current[pin]) return;
      const target: PinState = states[pin] === "on" ? "off" : "on";
      pendingRef.current = { ...pendingRef.current, [pin]: target };
      setPending(pendingRef.current);
      const timeout = setTimeout(() => {
        finish(pin);
        setUnconfirmed((u) => ({ ...u, [pin]: true }));
      }, CONFIRM_TIMEOUT_MS);
      timers.current.set(pin, timeout);
      try {
        await broker.publish(TOPICS.applianceControl, { password, pins: { [pin]: target } });
      } catch (error) {
        if (timers.current.get(pin) === timeout) finish(pin);
        throw error;
      }
      return target;
    },
    [states, finish],
  );

  return { states, pending, unconfirmed, lastReportAt, toggle };
}
