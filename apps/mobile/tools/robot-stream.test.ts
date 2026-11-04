import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { RobotStreamConnection } from "../../web/src/lib/rtc/robot-stream";
import type { HubClient, HubMessage, RobotStream } from "../../web/src/lib/rtc/robot-stream";

class FakeStream {
  tracks: MediaStreamTrack[] = [];
  getTracks() { return this.tracks; }
  getVideoTracks() { return this.tracks.filter((track) => track.kind === "video"); }
  addTrack(track: MediaStreamTrack) { this.tracks.push(track); }
}
class FakePeer {
  static instances: FakePeer[] = [];
  static blocked: Promise<void> | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  localDescription: RTCSessionDescriptionInit | null = null;
  connectionState = "new";
  candidates: RTCIceCandidateInit[] = [];
  sentTracks: MediaStreamTrack[] = [];
  videoTransceiver = { direction: "recvonly", receiver: { track: { kind: "video" } }, sender: {
    replaceTrack: async (track: MediaStreamTrack | null) => { if (track) this.sentTracks.push(track); },
  } };
  audioTransceiver = { direction: "recvonly", receiver: { track: { kind: "audio" } } };
  closed = false;
  ontrack: ((event: { track: MediaStreamTrack }) => void) | null = null;
  onicecandidate: unknown = null;
  onconnectionstatechange: unknown = null;
  constructor() { FakePeer.instances.push(this); }
  async setRemoteDescription(sdp: RTCSessionDescriptionInit) { if (FakePeer.blocked) await FakePeer.blocked; this.remoteDescription = sdp; }
  async createAnswer() { return { type: "answer", sdp: "answer-sdp" }; }
  async setLocalDescription(sdp: RTCSessionDescriptionInit) { this.localDescription = sdp; }
  async addIceCandidate(candidate: RTCIceCandidateInit) {
    if (!this.remoteDescription) throw new Error("ICE before description");
    this.candidates.push(candidate);
  }
  addTrack(track: MediaStreamTrack) { this.sentTracks.push(track); }
  getTransceivers() { return [this.videoTransceiver, this.audioTransceiver]; }
  close() { this.closed = true; }
}
class FakeHub implements HubClient {
  handlers = new Map<string, Set<(message: HubMessage) => void>>();
  sent: HubMessage[] = [];
  send(message: HubMessage) { this.sent.push(message); }
  on(type: string, callback: (message: HubMessage) => void) {
    const set = this.handlers.get(type) ?? new Set(); set.add(callback); this.handlers.set(type, set);
    return () => { set.delete(callback); };
  }
  emit(message: HubMessage) { this.handlers.get(message.type)?.forEach((callback) => callback(message)); }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
const oldPeer = globalThis.RTCPeerConnection;
const oldStream = globalThis.MediaStream;
const connections: RobotStreamConnection[] = [];
beforeAll(() => {
  globalThis.RTCPeerConnection = FakePeer as unknown as typeof RTCPeerConnection;
  globalThis.MediaStream = FakeStream as unknown as typeof MediaStream;
});
beforeEach(() => { FakePeer.instances = []; FakePeer.blocked = null; });
afterEach(() => { connections.splice(0).forEach((connection) => connection.close()); });
afterAll(() => { globalThis.RTCPeerConnection = oldPeer; globalThis.MediaStream = oldStream; });

test("queues early ICE, answers the phone and only sends the caller's video track", async () => {
  const hub = new FakeHub(); const states: RobotStream[] = [];
  const local = new FakeStream(); let stopped = 0;
  const video = { id: "webcam", kind: "video", stop() { stopped++; } } as MediaStreamTrack;
  const audio = { id: "private-mic", kind: "audio", stop() { stopped++; } } as MediaStreamTrack;
  local.addTrack(video); local.addTrack(audio);
  connections.push(new RobotStreamConnection(hub, (state) => states.push(state), local as unknown as MediaStream));
  hub.emit({ type: "rtc_ice", candidate: { candidate: "before-offer", sdpMid: "0", sdpMLineIndex: 0 } });
  hub.emit({ type: "rtc_offer", sdp: "phone-sdp" });
  hub.emit({ type: "rtc_ice", candidate: { candidate: "after-offer", sdpMLineIndex: 0 } });
  await settle();
  const peer = FakePeer.instances[0]!;
  expect(peer.candidates.map((candidate) => candidate.candidate)).toEqual(["before-offer", "after-offer"]);
  expect(peer.sentTracks).toEqual([video]);
  expect(hub.sent.some((message) => message.type === "rtc_answer" && message.sdp === "answer-sdp")).toBe(true);
  peer.ontrack?.({ track: { id: "robot-audio", kind: "audio", stop() {} } as MediaStreamTrack });
  peer.ontrack?.({ track: { id: "robot-video", kind: "video", stop() {} } as MediaStreamTrack });
  expect(states.at(-1)?.state).toBe("live"); expect(states.at(-1)?.remote?.getTracks()).toHaveLength(2);
  connections[0]!.close();
  expect(peer.closed).toBe(true); expect(stopped).toBe(0);
});

test("disconnect cancels an outstanding answer and unregisters every subscription", async () => {
  const hub = new FakeHub(); let release!: () => void;
  FakePeer.blocked = new Promise<void>((resolve) => { release = resolve; });
  const connection = new RobotStreamConnection(hub, () => {}); connections.push(connection);
  hub.emit({ type: "rtc_offer", sdp: "offer" }); await settle();
  connection.close(); release(); await settle();
  expect(hub.sent).toHaveLength(0);
  expect([...hub.handlers.values()].every((set) => set.size === 0)).toBe(true);
});

test("a gaze webcam arriving later replaces the negotiated video sender without a new offer", async () => {
  const hub = new FakeHub(); const connection = new RobotStreamConnection(hub, () => {}); connections.push(connection);
  hub.emit({ type: "rtc_offer", sdp: "offer" }); await settle();
  const peer = FakePeer.instances[0]!;
  const local = new FakeStream(); const track = { id: "late-webcam", kind: "video", stop() {} } as MediaStreamTrack;
  local.addTrack(track); connection.setLocal(local as unknown as MediaStream); await settle();
  expect(FakePeer.instances).toHaveLength(1); expect(peer.closed).toBe(false);
  expect(peer.sentTracks).toEqual([track]); expect(peer.videoTransceiver.direction).toBe("sendrecv");
  expect(peer.audioTransceiver.direction).toBe("recvonly");
});

test("fresh offers replace peers and fallback URLs are revoked on replacement and reset", async () => {
  const hub = new FakeHub(); let latest!: RobotStream;
  connections.push(new RobotStreamConnection(hub, (state) => { latest = state; }));
  hub.emit({ type: "rtc_offer", sdp: "first" }); await settle();
  hub.emit({ type: "rtc_offer", sdp: "second" }); await settle();
  expect(FakePeer.instances[0]!.closed).toBe(true);
  const frame = { type: "frame", jpeg_b64: btoa("\xff\xd8\xff\xd9"), w: 640, h: 480 };
  hub.emit(frame);
  const firstUrl = latest.fallbackFrameUrl!;
  expect(latest.state).toBe("fallback"); expect(FakePeer.instances[1]!.closed).toBe(true);
  hub.emit(frame);
  expect(latest.fallbackFrameUrl).not.toBe(firstUrl);
  expect(await fetch(firstUrl).then(() => true, () => false)).toBe(false);
  const lastUrl = latest.fallbackFrameUrl!;
  hub.emit({ type: "peer_status", phone: false });
  expect(latest.state).toBe("idle"); expect(latest.fallbackFrameUrl).toBeNull();
  expect(await fetch(lastUrl).then(() => true, () => false)).toBe(false);
});

test("malformed signaling and image data do not crash or enter live mode", () => {
  const hub = new FakeHub(); let latest!: RobotStream;
  connections.push(new RobotStreamConnection(hub, (state) => { latest = state; }));
  hub.emit({ type: "rtc_ice", candidate: null });
  hub.emit({ type: "rtc_ice", candidate: { candidate: "bad", sdpMLineIndex: "zero" } });
  hub.emit({ type: "rtc_offer", sdp: 123 });
  hub.emit({ type: "frame", jpeg_b64: "not base64", w: 640, h: 480 });
  expect(latest.state).toBe("idle"); expect(FakePeer.instances).toHaveLength(0);
});

test("phone presence requests media only after the browser listeners are installed", () => {
  const hub = new FakeHub(); connections.push(new RobotStreamConnection(hub, () => {}));
  hub.emit({ type: "peer_status", phone: true });
  expect(hub.sent.at(-1)?.type).toBe("media_ready");
  expect(hub.sent.at(-1)?.device_id).toBe("esp12e_carbot");
  expect(hub.handlers.get("rtc_offer")?.size).toBe(1);
});

test("a rejected webcam replacement preserves the previous sender for a new offer and allows a retry", async () => {
  const hub = new FakeHub();
  const local = (id: string) => {
    const stream = new FakeStream();
    stream.addTrack({ id, kind: "video" } as MediaStreamTrack);
    return stream as unknown as MediaStream;
  };
  const old = local("front");
  const next = local("usb");
  const connection = new RobotStreamConnection(hub, () => {}, old);
  connections.push(connection);
  hub.emit({ type: "rtc_offer", sdp: "first" });
  await settle();
  FakePeer.instances[0]!.videoTransceiver.sender.replaceTrack = async () => { throw new Error("sender refused"); };
  await expect(Promise.resolve(connection.setLocal(next))).rejects.toThrow("sender refused");
  hub.emit({ type: "rtc_offer", sdp: "second" });
  await settle();
  const freshPeer = FakePeer.instances[1]!;
  expect(freshPeer.sentTracks.at(-1)?.id).toBe("front");
  await connection.setLocal(next);
  expect(freshPeer.sentTracks.at(-1)?.id).toBe("usb");
});
