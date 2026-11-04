import { expect, test } from "bun:test";

import { looksLikeOpener, OPENER_GAP_MS, SILENCE_MS } from "../src/talk/turn-taking";

test("greetings and introductions count as someone starting a conversation", () => {
  for (const line of [
    "Hello! I'm Ravi from the kitchen.",
    "Hi there",
    "Good morning, how are you?",
    "I'm the new nurse on this ward.",
    "My name is Priya.",
    "Namaste ji",
    "Excuse me, is this room 4?",
    "This is Dr. Mehta.",
  ]) expect(looksLikeOpener(line)).toBe(true);
});

test("follow-ups and ordinary answers do not", () => {
  for (const line of [
    "Is it any better?",
    "I'm fine, thanks.",
    "Did that help?",
    "I'm not sure about that.",
    "Highlights of the report look good",
    "Okay, see you later",
  ]) expect(looksLikeOpener(line)).toBe(false);
});

test("thresholds: a long silence always switches, a greeting only after a short pause", () => {
  expect(SILENCE_MS).toBe(90_000);
  expect(OPENER_GAP_MS).toBe(15_000);
  expect(OPENER_GAP_MS).toBeLessThan(SILENCE_MS);
});
