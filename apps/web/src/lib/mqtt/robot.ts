import type { HubMessage } from "../rtc/robot-stream";

const DEVICE = "esp12e_carbot";
export const DRIVE_TOPIC = `teekhi-nazaar/${DEVICE}/intent`;
export const DRIVE_INTERVAL_MS = 100;
const MOBILE_FRESH_MS = 2500;
const DRIVE_SPEED = 35;
// Resolve the handoff before a new direction can complete its 1.2-second dwell.
const NEUTRAL_ACK_MS = 1000;

export type Direction = "forward" | "backward" | "left" | "right";
export type DriveAction = Direction | "stop" | "neutral";
export type StopState = "unavailable" | "available" | "pending" | "neutral-pending" | "disarmed";
export type DriveSource = "gaze" | "pointer" | "keyboard";
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
  private supportsNeutral = false;
  private requireStopId = false;
  private pendingNeutral: { id: string; since: number } | null = null;
  private monitoring = false;
  private hold: { action: Direction; source: DriveSource; lastPulse: number | null } | null = null;

  constructor(
    private publish: (intent: DriveIntent) => Promise<void> | void,
    private available: () => boolean,
    private now = () => performance.now(),
  ) {}

  get active() { return this.hold?.action ?? null; }
  private get phoneEnabled() { return this.phoneState === "ready" || this.phoneState === "driving"; }
  private neutralTimedOut(now: number) {
    return this.pendingNeutral !== null && now - this.pendingNeutral.since >= NEUTRAL_ACK_MS;
  }

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
    this.pendingNeutral = null;
    this.supportsNeutral = false;
    this.requireStopId = false;
    this.monitoring = false;
    this.phoneAt = -Infinity;
    this.phoneState = "";
  }

  mobileStatus(raw: string, retained: boolean) {
    if (retained || !this.lease || raw.length > 8192) return;
    let m: Record<string, unknown> | null;
    try { m = JSON.parse(raw); } catch { return; }
    if (m?.type !== "mobile_status" || m.device_id !== DEVICE || m.control_session_id !== this.lease.id) return;
    const now = this.now();
    const state = m.esp_online === true && m.calibrated === true && typeof m.state === "string" ? m.state : "fault";
    const capable = m.supports_neutral === true;
    // Evaluate the old state before a delayed report can make a stale session look fresh.
    if ((this.monitoring && !this.usable()) ||
        (this.pendingNeutral && !capable) || this.neutralTimedOut(now) ||
        ((this.hold || this.pendingNeutral || this.monitoring) && state !== "ready" && state !== "driving")) {
      void this.stop();
    }
    this.phoneState = state;
    this.phoneAt = now;
    this.supportsNeutral = capable;
    if (this.pendingStop && state === "ready" && m.last_command_id === this.pendingStop) {
      this.pendingStop = null;
      this.requireStopId = false;
    }
    if (!this.requireStopId && (state === "disarmed" || state === "fault")) this.pendingStop = null;
    if (state === "ready" && this.pendingNeutral && m.last_command_id === this.pendingNeutral.id) this.pendingNeutral = null;
    this.monitoring = !this.pendingStop && this.phoneEnabled && this.usable();
  }

  private usable() {
    const now = this.now();
    return Boolean(globalThis.crypto?.subtle) && this.available() && this.lease !== null && epochAt(this.lease, now) < this.lease.expiresAt &&
      now - this.phoneAt < MOBILE_FRESH_MS;
  }
  get ready() { return Boolean(!this.pendingStop && !this.pendingNeutral && this.usable() && this.phoneState === "ready"); }

  // A new dwell may start while the phone acknowledges zero wheels. start() still requires ready.
  get canAim() {
    return this.ready || Boolean(this.pendingNeutral && this.usable() &&
      this.now() - this.pendingNeutral.since < NEUTRAL_ACK_MS);
  }

  // Losing the picture blocks movement but must still allow a signed stop or retry.
  get stopState(): StopState {
    const now = this.now();
    if (!globalThis.crypto?.subtle || !this.lease || epochAt(this.lease, now) >= this.lease.expiresAt) return "unavailable";
    if (this.pendingStop) return this.phoneState === "disarmed" && now - this.phoneAt < MOBILE_FRESH_MS ? "disarmed" : "pending";
    if (this.pendingNeutral) return "neutral-pending";
    if (this.hold) return "available";
    if (now - this.phoneAt >= MOBILE_FRESH_MS) return "unavailable";
    if (this.phoneState === "disarmed") return "disarmed";
    return this.phoneEnabled ? "available" : "unavailable";
  }

  async start(action: Direction, source: DriveSource = "gaze") {
    if (this.hold) {
      if (this.hold.action !== action && this.hold.source === source) await this.center();
      return;
    }
    if (!this.ready) return;
    this.hold = { action, source, lastPulse: null };
    await this.tick();
  }

  async release(action: DriveAction, source?: DriveSource) {
    if (this.hold?.action === action && (!source || this.hold.source === source)) await this.center();
  }

  async center() {
    const now = this.now();
    const lastPulse = this.hold?.lastPulse;
    const expiredHold = lastPulse != null && this.lease && now - lastPulse >= this.lease.ttl;
    if (!this.supportsNeutral || this.pendingStop || !this.usable() || !this.phoneEnabled ||
        expiredHold || this.neutralTimedOut(now)) {
      await this.stop(true);
      return;
    }
    this.hold = null;
    if (!this.pendingNeutral) await this.send("neutral", null);
  }

  async tick() {
    const hold = this.hold;
    const now = this.now();
    const usable = this.usable();
    if ((this.monitoring && !usable) || this.neutralTimedOut(now)) {
      await this.stop();
      return;
    }
    this.monitoring = usable && !this.pendingStop && this.phoneEnabled;
    if (!hold) return;
    const elapsed = hold.lastPulse !== null ? now - hold.lastPulse : null;
    if (!usable || (elapsed !== null && elapsed >= this.lease!.ttl) || !this.phoneEnabled) {
      await this.stop();
      return;
    }
    // A click or dwell can land between two interval ticks. Preserve the 10 Hz cadence.
    if (elapsed !== null && elapsed < DRIVE_INTERVAL_MS - 5) return;
    hold.lastPulse = now;
    await this.send(hold.action, hold);
  }

  async stop(explicit = false) {
    if (!explicit && (this.pendingStop || (!this.hold && !this.pendingNeutral && !this.phoneEnabled))) return;
    this.monitoring = false;
    this.pendingNeutral = null;
    this.hold = null; // cancels signing in flight before any further await
    this.phoneState = "";
    await this.send("stop", null);
  }

  private async send(action: DriveAction, hold: typeof this.hold) {
    const lease = this.lease;
    const now = this.now();
    if (!lease || epochAt(lease, now) >= lease.expiresAt) return;
    const sent = epochAt(lease, now);
    let commandId: string | undefined;
    try {
      commandId = crypto.randomUUID();
      if (action === "stop") {
        this.pendingStop = commandId;
        this.requireStopId ||= this.supportsNeutral;
      }
      if (action === "neutral") this.pendingNeutral = { id: commandId, since: now };
      const intent = await sign(lease, {
        type: "drive_intent", device_id: DEVICE, control_session_id: lease.id, command_id: commandId,
        seq: ++this.sequence, action, speed: hold ? DRIVE_SPEED : 0, sent_at: new Date(sent).toISOString(),
        ttl_ms: Math.min(lease.ttl, lease.expiresAt - sent),
      });
      // WebCrypto is async. A release, newer tick, or stale signature must never publish delayed motion.
      if (intent.seq <= this.lastSent || this.now() - now >= intent.ttl_ms ||
          (action === "neutral" && this.pendingNeutral?.id !== commandId) ||
          (hold && (hold !== this.hold || !this.usable()))) return;
      this.lastSent = intent.seq;
      await this.publish(intent);
    } catch {
      if ((hold && hold === this.hold) || (action === "neutral" && this.pendingNeutral?.id === commandId)) await this.stop();
    }
  }
}
