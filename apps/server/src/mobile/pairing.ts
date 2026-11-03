export interface AccountSession {
  user: { id: string; email: string; name: string };
  session: { id: string; expiresAt: Date };
}
export type SessionResolver = (headers: Headers) => Promise<AccountSession | null>;
export interface Identity {
  account: AccountSession;
  headers: Headers;
  expires: number;
  credential?: string;
}
type Timed<T> = T & { expires: number };
const hash = (value: string) => new Bun.CryptoHasher("sha256").update(value).digest("hex");
const secret = () => crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");

/** Single-process device authorization. Restarting the API intentionally requires linking again.
 * Only hashes of issued credentials are retained. Every credential remains bound to a live
 * Better Auth session, so signing out on the laptop also revokes the linked phone. */
export class Pairing {
  private codes = new Map<string, Timed<Identity>>();
  private devices = new Map<string, Identity>();
  private tickets = new Map<string, Timed<{ identity: Identity }>>();
  private attempts = new Map<string, { count: number; expires: number }>();
  constructor(private resolve: SessionResolver, private now: () => number = Date.now) {}

  sweep() {
    for (const map of [this.codes, this.devices, this.tickets, this.attempts]) {
      for (const [key, value] of map) if (value.expires <= this.now()) map.delete(key);
    }
  }
  async browser(headers: Headers): Promise<Identity | null> {
    // Retain only the session cookie, never arbitrary request/forwarding headers.
    const sessionHeaders = new Headers();
    sessionHeaders.set("cookie", headers.get("cookie") ?? "");
    const account = await this.resolve(sessionHeaders);
    if (!account || account.session.expiresAt.getTime() <= this.now()) return null;
    return { account, headers: sessionHeaders, expires: account.session.expiresAt.getTime() };
  }
  async valid(identity: Identity): Promise<boolean> {
    if (identity.expires <= this.now()) return false;
    if (identity.credential && this.devices.get(identity.credential) !== identity) return false;
    const current = await this.resolve(identity.headers);
    return !!current && current.session.expiresAt.getTime() > this.now() && current.user.id === identity.account.user.id && current.session.id === identity.account.session.id;
  }
  code(identity: Identity) {
    this.sweep();
    // One pending authorization per laptop session. Regenerating invalidates the old code.
    for (const [key, value] of this.codes) if (value.account.session.id === identity.account.session.id) this.codes.delete(key);
    if (this.codes.size >= 10_000) throw new Error("Pairing service is busy");
    const code = Buffer.from(crypto.getRandomValues(new Uint8Array(6))).toString("hex").toUpperCase();
    const expires = Math.min(this.now() + 5 * 60_000, identity.expires);
    this.codes.set(hash(code), { ...identity, expires });
    return { code, expires_at_ms: expires, email: identity.account.user.email };
  }
  allowAttempt(ip: string) {
    this.sweep();
    const entry = this.attempts.get(ip) ?? { count: 0, expires: this.now() + 60_000 };
    if (this.attempts.size >= 10_000 && !this.attempts.has(ip)) return false;
    entry.count++; this.attempts.set(ip, entry);
    return entry.count <= 10;
  }
  async exchange(raw: string) {
    const code = raw.replace(/[\s-]/g, "").toUpperCase();
    if (!/^[A-F0-9]{12}$/.test(code)) return null;
    const key = hash(code);
    const pending = this.codes.get(key);
    if (!pending) return null;
    // Consume before awaiting validation: concurrent requests cannot reuse the code.
    this.codes.delete(key);
    if (!await this.valid(pending)) return null;
    const token = secret();
    const credential = hash(token);
    const identity: Identity = { ...pending, credential,
      expires: Math.min(this.now() + 24 * 60 * 60_000, pending.account.session.expiresAt.getTime()) };
    // A new link replaces the previous phone associated with this laptop session.
    for (const [key, value] of this.devices) if (value.account.session.id === identity.account.session.id) this.devices.delete(key);
    this.devices.set(credential, identity);
    return { token, expires_at_ms: identity.expires, user: identity.account.user };
  }
  async phone(headers: Headers) {
    const raw = headers.get("authorization") ?? "";
    if (!raw.startsWith("Bearer ") || raw.length > 256) return null;
    const identity = this.devices.get(hash(raw.slice(7)));
    return identity && await this.valid(identity) ? identity : null;
  }
  ticket(identity: Identity) {
    this.sweep();
    if (this.tickets.size >= 10_000) throw new Error("Pairing service is busy");
    const ticket = secret();
    this.tickets.set(hash(ticket), { identity, expires: Math.min(this.now() + 30_000, identity.expires) });
    return ticket;
  }
  async consumeTicket(raw: string | null) {
    if (!raw || raw.length > 128) return null;
    const key = hash(raw), entry = this.tickets.get(key);
    this.tickets.delete(key);
    return entry && entry.expires > this.now() && await this.valid(entry.identity) ? entry.identity : null;
  }
  revoke(identity: Identity) {
    if (identity.credential) this.devices.delete(identity.credential);
  }
}
