import { expect, test } from "bun:test";
import { createApplicationHub, hubWebSocketUrl } from "../../web/src/lib/hub/client";
import type { HubState } from "../../web/src/lib/hub/client";
import { conversationReducer, initialConversation } from "../../web/src/lib/robot/conversation";
import type { ConversationState } from "../../web/src/lib/robot/conversation";
import { startDevHub } from "./dev-hub";

const suggestion = (id = "u1") => ({ type: "suggestions", utterance_id: id, heard: `Question ${id}`,
  suggestions: ["Yes, please.", "No, thank you.", "Give me a moment."], requires_user_confirmation: true, low_confidence: false, ts: Date.now() });
async function until(check: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!check()) { if (Date.now() > deadline) throw new Error("Timed out waiting for connection"); await Bun.sleep(5); }
}

test("unsolicited and late speech events never replace the patient's chosen screen", () => {
  for (const name of ["home", "drive", "listen", "appliances", "listening", "thinking"] as const) {
    const state = { ...initialConversation, view: name === "listening" ? { name, speaking: false } : { name } } as ConversationState;
    for (const message of [suggestion(), { type: "speech_activity", active: true }, { type: "transcript", text: "stale" }]) {
      expect(conversationReducer(state, { type: "event", message })).toBe(state);
    }
  }
});

test("a confirmed reply returns to the listening page without starting another capture", () => {
  const state: ConversationState = { ...initialConversation, view: { name: "speaking", speakId: "s1", text: "Hello", after: "listen" } };
  expect(conversationReducer(state, { type: "event", message: { type: "tts_status", speak_id: "old", state: "finished" } })).toBe(state);
  expect(conversationReducer(state, { type: "event", message: { type: "tts_status", speak_id: "s1", state: "finished" } }).view.name).toBe("listen");
});

test("disconnect and matching TTS error never report successful completion", () => {
  const speaking: ConversationState = { ...initialConversation, view: { name: "speaking", text: "Hello", speakId: "s1" } };
  const lost = conversationReducer(speaking, { type: "disconnected" });
  expect(lost.error).toContain("before speech completion");
  const failed = conversationReducer(speaking, { type: "event", message: { type: "tts_status", speak_id: "s1", state: "error", error: "Device voice missing" } });
  expect(failed.error).toBe("Device voice missing");
  expect(conversationReducer(speaking, { type: "timeout", speakId: "old" })).toBe(speaking);
  expect(conversationReducer(speaking, { type: "timeout", speakId: "s1" }).error).toContain("did not confirm");
});

test("shared hub normalizes LAN and secure URLs without accepting embedded credentials", () => {
  expect(hubWebSocketUrl("192.168.137.1").toString()).toBe("ws://192.168.137.1:3000/ws?role=web");
  expect(hubWebSocketUrl("https://hub.example/").toString()).toBe("wss://hub.example/ws?role=web");
  expect(() => hubWebSocketUrl("http://name:secret@hub.example")).toThrow();
  expect(() => hubWebSocketUrl("file:///tmp/hub")).toThrow();
});

test("actual console hub catches late phone presence and carries confirmed speech/TTS both ways", async () => {
  const server = startDevHub({ port: 0, hostname: "127.0.0.1" });
  const phone = new WebSocket(`ws://127.0.0.1:${server.port}/ws?role=phone`);
  const received: Record<string, unknown>[] = [];
  phone.addEventListener("message", ({ data }) => received.push(JSON.parse(String(data))));
  const states: HubState[] = [];
  const hub = createApplicationHub(`http://127.0.0.1:${server.port}`, (state) => states.push(state));
  try {
    await until(() => states.includes("connected") && phone.readyState === WebSocket.OPEN);
    await Bun.sleep(15); // subscribe after the initial peer_status has already arrived
    let present = false;
    hub.on("peer_status", (message) => { present = message.phone === true; });
    await until(() => present);
    let conversation: ConversationState = { ...initialConversation, view: { name: "speaking", text: "Hello", speakId: "s-live" } };
    hub.on("tts_status", (message) => { conversation = conversationReducer(conversation, { type: "event", message }); });
    hub.send({ type: "speak", text: "Hello", speak_id: "s-live", source: "phrase", ts: Date.now() });
    await until(() => received.some((message) => message.type === "speak" && message.speak_id === "s-live"));
    phone.send(JSON.stringify({ type: "tts_status", speak_id: "s-live", state: "finished", ts: Date.now() }));
    await until(() => conversation.view.name === "home");
    expect(conversation.error).toBeNull();
  } finally { hub.close(); phone.close(); await server.stop(true); }
});

test("a replaced console does not reconnect and steal the web role back", async () => {
  const server = startDevHub({ port: 0, hostname: "127.0.0.1" });
  const oldStates: HubState[] = []; const newStates: HubState[] = [];
  const old = createApplicationHub(`http://127.0.0.1:${server.port}`, (state) => oldStates.push(state));
  let replacement: ReturnType<typeof createApplicationHub> | undefined;
  try {
    await until(() => oldStates.includes("connected"));
    replacement = createApplicationHub(`http://127.0.0.1:${server.port}`, (state) => newStates.push(state));
    await until(() => oldStates.includes("replaced") && newStates.includes("connected"));
    await Bun.sleep(650);
    expect(oldStates.at(-1)).toBe("replaced"); expect(newStates.at(-1)).toBe("connected");
    expect(() => old.send({ type: "speak" })).toThrow();
  } finally { old.close(); replacement?.close(); await server.stop(true); }
});
