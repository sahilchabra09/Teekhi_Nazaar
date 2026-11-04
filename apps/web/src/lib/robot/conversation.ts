import type { HubMessage } from "../rtc/robot-stream";

export type ReplySource = "suggestion" | "phrase" | "system";
export type ConsoleView =
  | { name: "home" | "drive" | "communicate" | "phrases" | "appliances" | "listen" }
  // "Say something" with the laptop mic (docs/talk.md): listening → thinking → suggestions / no-speech
  | { name: "listening"; speaking: boolean }
  | { name: "thinking"; heard?: string }
  | { name: "no-speech" }
  | { name: "suggestions"; utteranceId: string; heard: string; replies: string[]; lowConfidence: boolean }
  | { name: "confirm"; text: string; source: ReplySource; from: ConsoleView }
  | { name: "speaking"; text: string; speakId: string; after?: "listen" | "home" };
export interface ConversationState {
  view: ConsoleView;
  error: string | null;
}
export const initialConversation: ConversationState = { view: { name: "home" }, error: null };
type Action = { type: "navigate"; view: ConsoleView } | { type: "event"; message: HubMessage } | { type: "disconnected" } | { type: "timeout"; speakId: string } | { type: "clear_error" };

function finish(state: ConversationState, error: string | null = null): ConversationState {
  return { view: { name: state.view.name === "speaking" ? state.view.after ?? "home" : "home" }, error };
}

export function conversationReducer(state: ConversationState, action: Action): ConversationState {
  if (action.type === "clear_error") return { ...state, error: null };
  if (action.type === "navigate") return { view: action.view, error: null };
  if (action.type === "disconnected") return state.view.name === "speaking"
    ? finish(state, "Phone disconnected before speech completion was confirmed.") : state;
  if (action.type === "timeout") return state.view.name === "speaking" && state.view.speakId === action.speakId
    ? finish(state, "The phone did not confirm speech completion. Check its connection.") : state;
  const message = action.message;
  if (message.type === "tts_status" && state.view.name === "speaking" && message.speak_id === state.view.speakId) {
    if (message.state === "finished") return finish(state);
    if (message.state === "error") return finish(state, typeof message.error === "string" ? message.error : "The phone could not speak the reply.");
  }
  return state;
}
