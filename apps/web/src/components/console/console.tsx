"use client";

import { Ear, LifeBuoy, LogOut, MessageSquareText, Navigation, OctagonX, Phone, ScanEye, Square, Volume2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { IrisMark } from "@/components/iris/logo";
import { authClient } from "@/lib/auth-client";
import { TalkApiError, talkApi } from "@/lib/talk/api";
import { UtteranceRecorder } from "@/lib/talk/recorder";
import { speakAloud, stopSpeaking } from "@/lib/talk/speak";

import { MicPicker, readSavedMic } from "./mic-picker";
import { type Direction, RobotFeed } from "./robot-feed";
import { type PanelCard, SidePanel } from "./side-panel";

type Replies = { heard: string; replies: string[]; lowConfidence: boolean };

type View =
  | { name: "home" }
  | { name: "phrases" }
  | { name: "help" }
  | { name: "listening"; speaking: boolean }
  | { name: "thinking"; heard?: string }
  | { name: "no-speech" }
  | ({ name: "suggestions" } & Replies)
  | { name: "confirm"; text: string; from: View; fromTalk: boolean }
  | { name: "speaking"; text: string };

const QUICK_PHRASES = ["Please come here.", "I need some help.", "Could you repeat that?"];
const TONES = ["teal", "honey", "sky"] as const;

export default function Console({ userName }: { userName: string }) {
  const router = useRouter();
  const [view, setView] = useState<View>({ name: "home" });
  const [driveEnabled, setDriveEnabled] = useState(true);
  const [moving, setMoving] = useState<Direction | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [micId, setMicId] = useState("");
  const [micLevel, setMicLevel] = useState(0);
  const [micListVersion, setMicListVersion] = useState(0);

  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recorder = useRef<UtteranceRecorder | null>(null);
  const request = useRef<AbortController | null>(null);
  /** Current conversation (one AutoSage chat). Cleared when the patient leaves conversation mode. */
  const conversationId = useRef<string | null>(null);

  useEffect(() => setMicId(readSavedMic()), []);

  // ── robot movement: short bounded bursts, re-sent while the gaze stays (interfaces.md §3)
  const move = useCallback((d: Direction) => {
    setMoving(d);
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = setTimeout(() => setMoving(null), 300);
    // TODO(hub): hub.send({ type: "move", direction: d, duration_ms: 300, seq })
  }, []);

  // ───────────────────────────── Say something (docs/talk.md) ─────────────────────────────

  const abortWork = useCallback(() => {
    recorder.current?.cancel();
    recorder.current = null;
    request.current?.abort();
    request.current = null;
    setMicLevel(0);
  }, []);

  const showError = useCallback((error: unknown) => {
    if (error instanceof DOMException && error.name === "AbortError") return; // user cancelled
    if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) {
      toast.error("Microphone access is blocked. Allow it in the browser’s address bar.");
    } else if (error instanceof DOMException && (error.name === "NotFoundError" || error.name === "OverconstrainedError")) {
      toast.error("That microphone isn’t available. Pick another one below the cards.");
    } else if (error instanceof TalkApiError) {
      toast.error(error.message);
    } else {
      toast.error("Something went wrong while listening. Try again.");
      console.error(error);
    }
    setView({ name: "home" });
  }, []);

  /** Listen for one thing someone says, then get reply suggestions for it. */
  const startListening = useCallback(async () => {
    abortWork();
    stopSpeaking();
    setView({ name: "listening", speaking: false });

    let rec: UtteranceRecorder;
    try {
      rec = await UtteranceRecorder.start({
        deviceId: micId || undefined,
        onLevel: setMicLevel,
        onSpeechStart: () => setView({ name: "listening", speaking: true }),
      });
    } catch (error) {
      return showError(error);
    }
    recorder.current = rec;
    setMicListVersion((v) => v + 1); // permission granted → device labels are available now

    try {
      const recording = await rec.done;
      recorder.current = null;
      setMicLevel(0);
      if (!recording.hadSpeech) return setView({ name: "no-speech" });

      setView({ name: "thinking" });
      const controller = new AbortController();
      request.current = controller;
      const result = await talkApi.utterance(recording.wav, conversationId.current, controller.signal);
      request.current = null;
      conversationId.current = result.conversationId;

      if (result.status === "no_speech") return setView({ name: "no-speech" });
      console.info(
        `[talk] heard in ${result.timings.sttMs} ms, replies (${result.source}) in ${result.timings.repliesMs} ms`,
        result.models,
      );
      setView({ name: "suggestions", heard: result.heard, replies: result.replies, lowConfidence: result.lowConfidence });
    } catch (error) {
      showError(error);
    }
  }, [abortWork, micId, showError]);

  const moreReplies = useCallback(
    async (heard: string) => {
      if (!conversationId.current) return;
      abortWork();
      setView({ name: "thinking", heard });
      const controller = new AbortController();
      request.current = controller;
      try {
        const result = await talkApi.moreReplies(conversationId.current, controller.signal);
        request.current = null;
        setView({ name: "suggestions", heard: result.heard, replies: result.replies, lowConfidence: result.lowConfidence });
      } catch (error) {
        showError(error);
      }
    },
    [abortWork, showError],
  );

  const speak = useCallback(
    async (text: string, fromTalk: boolean) => {
      setView({ name: "speaking", text });
      // TODO(robot phone): hub.send({ type: "speak", speak_id, text, source }) instead of speaking here.
      await speakAloud(text);
      // Part of the conversation's chat, so the next replies know what was said.
      if (fromTalk && conversationId.current) void talkApi.spoken(conversationId.current, text).catch(() => {});
      // In a conversation, the other person usually answers back: keep listening.
      if (fromTalk) void startListening();
      else setView({ name: "home" });
    },
    [startListening],
  );

  useEffect(() => () => abortWork(), [abortWork]);
  useEffect(() => () => stopSpeaking(), []);
  useEffect(() => () => stream?.getTracks().forEach((t) => t.stop()), [stream]);

  async function previewWebcam() {
    try {
      setStream(await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false }));
    } catch {
      toast.error("Camera access was blocked. Allow it in the browser’s address bar and try again.");
    }
  }

  async function signOut() {
    abortWork();
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }

  /** Leaving conversation mode ends the conversation; the next "Say something" opens a new chat. */
  const endConversation = useCallback(() => {
    const id = conversationId.current;
    conversationId.current = null;
    if (id) void talkApi.endConversation(id).catch(() => {});
  }, []);

  useEffect(() => () => endConversation(), [endConversation]);

  const goHome = () => {
    abortWork();
    stopSpeaking();
    endConversation();
    setView({ name: "home" });
  };
  const confirm = (text: string, from: View, fromTalk: boolean) => setView({ name: "confirm", text, from, fromTalk });

  // ───────────────────────────── panel content per view ─────────────────────────────

  let heading = "What would you like to do?";
  let back: { label: string; onSelect: () => void } | undefined;
  let extra: { label: string; onSelect: () => void } | undefined;
  let cards: PanelCard[] = [];
  let feedStatus: string | null = null;

  switch (view.name) {
    case "home":
      cards = [
        {
          kind: "action",
          key: "drive",
          title: driveEnabled ? "Driving is on" : "Driving is off",
          hint: driveEnabled ? "Look here to pause driving" : "Look here to drive again",
          icon: Navigation,
          tone: driveEnabled ? "teal" : "plain",
          onSelect: () => setDriveEnabled((d) => !d),
        },
        {
          kind: "action",
          key: "talk",
          title: "Say something",
          hint: "Listen and suggest replies",
          icon: MessageSquareText,
          tone: "honey",
          onSelect: () => void startListening(),
        },
        { kind: "action", key: "help", title: "Help", hint: "Caregiver, eyes, stop", icon: LifeBuoy, tone: "sky", onSelect: () => setView({ name: "help" }) },
      ];
      break;

    case "listening":
      heading = view.speaking ? "Hearing them…" : "Listening…";
      feedStatus = view.speaking ? "Hearing someone speak" : "Listening for someone to speak";
      cards = [
        {
          kind: "preview",
          key: "listening",
          text: view.speaking ? "Hearing them…" : "Waiting for someone to speak",
          hint: "Stops on its own when they finish",
          level: micLevel,
        },
        { kind: "action", key: "done", title: "They’re done", icon: Square, tone: "honey", onSelect: () => recorder.current?.stop() },
        { kind: "action", key: "cancel", title: "Cancel", icon: X, tone: "plain", onSelect: goHome },
      ];
      break;

    case "thinking":
      heading = "Finding replies…";
      feedStatus = view.heard ? null : "Understanding what they said";
      cards = [{ kind: "preview", key: "thinking", text: view.heard ? "Writing new replies…" : "Understanding what they said…", busy: true }];
      back = { label: "Cancel", onSelect: goHome };
      break;

    case "no-speech":
      heading = "Didn’t catch that";
      back = { label: "Back", onSelect: goHome };
      cards = [
        { kind: "action", key: "again", title: "Listen again", icon: Ear, tone: "teal", onSelect: () => void startListening() },
        { kind: "action", key: "phrases", title: "Quick phrases", icon: MessageSquareText, tone: "honey", onSelect: () => setView({ name: "phrases" }) },
        { kind: "action", key: "home", title: "Go back", icon: X, tone: "plain", onSelect: goHome },
      ];
      break;

    case "suggestions":
      heading = view.lowConfidence ? "Not sure I heard right" : "Pick a reply";
      back = { label: "Ignore", onSelect: goHome };
      extra = { label: "New replies", onSelect: () => void moreReplies(view.heard) };
      cards = view.replies.map((r, i) => ({
        kind: "action",
        key: r,
        title: r,
        tone: TONES[i % TONES.length]!,
        onSelect: () => confirm(r, view, true),
      }));
      break;

    case "phrases":
      heading = "Quick phrases";
      back = { label: "Back", onSelect: goHome };
      cards = QUICK_PHRASES.map((p, i) => ({
        kind: "action",
        key: p,
        title: p,
        tone: TONES[i]!,
        onSelect: () => confirm(p, view, false),
      }));
      break;

    case "help":
      heading = "Help";
      back = { label: "Back", onSelect: goHome };
      cards = [
        {
          kind: "action",
          key: "caregiver",
          title: "Call my caregiver",
          icon: Phone,
          tone: "honey",
          onSelect: () => {
            toast.success("Caregiver alert sent");
            setView({ name: "home" });
          },
        },
        {
          kind: "action",
          key: "recalibrate",
          title: "Recalibrate my eyes",
          icon: ScanEye,
          tone: "sky",
          onSelect: () => toast("Calibration starts once eye tracking is connected."),
        },
        {
          kind: "action",
          key: "stop",
          title: "Stop the robot",
          icon: OctagonX,
          tone: "tomato",
          onSelect: () => {
            setMoving(null);
            setDriveEnabled(false);
            toast.success("Robot stopped. Driving is off.");
            setView({ name: "home" });
          },
        },
      ];
      break;

    case "confirm":
      heading = "Say this out loud?";
      cards = [
        { kind: "preview", key: "preview", text: `“${view.text}”` },
        { kind: "action", key: "speak", title: "Speak it", icon: Volume2, tone: "honey", onSelect: () => void speak(view.text, view.fromTalk) },
        { kind: "action", key: "cancel", title: "Cancel", icon: X, tone: "plain", onSelect: () => setView(view.from) },
      ];
      break;

    case "speaking":
      heading = "IRIS is speaking";
      cards = [{ kind: "preview", key: "speaking", text: `“${view.text}”`, speaking: true }];
      break;
  }

  const heard = view.name === "suggestions" ? view.heard : view.name === "thinking" && view.heard ? view.heard : null;

  return (
    <main className="grid h-svh grid-cols-1 gap-3 bg-mist p-3 md:grid-cols-[minmax(0,4fr)_minmax(14rem,1fr)]">
      {/* left: camera fills the whole height */}
      <div className="min-h-[55vh] md:min-h-0">
        <RobotFeed
          stream={stream}
          mirrored
          driveEnabled={driveEnabled && view.name !== "speaking"}
          moving={moving}
          heard={heard}
          heardLabel={view.name === "suggestions" && view.lowConfidence ? "I think they said" : "Someone nearby said"}
          status={feedStatus}
          onMove={move}
          onPreviewWebcam={previewWebcam}
        />
      </div>

      {/* right: three cards */}
      <SidePanel
        heading={heading}
        back={back}
        extra={extra}
        cards={cards}
        footer={
          <div className="flex flex-col gap-1 px-1 pt-1">
            {/* testing aid: which mic "Say something" listens with (the robot phone's mic later) */}
            <MicPicker value={micId} onChange={setMicId} refreshKey={micListVersion} />
            <div className="flex items-center gap-2">
              <IrisMark size={26} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-pine-soft">{userName}</span>
              <button
                onClick={signOut}
                aria-label="Sign out"
                title="Sign out"
                className="grid size-8 place-items-center rounded-full text-pine-soft transition-colors hover:bg-white hover:text-pine"
              >
                <LogOut className="size-4" />
              </button>
            </div>
          </div>
        }
      />
    </main>
  );
}
