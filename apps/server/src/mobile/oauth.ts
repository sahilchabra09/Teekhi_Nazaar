import type { Identity, Pairing } from "./pairing";

const hash = (value: string) => new Bun.CryptoHasher("sha256").update(value).digest("hex");
const random = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
export const pkceChallenge = (verifier: string) => new Bun.CryptoHasher("sha256").update(verifier).digest("base64url");
export const appCallback = (state: string, result: { code: string } | { error: string }) => {
  const url = new URL("com.iris.robot://oauth/callback");
  url.searchParams.set("state", state);
  for (const [key, value] of Object.entries(result)) url.searchParams.set(key, value);
  return url.toString();
};
interface Attempt { state: string; challenge: string; expires: number; started: boolean; returnKey: string }
interface Grant { identity: Identity; challenge: string; expires: number }

/** Browser OAuth completes at Better Auth. The app receives only a short-lived,
 * single-use authorization code; PKCE binds its exchange to the initiating APK. */
export class MobileOAuth {
  private attempts = new Map<string, Attempt>();
  private grants = new Map<string, Grant>();
  constructor(private sessions: Pairing, private now: () => number = Date.now) {}
  private sweep() {
    for (const map of [this.attempts, this.grants]) for (const [key, value] of map) {
      if (value.expires <= this.now()) map.delete(key);
    }
  }
  begin(state: unknown, challenge: unknown) {
    if (typeof state !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(state) ||
        typeof challenge !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return null;
    this.sweep();
    if (this.attempts.size >= 10_000) throw new Error("Sign-in service is busy");
    const request = random();
    const expires = this.now() + 5 * 60_000;
    this.attempts.set(hash(request), { state, challenge, expires, started: false, returnKey: random() });
    return { request, expires_at_ms: expires };
  }
  authorize(request: string) {
    const pending = this.attempts.get(hash(request));
    if (!pending || pending.expires <= this.now() || pending.started) return null;
    pending.started = true;
    return pending;
  }
  takeCallback(request: string, key: string) {
    const id = hash(request), pending = this.attempts.get(id);
    if (!pending || !pending.started || pending.expires <= this.now() || hash(key) !== hash(pending.returnKey)) return null;
    this.attempts.delete(id); // Consume before any asynchronous session lookup.
    return pending;
  }
  complete(attempt: Attempt, identity: Identity) {
    this.sweep();
    if (this.grants.size >= 10_000) throw new Error("Sign-in service is busy");
    const code = random();
    this.grants.set(hash(code), { identity, challenge: attempt.challenge,
      expires: Math.min(this.now() + 60_000, identity.expires) });
    return appCallback(attempt.state, { code });
  }
  async exchange(code: unknown, verifier: unknown) {
    if (typeof code !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(code) ||
        typeof verifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return null;
    const key = hash(code), grant = this.grants.get(key);
    if (!grant || grant.expires <= this.now() || pkceChallenge(verifier) !== grant.challenge) return null;
    this.grants.delete(key);
    if (!await this.sessions.valid(grant.identity)) return null;
    return this.sessions.issue(grant.identity);
  }
}
