import { createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";

import { DrivePublisher, type DriveIntent } from "../src/lib/mqtt/robot";

const epoch = Date.UTC(2026, 0, 1);
const key = "9a".repeat(32);
function grant(id = "s1", sent = epoch) {
  return { type: "drive_grant", device_id: "esp12e_carbot", control_session_id: id, signing_key: key,
    server_time_ms: sent, expires_at_ms: sent + 10000, max_ttl_ms: 300, ts: sent };
}
function bench() {
  let now = 100;
  let available = true;
  const messages: DriveIntent[] = [];
  const drive = new DrivePublisher((intent) => { messages.push(intent); }, () => available, () => now);
  function status(state: string, id = "s1", retained = false) {
    drive.mobileStatus(JSON.stringify({type: "mobile_status", device_id: "esp12e_carbot", control_session_id: id,
      state, esp_online: true, calibrated: true}), retained);
  }
  return { drive, messages, status, advance(ms: number) { now += ms; }, disconnect() { available = false; } };
}

describe("phone-mediated drive", () => {
  test("centre Stop reflects phone availability and pending stops, including after video loss", async () => {
    const b = bench();
    expect(b.drive.stopState).toBe("unavailable");
    b.drive.grant(grant());
    expect(b.drive.stopState).toBe("unavailable");
    b.status("ready");
    expect(b.drive.stopState).toBe("available");
    await b.drive.start("forward");
    b.disconnect();
    await b.drive.tick();
    expect(b.drive.ready).toBe(false);
    expect(b.drive.stopState).toBe("pending");
    b.status("disarmed", "other-session");
    b.status("disarmed", "s1", true);
    expect(b.drive.stopState).toBe("pending");
    await b.drive.stop(true);
    expect(b.messages.map(i => [i.action, i.speed])).toEqual([["forward", 35], ["stop", 0], ["stop", 0]]);
    b.status("disarmed");
    expect(b.drive.stopState).toBe("disarmed");
    b.advance(2501);
    expect(b.drive.stopState).toBe("unavailable");
    b.status("ready");
    b.advance(10000);
    expect(b.drive.stopState).toBe("unavailable");
  });

  test("accepted hold creates distinct signed, expiring intentions and one stop on leave", async () => {
    const { drive, messages, status, advance } = bench();
    drive.grant(grant());
    status("ready");
    await drive.start("forward");
    advance(100); await drive.tick();
    await drive.stop();
    await drive.stop();
    advance(100); await drive.tick();
    expect(messages.map(i => i.action)).toEqual(["forward", "forward", "stop"]);
    expect(messages.map(i => i.seq)).toEqual([1, 2, 3]);
    expect(new Set(messages.map(i => i.command_id)).size).toBe(3);
    expect(messages[0]?.sent_at).toBe("2026-01-01T00:00:00.000Z");
    expect(messages[1]?.sent_at).toBe("2026-01-01T00:00:00.100Z");
    const first = messages[0]!;
    const canonical = ["esp12e_carbot", "s1", first.command_id, 1, "forward", 35, first.sent_at, 300].join("\n");
    expect(first.signature).toBe(createHmac("sha256", Buffer.from(key, "hex")).update(canonical).digest("hex"));
    expect(first.type).toBe("drive_intent");
    expect(messages[2]?.speed).toBe(0);
  });
  test("ignores wrong-session and retained status and waits for phone readiness", async () => {
    const { drive, messages, status } = bench();
    status("ready"); await drive.start("right");
    drive.grant(grant());
    status("ready", "s2"); status("ready", "s1", true); await drive.start("right");
    status("disarmed"); await drive.start("right");
    expect(messages).toHaveLength(0);
    status("ready"); await drive.start("left");
    status("fault"); await drive.tick();
    expect(messages.filter(i => i.action !== "stop").map(i => i.action)).toEqual(["left"]);
  });
  test("stale mobile or unavailable video/gaze context clears a hold and never resumes it", async () => {
    const b = bench();
    b.drive.grant(grant()); b.status("ready"); await b.drive.start("left");
    b.advance(3000); await b.drive.tick();
    b.status("disarmed"); b.status("ready"); await b.drive.tick();
    expect(b.messages.map(i => i.action)).toEqual(["left", "stop"]);
    await b.drive.start("backward"); b.disconnect(); await b.drive.tick();
    expect(b.messages.map(i => i.action)).toEqual(["left", "stop", "backward", "stop"]);
  });
  test("renewal preserves sequence, replacement cancels, and expired grants cannot start", async () => {
    const b = bench();
    b.drive.grant(grant()); b.status("ready"); await b.drive.start("left");
    b.advance(100); b.drive.grant(grant("s1", epoch + 100)); await b.drive.tick();
    b.drive.grant(grant("s2", epoch + 100)); await b.drive.tick();
    await b.drive.start("right"); b.status("ready", "s2"); b.advance(10001); await b.drive.start("right");
    expect(b.messages.filter(i => i.action !== "stop").map(i => [i.seq, i.control_session_id])).toEqual([[1, "s1"], [2, "s1"]]);
  });
  test("a delayed ready report after release cannot rearm the phone", async () => {
    const b = bench();
    b.drive.grant(grant()); b.status("ready"); await b.drive.start("left");
    await b.drive.stop(); b.status("ready"); await b.drive.start("right");
    expect(b.messages.map(i => i.action)).toEqual(["left", "stop"]);
    b.status("disarmed"); b.status("ready"); await b.drive.start("right");
    expect(b.messages.at(-1)?.action).toBe("right");
  });
  test("an explicit enable after a stop is acknowledged can recover from a dropped disarmed report", async () => {
    const b = bench();
    b.drive.grant(grant()); b.status("ready"); await b.drive.start("left");
    await b.drive.stop();
    b.drive.mobileStatus(JSON.stringify({type: "mobile_status", device_id: "esp12e_carbot", control_session_id: "s1",
      state: "ready", esp_online: true, calibrated: true, last_command_id: b.messages.at(-1)?.command_id}), false);
    await b.drive.start("right");
    expect(b.messages.map(i => i.action)).toEqual(["left", "stop", "right"]);
  });
  test("revocation is session-scoped and discards the capability, including matching MQTT status", async () => {
    const b = bench();
    b.drive.grant(grant()); b.status("ready");
    b.drive.revoke("another-session"); await b.drive.start("left");
    b.drive.revoke("s1"); b.status("ready"); await b.drive.start("forward"); await b.drive.tick();
    expect(b.messages.filter(i => i.action !== "stop").map(i => i.action)).toEqual(["left"]);
  });
  test("a stalled event loop cannot resume an expired hold and early ticks cannot flood MQTT", async () => {
    const b = bench();
    b.drive.grant(grant()); b.status("ready"); await b.drive.start("left");
    b.advance(5); await b.drive.tick();
    b.advance(300); b.status("ready"); await b.drive.tick();
    expect(b.messages.map(i => i.action)).toEqual(["left", "stop"]);
  });
  test("release from another input cannot stop or take ownership of a held direction", async () => {
    for (const owner of ["gaze", "pointer", "keyboard"] as const) {
      for (const other of ["gaze", "pointer", "keyboard"] as const) {
        if (owner === other) continue;
        const b = bench();
        b.drive.grant(grant()); b.status("ready");
        await b.drive.start("forward", owner);
        await b.drive.start("forward", other);
        await b.drive.release("forward", other);
        expect(b.messages.map(i => i.action)).toEqual(["forward"]);
        await b.drive.release("forward", owner);
        expect(b.messages.map(i => i.action)).toEqual(["forward", "stop"]);
      }
    }
  });
  test("a fresh explicit Stop recovers when a quick release sends only a stop and the phone misses it", async () => {
    const b = bench();
    b.drive.grant(grant()); b.status("ready");
    await Promise.all([b.drive.start("forward"), b.drive.stop()]);
    b.status("ready"); await b.drive.start("right"); await b.drive.tick();
    expect(b.messages.map(i => i.action)).toEqual(["stop"]);
    expect(b.drive.stopState).toBe("pending");
    b.advance(1000); await b.drive.stop(true);
    expect(b.messages.map(i => i.action)).toEqual(["stop", "stop"]);
    expect(b.messages[1]!.seq).toBeGreaterThan(b.messages[0]!.seq);
    expect(b.messages[1]!.sent_at).not.toBe(b.messages[0]!.sent_at);
    b.status("disarmed"); b.status("ready");
    await b.drive.tick();
    expect(b.drive.stopState).toBe("available");
    expect(b.messages).toHaveLength(2);
    await b.drive.start("right");
    expect(b.messages.at(-1)!.action).toBe("right");
  });
  test("release cancels a movement still being signed", async () => {
    const b = bench();
    b.drive.grant(grant()); b.status("ready");
    await Promise.all([b.drive.start("forward"), b.drive.stop()]);
    expect(b.messages.map(i => i.action)).toEqual(["stop"]);
  });
});
