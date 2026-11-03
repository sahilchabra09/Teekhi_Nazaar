import { expect, test } from "bun:test";
import { createApplicationHub, hubWebSocketUrl } from "../../web/src/lib/hub/client";
import type { HubState } from "../../web/src/lib/hub/client";
import { conversationReducer, initialConversation } from "../../web/src/lib/robot/conversation";
import type { ConversationState, ConsoleView } from "../../web/src/lib/robot/conversation";
import { startDevHub } from "./dev-hub";

const suggestion = (id = "u1") => ({ type: "suggestions", utterance_id: id, heard: `Question ${id}`,
  suggestions: ["Yes, please.", "No, thank you.", "Give me a moment."], requires_user_confirmation: true, low_confidence: false, ts: Date.now() });
async function until(check: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!check()) { if (Date.now() > deadline) throw new Error("Timed out waiting for connection"); await Bun.sleep(5); }
}

test("console queues new replies during confirmation and waits for its own phone TTS result", () => {
  let state = conversationReducer(initialConversation, { type: "event", message: suggestion() });
  expect(state.view.name).toBe("suggestions");
  const from = state.view;
  state = conversationReducer(state, { type: "navigate", view: { name: "confirm", text: "Yes, please.", source: "suggestion", from } });
  state = conversationReducer(state, { type: "event", message: suggestion("u2") });
  expect(state.view.name).toBe("confirm"); expect(state.queued?.utteranceId).toBe("u2");
  state = conversationReducer(state, { type: "navigate", view: { name: "speaking", text: "Yes, please.", speakId: "s1" } });
  state = conversationReducer(state, { type: "event", message: { type: "tts_status", speak_id: "other", state: "finished" } });
  expect(state.view.name).toBe("speaking");
  state = conversationReducer(state, { type: "event", message: { type: "tts_status", speak_id: "s1", state: "started" } });
  expect(state.view.name).toBe("speaking");
  state = conversationReducer(state, { type: "event", message: { type: "tts_status", speak_id: "s1", state: "finished" } });
  expect((state.view as Extract<ConsoleView, { name: "suggestions" }>).utteranceId).toBe("u2");
  expect(state.heard).toBe("Question u2"); expect(state.queued).toBeNull();
});

test("unconfirmed or malformed suggestions are ignored and low confidence is explicit", () => {
  expect(conversationReducer(initialConversation, { type: "event", message: { ...suggestion(), requires_user_confirmation: false } })).toBe(initialConversation);
  expect(conversationReducer(initialConversation, { type: "event", message: { ...suggestion(), suggestions: ["only one"] } })).toBe(initialConversation);
  const state = conversationReducer(initialConversation, { type: "event", message: { ...suggestion(), low_confidence: true } });
  expect(state.view.name).toBe("suggestions");
  expect((state.view as Extract<ConsoleView, { name: "suggestions" }>).lowConfidence).toBe(true);
});

test("disconnect and matching TTS error never report successful completion", () => {
  const speaking: ConversationState = { ...initialConversation, activeSpeech: true, view: { name: "speaking", text: "Hello", speakId: "s1" } };
  const lost = conversationReducer(speaking, { type: "disconnected" });
  expect(lost.activeSpeech).toBe(false); expect(lost.error).toContain("before speech completion");
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
