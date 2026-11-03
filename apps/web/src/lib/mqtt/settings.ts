"use client";

import { useSyncExternalStore } from "react";

/**
 * Control passwords, kept only in this browser (localStorage). They go inside each MQTT payload,
 * exactly as the firmware expects; they are never sent to the IRIS backend.
 */

export type ControlSettings = { robotPassword: string; appliancePassword: string };

const KEY = "iris.controlSettings";
const EMPTY: ControlSettings = { robotPassword: "", appliancePassword: "" };

let current: ControlSettings = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ControlSettings>;
      current = {
        robotPassword: typeof parsed.robotPassword === "string" ? parsed.robotPassword : "",
        appliancePassword: typeof parsed.appliancePassword === "string" ? parsed.appliancePassword : "",
      };
    }
  } catch {
    /* storage blocked: keep in memory for this session */
  }
}

export function getControlSettings() {
  load();
  return current;
}

export function saveControlSettings(next: ControlSettings) {
  current = { robotPassword: next.robotPassword.trim(), appliancePassword: next.appliancePassword.trim() };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage blocked: still works until reload */
  }
  for (const l of listeners) l();
}

const getServerSettings = () => EMPTY; // stable reference for SSR

export function useControlSettings() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getControlSettings,
    getServerSettings,
  );
}
