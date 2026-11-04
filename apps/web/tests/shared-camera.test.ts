import { describe, expect, test } from "bun:test";
import { SharedCamera, type CameraState } from "../src/lib/robot/shared-camera";

function device() {
  const track = Object.assign(new EventTarget(), {
    kind: "video", readyState: "live", stop() { this.readyState = "ended"; },
  });
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
  return { track, stream };
}

function setup() {
  let state: CameraState = { deviceId: "", busy: false, error: null };
  let sending: MediaStream | undefined;
  let refuseNext = false;
  let handoff: { started: () => void; wait: Promise<void> } | undefined;
  const requests: { constraints: MediaStreamConstraints; resolve: (stream: MediaStream) => void; reject: (reason: unknown) => void }[] = [];
  const camera = new SharedCamera(
    (next) => { state = next; },
    async (stream) => {
      if (refuseNext) { refuseNext = false; throw new Error("sender refused"); }
      if (handoff) {
        const pending = handoff;
        handoff = undefined;
        pending.started();
        await pending.wait;
      }
      sending = stream;
    },
    (constraints) => new Promise((resolve, reject) => requests.push({ constraints, resolve, reject })),
  );
  const blockSender = () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    handoff = { started: started.resolve, wait: release.promise };
    return { started: started.promise, release: release.resolve };
  };
  return { camera, requests, blockSender, state: () => state, sending: () => sending, refuse: () => { refuseNext = true; } };
}

describe("camera shared with the phone", () => {
  test("choosing an idle camera saves the choice without acquiring it and the next share opens only that camera", async () => {
    const { camera, requests, state, sending } = setup();
    await camera.select("usb");
    expect(state().deviceId).toBe("usb");
    expect(requests).toHaveLength(0);
    const opened = camera.open();
    expect(requests[0]?.constraints).toMatchObject({ video: { deviceId: { exact: "usb" } }, audio: false });
    const first = device();
    requests[0]!.resolve(first.stream);
    await opened;
    expect(sending()).toBe(first.stream);
    expect(state().stream).toBe(first.stream);
    expect(state().busy).toBe(false);
  });

  test("missing inputs and rejected senders preserve the working device until a replacement succeeds", async () => {
    const { camera, requests, state, sending, refuse } = setup();
    const first = device();
    const open = camera.open();
    requests[0]!.resolve(first.stream);
    await open;
    const missing = camera.select("unplugged");
    requests[1]!.reject(new DOMException("no camera", "NotFoundError"));
    await missing;
    expect(state().deviceId).toBe("");
    expect(state().error).toBeTruthy();
    expect(first.track.readyState).toBe("live");
    const rejected = device();
    refuse();
    const refused = camera.select("usb");
    requests[2]!.resolve(rejected.stream);
    await refused;
    expect(sending()).toBe(first.stream);
    expect(first.track.readyState).toBe("live");
    expect(rejected.track.readyState).toBe("ended");
    const next = device();
    const retry = camera.select("usb");
    requests[3]!.resolve(next.stream);
    await retry;
    expect(sending()).toBe(next.stream);
    expect(first.track.readyState).toBe("ended");
    expect(state().deviceId).toBe("usb");
    expect(state().error).toBeNull();
    next.track.dispatchEvent(new Event("ended"));
    expect(state().stream).toBeUndefined();
    expect(state().error).toBeTruthy();
  });

  test("a late permission grant cannot override a newer choice or restart sharing after stop", async () => {
    const { camera, requests, state } = setup();
    const opening = camera.open();
    const switching = camera.select("newest");
    const late = device();
    const newest = device();
    requests[1]!.resolve(newest.stream);
    await switching;
    requests[0]!.resolve(late.stream);
    await opening;
    expect(late.track.readyState).toBe("ended");
    expect(state().stream).toBe(newest.stream);
    const pending = camera.select("another");
    camera.stop();
    const abandoned = device();
    requests[2]!.resolve(abandoned.stream);
    await pending;
    expect(newest.track.readyState).toBe("ended");
    expect(abandoned.track.readyState).toBe("ended");
    expect(state().stream).toBeUndefined();
    expect(state().busy).toBe(false);
  });
});

test("stopping releases a replacement camera immediately even while the sender is stalled", async () => {
  const { camera, requests, state, sending, blockSender } = setup();
  const blocked = blockSender();
  const candidate = device();
  const opening = camera.open();
  requests[0]!.resolve(candidate.stream);
  await blocked.started;
  camera.stop();
  expect(candidate.track.readyState).toBe("ended");
  blocked.release();
  await opening;
  expect(state().stream).toBeUndefined();
  expect(sending()).toBeUndefined();
});
