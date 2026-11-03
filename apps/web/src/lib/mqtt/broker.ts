"use client";

import type { IClientOptions, MqttClient } from "mqtt";
import { useSyncExternalStore } from "react";

/**
 * ONE browser MQTT connection for the console, shared by robot driving and appliance control
 * (docs/controls.md). Commands go straight from the browser to the broker over WebSockets;
 * nothing is routed through the IRIS backend.
 */

export const BROKER_URL = "wss://broker.emqx.io:8084/mqtt";

export const TOPICS = {
  robotCommand: "carbot/command",
  applianceControl: "gazeconnect/appliances/control",
  applianceState: "gazeconnect/appliances/state",
} as const;

export type BrokerStatus = "idle" | "connecting" | "connected" | "reconnecting" | "offline" | "error";
export type BrokerSnapshot = { status: BrokerStatus; error: string | null };

type Handler = (payload: string) => void;

const PUBLISH_TIMEOUT_MS = 8_000;

class Broker {
  private client: MqttClient | null = null;
  private connecting: Promise<void> | null = null;
  private users = 0;
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private listeners = new Set<() => void>();
  private snapshot: BrokerSnapshot = { status: "idle", error: null };

  // ── store for useSyncExternalStore
  subscribeStore = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.snapshot;
  private set(next: Partial<BrokerSnapshot>) {
    this.snapshot = { ...this.snapshot, ...next };
    for (const l of this.listeners) l();
  }

  /** Reference-counted: the connection opens on first use and closes shortly after the last user leaves. */
  acquire() {
    this.users++;
    if (this.releaseTimer) {
      clearTimeout(this.releaseTimer);
      this.releaseTimer = null;
    }
    void this.connect();
    return () => {
      this.users = Math.max(0, this.users - 1);
      if (this.users === 0) this.releaseTimer = setTimeout(() => this.end(), 2_000);
    };
  }

  /** Force a fresh connection (e.g. from the "Reconnect" button). */
  reconnect() {
    this.end();
    void this.connect();
  }

  private connect() {
    if (this.client || this.connecting) return this.connecting ?? Promise.resolve();
    this.set({ status: "connecting", error: null });

    this.connecting = (async () => {
      try {
        const { default: mqtt } = await import("mqtt");
        const options: IClientOptions = {
          clientId: `iris-web-${crypto.randomUUID().slice(0, 12)}`,
          clean: true,
          keepalive: 30,
          reconnectPeriod: 3_000,
          connectTimeout: 10_000,
        };
        const client = mqtt.connect(BROKER_URL, options);
        this.client = client;

        client.on("connect", () => {
          this.set({ status: "connected", error: null });
          for (const topic of this.handlers.keys()) client.subscribe(topic, { qos: 1 });
        });
        client.on("reconnect", () => this.set({ status: "reconnecting" }));
        client.on("offline", () => this.set({ status: "offline", error: this.snapshot.error ?? "The control broker is unreachable." }));
        client.on("error", (error) => this.set({ status: "error", error: `Control broker error: ${error.message}` }));
        client.on("message", (topic, payload) => {
          const text = payload.toString();
          for (const h of this.handlers.get(topic) ?? []) h(text);
        });
      } catch (error) {
        this.client = null;
        this.set({ status: "error", error: error instanceof Error ? `Couldn’t start MQTT: ${error.message}` : "Couldn’t start MQTT." });
      } finally {
        this.connecting = null;
      }
    })();
    return this.connecting;
  }

  private end() {
    const client = this.client;
    this.client = null;
    this.connecting = null;
    client?.removeAllListeners();
    client?.end(true);
    this.set({ status: "idle", error: null });
  }

  /** Listen to a topic (retained messages arrive right after subscribing). Returns an unsubscribe. */
  subscribe(topic: string, handler: Handler) {
    let set = this.handlers.get(topic);
    if (!set) {
      set = new Set();
      this.handlers.set(topic, set);
      if (this.client?.connected) this.client.subscribe(topic, { qos: 1 });
    }
    set.add(handler);
    return () => {
      set!.delete(handler);
      if (set!.size === 0) {
        this.handlers.delete(topic);
        if (this.client?.connected) this.client.unsubscribe(topic);
      }
    };
  }

  /** Publish JSON with QoS 1, retain=false. Resolves once the broker acknowledges (PUBACK). */
  publish(topic: string, message: unknown): Promise<void> {
    const client = this.client;
    if (!client || !client.connected) {
      const why = this.snapshot.status === "connecting" || this.snapshot.status === "reconnecting" ? "still connecting" : "not connected";
      return Promise.reject(new Error(`Control broker is ${why}. Command not sent.`));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The broker didn’t confirm the command in time.")), PUBLISH_TIMEOUT_MS);
      client.publish(topic, JSON.stringify(message), { qos: 1, retain: false }, (error) => {
        clearTimeout(timer);
        if (error) reject(new Error(`Publish failed: ${error.message}`));
        else resolve();
      });
    });
  }

  /** Fire-and-forget publish for page exit / safety stops, where nobody can wait for an ack. */
  publishBestEffort(topic: string, message: unknown) {
    try {
      if (this.client?.connected) this.client.publish(topic, JSON.stringify(message), { qos: 1, retain: false });
    } catch {
      /* best effort */
    }
  }
}

export const broker = new Broker();

const SERVER_SNAPSHOT: BrokerSnapshot = { status: "idle", error: null }; // stable: React requires a cached value
const getServerSnapshot = () => SERVER_SNAPSHOT;

export function useBrokerStatus(): BrokerSnapshot {
  return useSyncExternalStore(broker.subscribeStore, broker.getSnapshot, getServerSnapshot);
}
