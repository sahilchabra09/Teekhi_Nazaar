import type { HubMessage } from "../rtc/robot-stream";

export type ReplySource = "suggestion" | "phrase" | "system";
export type ConsoleView =
  | { name: "home" | "drive" | "communicate" | "phrases" | "appliances" | "listen" | "call" | "call-menu" | "call-phrases" }
  // "Say something" with the laptop mic (docs/talk.md): listening → thinking → suggestions / no-speech
  | { name: "listening"; speaking: boolean }
  | { name: "thinking"; heard?: string }
  | { name: "no-speech" }
  | { name: "suggestions"; utteranceId: string; heard: string; replies: string[]; lowConfidence: boolean }
  | { name: "confirm"; text: string; source: ReplySource; from: ConsoleView }
  | { name: "speaking"; text: string; speakId: string; replyTurnId?: string; after?: "listen" | "home" | "call" };
export type CallReply = { turnId: string; conversationId: string; heard: string; replies: string[]; lowConfidence: boolean };
export interface ConversationState {
  callReplies: CallReply[];
  view: ConsoleView;
  error: string | null;
}
export const initialConversation: ConversationState = { view: { name: "home" }, error: null, callReplies: [] };
type Action =
  | { type: "call-reply"; reply: CallReply }
  | { type: "skip-reply" }
  | { type: "refresh-reply"; turnId: string; replies: string[] }
  | { type: "navigate"; view: ConsoleView }
  | { type: "event"; message: HubMessage }
  | { type: "disconnected" }
  | { type: "timeout"; speakId: string }
  | { type: "clear_error" };

function finish(state: ConversationState, error: string | null = null): ConversationState {
  const name = state.view.name === "speaking" ? state.view.after ?? "home" : "home";
  const consumed = !error && state.view.name === "speaking" && state.view.replyTurnId === state.callReplies[0]?.turnId;
  return { view: { name }, error, callReplies: name !== "call" ? [] : consumed ? state.callReplies.slice(1) : state.callReplies };
}

export function conversationReducer(state: ConversationState, action: Action): ConversationState {
  if (action.type === "clear_error") return { ...state, error: null };
  if (action.type === "navigate") {
    const reset = ["home", "drive", "communicate", "appliances", "listen"].includes(action.view.name);
    return { view: action.view, error: null, callReplies: reset ? [] : state.callReplies };
  }
  if (action.type === "call-reply") {
    // Keep the current choices stable even when another person speaks during selection or playback.
    return { ...state, callReplies: [...state.callReplies, action.reply] };
  }
  if (action.type === "skip-reply") return { ...state, view: { name: "call" }, callReplies: state.callReplies.slice(1) };
  if (action.type === "refresh-reply") return { ...state, callReplies: state.callReplies.map(reply =>
    reply.turnId === action.turnId ? { ...reply, replies: action.replies } : reply) };
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
