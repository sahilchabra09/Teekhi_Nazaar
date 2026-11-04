import type { HubMessage } from "../rtc/robot-stream";

const DEVICE = "esp12e_carbot";
export const DRIVE_TOPIC = `teekhi-nazaar/${DEVICE}/intent`;
export const DRIVE_INTERVAL_MS = 100;
const MOBILE_FRESH_MS = 2500;
const DRIVE_SPEED = 35;

export type DriveAction = "forward" | "backward" | "left" | "right" | "stop";
export type StopState = "unavailable" | "available" | "pending" | "disarmed";
export type DriveSource = "gaze" | "pointer" | "keyboard";
export type Direction = Exclude<DriveAction, "stop">;
export type DriveIntent = {
  type: "drive_intent";
  device_id: string;
  control_session_id: string;
  command_id: string;
  seq: number;
  action: DriveAction;
  speed: number;
  sent_at: string;
  ttl_ms: number;
  signature: string;
};

type Lease = {
  id: string;
  secret: string;
  key?: Promise<CryptoKey>;
  serverAt: number;
  receivedAt: number;
  expiresAt: number;
  ttl: number;
};

function readLease(m: HubMessage, receivedAt: number): Lease | null {
  const { control_session_id: id, signing_key: secret, server_time_ms: serverAt, expires_at_ms: expiresAt, max_ttl_ms: ttl } = m;
  if (m.type !== "drive_grant" || m.device_id !== DEVICE || typeof id !== "string" || !/^[\w.-]{1,128}$/.test(id) ||
      typeof secret !== "string" || !/^[a-f\d]{64}$/i.test(secret) ||
      typeof serverAt !== "number" || !Number.isSafeInteger(serverAt) || serverAt <= 0 ||
      typeof expiresAt !== "number" || !Number.isSafeInteger(expiresAt) || expiresAt <= serverAt || expiresAt - serverAt > 60_000 ||
      typeof ttl !== "number" || !Number.isInteger(ttl) || ttl < 1 || ttl > 300) return null;
  return { id, secret, serverAt, receivedAt, expiresAt, ttl };
}

function epochAt(g: Lease, now: number) { return Math.floor(g.serverAt + now - g.receivedAt); }

async function sign(g: Lease, i: Omit<DriveIntent, "signature">): Promise<DriveIntent> {
  if (!g.key) {
    const bytes = Uint8Array.from(g.secret.match(/../g)!, hex => parseInt(hex, 16));
    g.key = crypto.subtle.importKey("raw", bytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  }
  const canonical = [i.device_id, i.control_session_id, i.command_id, i.seq, i.action, i.speed, i.sent_at, i.ttl_ms].join("\n");
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", await g.key, new TextEncoder().encode(canonical)));
  return { ...i, signature: Array.from(mac, byte => byte.toString(16).padStart(2, "0")).join("") };
}

/** Owns one accepted fixation/press. Renewals and MQTT status can never start a hold. */
export class DrivePublisher {
  private lease: Lease | null = null;
  private phoneState = "";
  private phoneAt = -Infinity;
  private sequence = 0;
  private lastSent = 0;
  private pendingStop: string | null = null;
  private hold: { action: Direction; source: DriveSource; lastPulse: number | null } | null = null;

  constructor(
    private publish: (intent: DriveIntent) => Promise<void> | void,
    private available: () => boolean,
    private now = () => performance.now(),
  ) {}

  get active() { return this.hold?.action ?? null; }

  grant(message: HubMessage) {
    const now = this.now();
    const next = readLease(message, now);
    const old = this.lease;
    if (!next) { this.revoke(); return; }
    if (old && next.id === old.id && next.secret === old.secret && epochAt(old, now) < old.expiresAt) {
      if (next.serverAt <= old.serverAt) return; // duplicate or delayed renewal
      next.key = old.key;
    } else {
      this.revoke();
    }
    this.lease = next;
  }

  revoke(id?: unknown) {
    if (id !== undefined && id !== this.lease?.id) return;
    void this.stop();
    this.lease = null;
    this.pendingStop = null;
    this.phoneState = "";
  }

  mobileStatus(raw: string, retained: boolean) {
    if (retained || !this.lease || raw.length > 8192) return;
    let m: Record<string, unknown> | null;
    try { m = JSON.parse(raw); } catch { return; }
    if (m?.type !== "mobile_status" || m.device_id !== DEVICE || m.control_session_id !== this.lease.id) return;
    this.phoneState = m.esp_online === true && m.calibrated === true && typeof m.state === "string" ? m.state : "fault";
    this.phoneAt = this.now();
    if (this.phoneState === "ready" && m.last_command_id === this.pendingStop) this.pendingStop = null;
    if (this.phoneState !== "ready" && this.phoneState !== "driving") {
      void this.stop();
      if (m.state === "disarmed" || m.state === "fault") this.pendingStop = null;
    }
  }

  private usable() {
    const now = this.now();
    return Boolean(globalThis.crypto?.subtle) && this.available() && this.lease && epochAt(this.lease, now) < this.lease.expiresAt &&
      now - this.phoneAt < MOBILE_FRESH_MS;
  }
  get ready() { return Boolean(!this.pendingStop && this.usable() && this.phoneState === "ready"); }

  // Losing the picture blocks movement but must still allow a signed stop or retry.
  get stopState(): StopState {
    const now = this.now();
    if (!globalThis.crypto?.subtle || !this.lease || epochAt(this.lease, now) >= this.lease.expiresAt) return "unavailable";
    if (this.pendingStop) return "pending";
    if (this.hold) return "available";
    if (now - this.phoneAt >= MOBILE_FRESH_MS) return "unavailable";
    if (this.phoneState === "disarmed") return "disarmed";
    return this.phoneState === "ready" || this.phoneState === "driving" ? "available" : "unavailable";
  }

  async start(action: Direction, source: DriveSource = "gaze") {
    if (this.hold) {
      if (this.hold.action !== action) await this.stop();
      return;
    }
    if (!this.ready) return;
    this.hold = { action, source, lastPulse: null };
    await this.tick();
  }

  async release(action: DriveAction, source?: DriveSource) {
    if (this.hold?.action === action && (!source || this.hold.source === source)) await this.stop();
  }

  async tick() {
    const hold = this.hold;
    if (!hold) return;
    const now = this.now();
    const elapsed = hold.lastPulse !== null ? now - hold.lastPulse : null;
    if (!this.usable() || (elapsed !== null && elapsed >= this.lease!.ttl) || (this.phoneState !== "ready" && this.phoneState !== "driving")) {
      await this.stop();
      return;
    }
    // A click or dwell can land between two interval ticks. Preserve the 10 Hz cadence.
    if (elapsed !== null && elapsed < DRIVE_INTERVAL_MS - 5) return;
    hold.lastPulse = now;
    await this.send(hold.action, hold);
  }

  async stop(explicit = false) {
    if (!this.hold && !explicit) return;
    this.hold = null; // cancels signing in flight before any further await
    this.phoneState = "";
    await this.send("stop", null);
  }

  private async send(action: DriveAction, hold: typeof this.hold) {
    const lease = this.lease;
    const now = this.now();
    if (!lease || epochAt(lease, now) >= lease.expiresAt) return;
    const sent = epochAt(lease, now);
    try {
      const commandId = crypto.randomUUID();
      if (action === "stop") this.pendingStop = commandId;
      const intent = await sign(lease, {
        type: "drive_intent", device_id: DEVICE, control_session_id: lease.id, command_id: commandId,
        seq: ++this.sequence, action, speed: action === "stop" ? 0 : DRIVE_SPEED, sent_at: new Date(sent).toISOString(),
        ttl_ms: Math.min(lease.ttl, lease.expiresAt - sent),
      });
      // WebCrypto is async. A release, newer tick, or stale signature must never publish delayed motion.
      if (intent.seq <= this.lastSent || this.now() - now >= intent.ttl_ms ||
          (hold && (hold !== this.hold || !this.usable()))) return;
      this.lastSent = intent.seq;
      await this.publish(intent);
    } catch {
      if (hold && hold === this.hold) await this.stop();
    }
  }
}
