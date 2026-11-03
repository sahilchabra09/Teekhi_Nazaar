/**
 * Says text out loud on THIS device with the browser's speech synthesis.
 * Temporary: once the robot phone is connected, the console sends a `speak` message instead
 * and the phone's speaker says it (docs/interfaces.md §3).
 */
export function speakAloud(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return resolve();

    const synth = window.speechSynthesis;
    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    const voice = pickVoice(synth.getVoices());
    if (voice) utterance.voice = voice;

    // Chrome sometimes never fires `end` for long-idle synths; don't hang the UI on it.
    const fallback = setTimeout(resolve, 1500 + text.length * 90);
    const done = () => {
      clearTimeout(fallback);
      resolve();
    };
    utterance.onend = done;
    utterance.onerror = done;
    synth.speak(utterance);
  });
}

export function stopSpeaking() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}

function pickVoice(voices: SpeechSynthesisVoice[]) {
  const english = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  return (
    english.find((v) => /natural|neural|premium|enhanced/i.test(v.name)) ??
    english.find((v) => v.lang === "en-IN") ??
    english.find((v) => v.default) ??
    english[0] ??
    null
  );
}
