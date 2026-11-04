export interface AccountSession {
  user: { id: string; email: string; name: string; role?: string | null };
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
const MOBILE_ACCOUNT_TTL_MS = 7 * 24 * 60 * 60_000;
const hash = (value: string) => new Bun.CryptoHasher("sha256").update(value).digest("hex");
const secret = () => crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");

/** Native credentials remain bound to the phone's live Better Auth Google session.
 * Rooms use the shared account ID, so laptop and phone sign in independently. */
export class Pairing {
  private devices = new Map<string, Identity>();
  private tickets = new Map<string, Timed<{ identity: Identity }>>();
  private attempts = new Map<string, { count: number; expires: number }>();
  constructor(private resolve: SessionResolver, private now: () => number = Date.now) {}

  sweep() {
    for (const map of [this.devices, this.tickets, this.attempts]) {
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
  current(identity: Identity): boolean {
    return identity.expires > this.now() && (!identity.credential || this.devices.get(identity.credential) === identity);
  }
  async session(identity: Identity): Promise<AccountSession | null> {
    if (!this.current(identity)) return null;
    const session = await this.resolve(identity.headers);
    if (!session || !this.current(identity) || session.session.expiresAt.getTime() <= this.now() ||
        session.user.id !== identity.account.user.id || session.session.id !== identity.account.session.id) return null;
    return session;
  }
  async valid(identity: Identity): Promise<boolean> {
    return !!await this.session(identity) && this.current(identity);
  }
  allowAttempt(ip: string) {
    this.sweep();
    const entry = this.attempts.get(ip) ?? { count: 0, expires: this.now() + 60_000 };
    if (this.attempts.size >= 10_000 && !this.attempts.has(ip)) return false;
    entry.count++; this.attempts.set(ip, entry);
    return entry.count <= 10;
  }
  issue(account: Identity) {
    this.sweep();
    if (this.devices.size >= 10_000) throw new Error("Sign-in service is busy");
    const token = secret();
    const credential = hash(token);
    const identity: Identity = { ...account, credential,
      expires: Math.min(this.now() + MOBILE_ACCOUNT_TTL_MS, account.account.session.expiresAt.getTime()) };
    // Replace credentials issued from the same mobile browser session.
    for (const [key, value] of this.devices) if (value.account.session.id === identity.account.session.id) this.devices.delete(key);
    this.devices.set(credential, identity);
    return { token, expires_at_ms: identity.expires, user: identity.account.user };
  }
  async phoneSession(headers: Headers) {
    const raw = headers.get("authorization") ?? "";
    if (!raw.startsWith("Bearer ") || raw.length > 256) return null;
    const identity = this.devices.get(hash(raw.slice(7)));
    if (!identity) return null;
    const session = await this.session(identity);
    return session && this.current(identity) ? { identity, session } : null;
  }
  async phone(headers: Headers) {
    const phone = await this.phoneSession(headers);
    return phone && this.current(phone.identity) ? phone.identity : null;
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
