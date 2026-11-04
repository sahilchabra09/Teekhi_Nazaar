export interface HubMessage {
  type: string;
  ts?: number;
  [key: string]: unknown;
}

/** Structural adapter: the production hub only needs to provide send and on. */
export interface HubClient {
  send(message: HubMessage): void;
  on(type: string, callback: (message: HubMessage) => void): () => void;
}

export interface RobotStream {
  remote: MediaStream | null;
  state: "idle" | "connecting" | "live" | "fallback" | "failed";
  fallbackFrameUrl: string | null;
}

const initial = (): RobotStream => ({ remote: null, state: "idle", fallbackFrameUrl: null });

/** Owns received tracks and peer connections. The caller retains ownership of its webcam. */
export class RobotStreamConnection {
  private peer: RTCPeerConnection | null = null;
  private remote: MediaStream | null = null;
  private serial: Promise<void> = Promise.resolve();
  private earlyIce: RTCIceCandidateInit[] = [];
  private epoch = 0;
  private closed = false;
  private snapshot = initial();
  private unsubscribe: (() => void)[] = [];

  constructor(
    private hub: HubClient,
    private changed: (stream: RobotStream) => void,
    private local?: MediaStream,
  ) {
    this.unsubscribe = [
      hub.on("rtc_offer", (message) => {
        if (typeof message.sdp === "string" && message.sdp.length < 256_000) this.offer(message.sdp);
      }),
      hub.on("rtc_ice", (message) => this.candidate(message.candidate)),
      hub.on("frame", (message) => this.frame(message)),
      hub.on("peer_status", (message) => {
        if (message.phone === false) this.reset();
        else if (message.phone === true) {
          // Subscriptions exist before asking the mounted phone for a fresh offer.
          try { hub.send({ type: "media_ready", device_id: "esp12e_carbot", ts: Date.now() }); } catch { /* Reconnect will retry. */ }
        }
      }),
    ];
    this.publish(initial());
  }

  private publish(value: RobotStream) {
    if (!this.closed) { this.snapshot = value; this.changed(value); }
  }

  private closePeer() {
    const peer = this.peer;
    this.peer = null;
    if (peer) {
      peer.ontrack = null;
      peer.onicecandidate = null;
      peer.onconnectionstatechange = null;
      peer.close();
    }
    this.remote?.getTracks().forEach((track) => track.stop());
    this.remote = null;
  }

  private clearFrame() {
    if (this.snapshot.fallbackFrameUrl) URL.revokeObjectURL(this.snapshot.fallbackFrameUrl);
  }

  private offer(sdp: string) {
    if (this.closed) return;
    const hadPeer = this.peer !== null;
    const pending = hadPeer ? [] : this.earlyIce.splice(0);
    const epoch = ++this.epoch;
    this.closePeer();
    this.clearFrame();
    this.publish({ remote: null, state: "connecting", fallbackFrameUrl: null });
    let peer: RTCPeerConnection;
    try {
      peer = new RTCPeerConnection({ iceServers: [] });
      this.peer = peer;
      this.remote = new MediaStream();
      // The browser sends only the explicitly shared local video track.
      peer.ontrack = ({ track }) => {
        if (this.peer !== peer || this.closed) return;
        if (!this.remote!.getTracks().some((existing) => existing.id === track.id)) this.remote!.addTrack(track);
        this.publish({ remote: this.remote, state: "live", fallbackFrameUrl: null });
      };
      peer.onicecandidate = ({ candidate }) => {
        if (candidate && this.peer === peer && !this.closed) {
          this.hub.send({ type: "rtc_ice", candidate: candidate.toJSON(), ts: Date.now() });
        }
      };
      peer.onconnectionstatechange = () => {
        if (this.peer !== peer || this.closed) return;
        if (peer.connectionState === "failed") this.publish({ ...this.snapshot, state: "failed" });
        else if (peer.connectionState === "disconnected") this.publish({ ...this.snapshot, state: "connecting" });
        else if (peer.connectionState === "connected") this.publish({ ...this.snapshot, state: "live" });
      };
    } catch {
      this.closePeer();
      this.publish({ remote: null, state: "failed", fallbackFrameUrl: null });
      return;
    }
    this.serial = this.serial.catch(() => {}).then(async () => {
      if (epoch !== this.epoch || this.closed) return;
      await peer.setRemoteDescription({ type: "offer", sdp });
      // Reserve a send direction even before the patient shares a camera. Later changes
      // can replaceTrack without recreating the peer or making the browser an offerer.
      const video = peer.getTransceivers().find((item) => item.receiver.track.kind === "video");
      if (video) {
        video.direction = "sendrecv";
        await video.sender.replaceTrack(this.local?.getVideoTracks()[0] ?? null);
      }
      peer.getTransceivers().filter((item) => item.receiver.track.kind === "audio").forEach((item) => { item.direction = "recvonly"; });
      for (const candidate of pending) await peer.addIceCandidate(candidate);
      const answer = await peer.createAnswer();
      if (epoch !== this.epoch || this.closed) return;
      await peer.setLocalDescription(answer);
      if (epoch === this.epoch && !this.closed) {
        this.hub.send({ type: "rtc_answer", sdp: peer.localDescription?.sdp ?? answer.sdp, ts: Date.now() });
      }
    }).catch(() => {
      if (epoch === this.epoch && !this.closed) this.publish({ ...this.snapshot, state: "failed" });
    });
  }

  setLocal(local?: MediaStream): Promise<void> {
    const peer = this.peer;
    if (!peer || this.closed) {
      this.local = local;
      return Promise.resolve();
    }
    const handoff = this.serial.then(async () => {
      if (peer === this.peer && !this.closed) {
        const video = peer.getTransceivers().find((item) => item.receiver.track.kind === "video");
        if (video) await video.sender.replaceTrack(local?.getVideoTracks()[0] ?? null);
      }
      this.local = local;
    });
    this.serial = handoff.catch(() => {});
    return handoff;
  }

  private candidate(raw: unknown) {
    if (this.closed || !raw || typeof raw !== "object") return;
    const data = raw as Record<string, unknown>;
    if (typeof data.candidate !== "string" || data.candidate.length > 8192) return;
    if (data.sdpMid != null && typeof data.sdpMid !== "string") return;
    if (data.sdpMLineIndex != null && (!Number.isInteger(data.sdpMLineIndex) || Number(data.sdpMLineIndex) < 0)) return;
    const candidate: RTCIceCandidateInit = {
      candidate: data.candidate,
      sdpMid: (data.sdpMid as string | null | undefined) ?? null,
      sdpMLineIndex: (data.sdpMLineIndex as number | null | undefined) ?? null,
    };
    const peer = this.peer;
    const epoch = this.epoch;
    if (!peer) { if (this.earlyIce.length < 128) this.earlyIce.push(candidate); return; }
    this.serial = this.serial.catch(() => {}).then(async () => {
      if (epoch === this.epoch && !this.closed) await peer.addIceCandidate(candidate);
    }).catch(() => {}); // Invalid/stale ICE must not tear down an otherwise healthy peer.
  }

  private frame(message: HubMessage) {
    if (this.closed || typeof message.jpeg_b64 !== "string" || message.jpeg_b64.length > 2_000_000 ||
      !Number.isInteger(message.w) || !Number.isInteger(message.h) || Number(message.w) <= 0 || Number(message.h) <= 0) return;
    try {
      const binary = atob(message.jpeg_b64);
      if (binary.charCodeAt(0) !== 255 || binary.charCodeAt(1) !== 216) return;
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
      this.epoch++;
      this.closePeer();
      this.clearFrame();
      this.publish({ remote: null, state: "fallback", fallbackFrameUrl: url });
    } catch { /* Ignore malformed fallback frames. */ }
  }

  reset() {
    this.epoch++;
    this.closePeer();
    this.earlyIce = [];
    this.clearFrame();
    this.publish(initial());
  }

  close() {
    if (this.closed) return;
    this.reset();
    this.closed = true;
    this.unsubscribe.forEach((unsubscribe) => unsubscribe());
    this.unsubscribe = [];
  }
}
