import type { HubMessage } from "../rtc/robot-stream";

export type ReplySource = "suggestion" | "phrase" | "system";
export type ConsoleView =
  | { name: "home" | "phrases" | "help" }
  | { name: "suggestions"; utteranceId: string; heard: string; replies: string[]; lowConfidence: boolean }
  | { name: "confirm"; text: string; source: ReplySource; from: ConsoleView }
  | { name: "speaking"; text: string; speakId: string };
type SuggestionsView = Extract<ConsoleView, { name: "suggestions" }>;
export interface ConversationState {
  view: ConsoleView;
  queued: SuggestionsView | null;
  heard: string | null;
  activeSpeech: boolean;
  error: string | null;
}
export const initialConversation: ConversationState = { view: { name: "home" }, queued: null, heard: null, activeSpeech: false, error: null };
type Action = { type: "navigate"; view: ConsoleView } | { type: "event"; message: HubMessage } | { type: "disconnected" } | { type: "timeout"; speakId: string } | { type: "clear_error" };

function finish(state: ConversationState, error: string | null = null): ConversationState {
  return { ...state, view: state.queued ?? { name: "home" }, heard: state.queued?.heard ?? state.heard, queued: null, error };
}

export function conversationReducer(state: ConversationState, action: Action): ConversationState {
  if (action.type === "clear_error") return { ...state, error: null };
  if (action.type === "navigate") return action.view.name === "home" ? finish(state) : { ...state, view: action.view, error: null };
  if (action.type === "disconnected") return state.view.name === "speaking"
    ? finish({ ...state, activeSpeech: false }, "Phone disconnected before speech completion was confirmed.")
    : { ...state, activeSpeech: false };
  if (action.type === "timeout") return state.view.name === "speaking" && state.view.speakId === action.speakId
    ? finish(state, "The phone did not confirm speech completion. Check its connection.") : state;
  const message = action.message;
  if (message.type === "speech_activity" && typeof message.active === "boolean") return { ...state, activeSpeech: message.active };
  if (message.type === "transcript" && typeof message.text === "string") return { ...state, heard: message.text.slice(0, 4000) };
  if (message.type === "suggestions") {
    if (typeof message.utterance_id !== "string" || typeof message.heard !== "string" || message.requires_user_confirmation !== true ||
      !Array.isArray(message.suggestions) || message.suggestions.length !== 3 ||
      !message.suggestions.every((reply) => typeof reply === "string" && reply.trim().length > 0 && reply.length <= 4000)) return state;
    const view: SuggestionsView = { name: "suggestions", utteranceId: message.utterance_id, heard: message.heard,
      replies: message.suggestions as string[], lowConfidence: message.low_confidence === true };
    if (state.view.name === "confirm" || state.view.name === "speaking") return { ...state, queued: view };
    return { ...state, view, heard: view.heard };
  }
  if (message.type === "tts_status" && state.view.name === "speaking" && message.speak_id === state.view.speakId) {
    if (message.state === "finished") return finish(state);
    if (message.state === "error") return finish(state, typeof message.error === "string" ? message.error : "The phone could not speak the reply.");
  }
  return state;
}
