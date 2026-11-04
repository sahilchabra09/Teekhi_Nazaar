/**
 * When does the next utterance start a NEW conversation (and a new AutoSage chat)?
 * The server can't tell who is speaking (speech-to-text gives words, not voices), so it uses:
 *  1. silence: nobody spoke for SILENCE_MS → the previous person has most likely left;
 *  2. an opener ("hi", "hello", "good morning", "I'm Ravi…") after OPENER_GAP_MS of quiet →
 *     most likely someone new arriving, even if the previous person just stopped talking.
 * The patient can still end a conversation any time (Ignore / Cancel / back home).
 */
export const SILENCE_MS = 90 * 1000;
export const OPENER_GAP_MS = 15 * 1000;

const OPENER = [
  /^(hi|hii+|hello|hey|hiya|howdy|namaste|namaskar|hola|bonjour|salaam|assalamu\s*alaikum|sat\s*sri\s*akal)\b/i,
  /^good\s+(morning|afternoon|evening|day)\b/i,
  /^(excuse me|sorry to (bother|disturb) you)\b/i,
];
const INTRO = /\b(i'?m|i am|my name is|this is)\s+(the\s+)?(new\s+)?[a-z]+/i;

/** True if the line sounds like someone starting a conversation. */
export function looksLikeOpener(heard: string) {
  const text = heard.trim().replace(/^[^\p{L}]+/u, "");
  if (OPENER.some((re) => re.test(text))) return true;
  // "I'm Ravi from the kitchen", "This is Dr. Mehta" … within the first few words.
  const head = text.split(/\s+/).slice(0, 6).join(" ");
  return INTRO.test(head) && !/\b(i'?m|i am)\s+(fine|okay|ok|good|sure|not|so|very|sorry|done|back)\b/i.test(head);
}
