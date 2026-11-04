"use client";

import { Ear, Lightbulb, LightbulbOff, Loader2, LogOut, MessageSquareText, Navigation, Settings2, Square, TriangleAlert, Volume2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { toast } from "sonner";

import { IrisMark } from "@/components/iris/logo";
import { runAuthAction } from "@/lib/auth-actions";
import { authClient } from "@/lib/auth-client";
import { APPLIANCE_PINS, type AppliancePin, useAppliances } from "@/lib/mqtt/appliances";
import { broker, useBrokerStatus } from "@/lib/mqtt/broker";
import { DRIVE_INTERVAL_MS, DRIVE_TOPIC, DrivePublisher, type DriveAction, type DriveSource, type Direction } from "@/lib/mqtt/robot";
import { conversationReducer, initialConversation } from "@/lib/robot/conversation";
import type { ConsoleView as View, ReplySource } from "@/lib/robot/conversation";
import { useRobotConnection } from "@/lib/robot/use-robot-connection";
import { TalkApiError, talkApi } from "@/lib/talk/api";
import { UtteranceRecorder } from "@/lib/talk/recorder";
import { speakAloud, stopSpeaking } from "@/lib/talk/speak";

import { useDwell } from "./use-dwell";
import { ConnectionBar } from "./connection-bar";
import { ControlSettingsDialog } from "./control-settings";
import { readSavedMic } from "./mic-picker";
import { RobotFeed } from "./robot-feed";
import { ScreenGazeControls, type PatientMode } from "./screen-gaze-controls";
import { type PanelCard, SidePanel } from "./side-panel";

const QUICK_PHRASES = ["Please come here.", "I need some help.", "Could you repeat that?"];
const TONES = ["teal", "honey", "sky"] as const;

export default function Console({ userName, appliancePassword }: { userName: string; appliancePassword: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<PatientMode>("manual");
  const connection = useRobotConnection();
  const [conversation, dispatch] = useReducer(conversationReducer, initialConversation);
  const { view } = conversation;
  const [signingOut, setSigningOut] = useState(false);

  // Connected phone mic → shared Talk pipeline; selected laptop mic when no phone is connected.
  const [micId, setMicId] = useState("");
  const [micLevel, setMicLevel] = useState(0);
  const [micListVersion, setMicListVersion] = useState(0);
  const recorder = useRef<UtteranceRecorder | null>(null);
  const request = useRef<AbortController | null>(null);
  const phoneCapture = useRef<{ id: string; hub: NonNullable<typeof connection.hub>; timer: ReturnType<typeof setTimeout> } | null>(null);
  const ignoredCaptures = useRef(new Set<string>());
  /** Current conversation (= one AutoSage chat). Cleared when the patient leaves conversation mode. */
  const conversationId = useRef<string | null>(null);
  /** After the phone confirms it spoke a talk reply, listen again for the answer. */
  const resumeListening = useRef(false);

  const setView = useCallback((next: View) => dispatch({ type: "navigate", view: next }), []);
  const confirm = (text: string, from: View, source: ReplySource = "phrase") => setView({ name: "confirm", text, source, from });
  /** Set when the server started a new conversation (long silence / someone new greeting). */
  const [newSpeaker, setNewSpeaker] = useState<"silence" | "greeting" | null>(null);
  const announceSwitch = useCallback((reason: unknown) => {
    const r = reason === "silence" || reason === "greeting" ? reason : null;
    setNewSpeaker(r);
    if (r) toast(r === "greeting" ? "New conversation: sounds like someone new" : "New conversation after a long pause");
  }, []);

  useEffect(() => setMicId(readSavedMic()), []);

  // ───────────────────── MQTT: phone intentions and appliance commands (docs/controls.md) ─────────────────────

  useEffect(() => broker.acquire(), []); // one shared connection for both features
  const brokerState = useBrokerStatus();
  const appliances = useAppliances();
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Surface connection problems once per distinct message.
  const lastBrokerError = useRef<string | null>(null);
  useEffect(() => {
    const message = brokerState.status === "connected" ? null : brokerState.error;
    if (message && message !== lastBrokerError.current) toast.error(message);
    lastBrokerError.current = message;
  }, [brokerState.status, brokerState.error]);

  const hasFeed = Boolean((connection.media.state === "live" && connection.media.remote) ||
    (connection.media.state === "fallback" && connection.media.fallbackFrameUrl));
  const connected = connection.status === "connected" && connection.phone;
  const available = useRef(false);
  const frameAt = useRef(-Infinity);
  const [driver] = useState(() => new DrivePublisher(
    intent => broker.publish(DRIVE_TOPIC, intent),
    () => available.current && performance.now() - frameAt.current < 1500 &&
      broker.getSnapshot().status === "connected" && document.visibilityState === "visible" && document.hasFocus(),
  ));
  const [driveStatus, setDriveStatus] = useState<"ready" | "retry-stop" | "waiting">("waiting");
  const ready = driveStatus === "ready";
  const [active, setActive] = useState<Direction | null>(null);
  const frame = useCallback(() => { frameAt.current = performance.now(); }, []);
  const lostFeed = useCallback(() => { frameAt.current = -Infinity; void driver.stop(); }, [driver]);
  const start = useCallback((action: Direction, source: DriveSource) => { void driver.start(action, source); }, [driver]);
  const release = useCallback((action: DriveAction, source?: DriveSource) => { void driver.release(action, source); }, [driver]);
  const stop = useCallback((explicit = false) => { void driver.stop(explicit); }, [driver]);

  useLayoutEffect(() => {
    available.current = mode !== "setup" && view.name === "drive" && connected && hasFeed && !settingsOpen && !signingOut;
    if (!available.current) void driver.stop();
    if (!connected) driver.revoke();
    if (!hasFeed) frameAt.current = -Infinity;
  }, [driver, mode, view.name, connected, hasFeed, settingsOpen, signingOut]);

  useEffect(() => {
    const hub = connection.hub;
    if (!hub) return;
    const listeners = [
      hub.on("drive_grant", m => driver.grant(m)),
      hub.on("session_revoked", m => { if (m.device_id === "esp12e_carbot") driver.revoke(m.control_session_id); }),
      hub.on("peer_status", m => { if (m.phone === false) driver.revoke(); }),
      hub.on("stop", () => stop()),
      broker.subscribe(DRIVE_TOPIC, (raw, retained) => driver.mobileStatus(raw, retained)),
      broker.subscribeStore(() => { if (broker.getSnapshot().status !== "connected") driver.revoke(); }),
    ];
    return () => { listeners.forEach(unsubscribe => unsubscribe()); driver.revoke(); };
  }, [connection.hub, driver, stop]);

  useEffect(() => {
    const tick = () => {
      void driver.tick();
      setActive(driver.active);
      setDriveStatus(driver.ready ? "ready" : driver.stopNeedsRetry ? "retry-stop" : "waiting");
    };
    const timer = setInterval(tick, DRIVE_INTERVAL_MS);
    const leave = () => stop();
    const visibility = () => { if (document.hidden) leave(); };
    window.addEventListener("blur", leave);
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clearInterval(timer);
      window.removeEventListener("blur", leave);
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", visibility);
      leave();
    };
  }, [driver, stop]);

  const toggleAppliance = useCallback(
    async (pin: AppliancePin) => {
      if (appliances.pending[pin]) return; // already on its way
      try {
        await appliances.toggle(pin, appliancePassword);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Couldn’t switch the appliance.");
      }
    },
    [appliances, appliancePassword],
  );

  // ── events from the robot phone over the hub (docs/interfaces.md §3)
  useEffect(() => {
    if (!connection.hub) return;
    const unsubscribes = ["speech_activity", "transcript", "suggestions", "tts_status"].map((type) =>
      connection.hub!.on(type, (message) => dispatch({ type: "event", message })),
    );
    unsubscribes.push(connection.hub.on("error", (message) => toast.error(typeof message.message === "string" ? message.message : "The hub reported an error.")));
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [connection.hub]);
  useEffect(() => {
    if (!connection.phone || connection.status !== "connected") dispatch({ type: "disconnected" });
  }, [connection.phone, connection.status]);
  useEffect(() => {
    if (conversation.error) {
      toast.error(conversation.error);
      dispatch({ type: "clear_error" });
    }
  }, [conversation.error]);
  useEffect(() => {
    if (view.name !== "speaking") return;
    const timer = setTimeout(() => dispatch({ type: "timeout", speakId: view.speakId }), 95_000);
    return () => clearTimeout(timer);
  }, [view]);

  // ───────────────────────────── Say something ─────────────────────────────

  const abortWork = useCallback(() => {
    const capture = phoneCapture.current;
    if (capture) {
      phoneCapture.current = null; clearTimeout(capture.timer);
      ignoredCaptures.current.add(capture.id);
      if (ignoredCaptures.current.size > 100) ignoredCaptures.current.delete(ignoredCaptures.current.values().next().value!);
      try { capture.hub.send({ type: "listen", action: "cancel", request_id: capture.id, ts: Date.now() }); } catch {}
    }
    recorder.current?.cancel();
    recorder.current = null;
    request.current?.abort();
    request.current = null;
    setMicLevel(0);
  }, []);

  useEffect(() => {
    if (!connection.hub) return;
    const finishCapture = () => {
      if (phoneCapture.current) clearTimeout(phoneCapture.current.timer);
      phoneCapture.current = null;
    };
    const offResult = connection.hub.on("talk_result", (message) => {
      if (typeof message.request_id !== "string" || ignoredCaptures.current.has(message.request_id)) return;
      if (phoneCapture.current && phoneCapture.current.id !== message.request_id) return;
      finishCapture();
      const result = message.result as import("@/lib/talk/api").UtteranceResult;
      // No words caught: the server doesn't open a conversation for that, so there may be no id.
      if (message.ok && result?.status === "no_speech") { setView({ name: "no-speech" }); return; }
      if (!message.ok || !result || typeof result.conversationId !== "string") {
        const failure = message.result as { message?: string; error?: string };
        toast.error(failure?.message ?? failure?.error ?? "Speech processing failed. Try again.");
        setView({ name: "home" }); return;
      }
      conversationId.current = result.conversationId;
      if (result.status === "no_speech") { setView({ name: "no-speech" }); return; }
      announceSwitch(result.newConversation);
      dispatch({ type: "event", message: { type: "suggestions", utterance_id: result.conversationId,
        heard: result.heard, suggestions: result.replies, low_confidence: result.lowConfidence,
        requires_user_confirmation: true, ts: Date.now() } });
    });
    const offState = connection.hub.on("speech_state", (message) => {
      if (typeof message.request_id !== "string" || ignoredCaptures.current.has(message.request_id)) return;
      if (phoneCapture.current && phoneCapture.current.id !== message.request_id) return;
      if (message.state === "processing") setView({ name: "thinking" });
      else if (message.state === "no_speech" || message.state === "failed") {
        finishCapture(); setView({ name: "no-speech" });
        if (message.state === "failed") toast.error("Phone speech processing failed. Check the phone and server.");
      }
    });
    return () => { offResult(); offState(); };
  }, [announceSwitch, connection.hub, setView]);
  useEffect(() => {
    if (!connection.phone && phoneCapture.current) { abortWork(); setView({ name: "no-speech" }); }
  }, [connection.phone, abortWork, setView]);

  /** Leaving conversation mode ends the conversation; the next "Say something" opens a new chat. */
  const endConversation = useCallback(() => {
    const id = conversationId.current;
    conversationId.current = null;
    resumeListening.current = false;
    setNewSpeaker(null);
    if (id) void talkApi.endConversation(id).catch(() => {});
  }, []);

  const showError = useCallback(
    (error: unknown) => {
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
    },
    [setView],
  );

  /** Listen for one thing someone says, then get reply suggestions for it. */
  const startListening = useCallback(async () => {
    abortWork();
    stopSpeaking();
    setView({ name: "listening", speaking: false });

    if (connection.phone && connection.hub && connection.status === "connected") {
      const id = `u_${crypto.randomUUID()}`;
      const timer = setTimeout(() => {
        abortWork(); toast.error("The phone did not finish processing speech. Try again."); setView({ name: "no-speech" });
      }, 100_000);
      phoneCapture.current = { id, hub: connection.hub, timer };
      try { connection.hub.send({ type: "listen", action: "start", request_id: id, conversationId: conversationId.current, ts: Date.now() }); }
      catch (error) { abortWork(); showError(error); }
      return;
    }

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
      conversationId.current = result.conversationId ?? conversationId.current;

      if (result.status === "no_speech") return setView({ name: "no-speech" });
      announceSwitch(result.newConversation);
      console.info(`[talk] heard in ${result.timings.sttMs} ms, replies (${result.source}) in ${result.timings.repliesMs} ms`, result.models);
      setView({
        name: "suggestions",
        utteranceId: result.conversationId,
        heard: result.heard,
        replies: result.replies,
        lowConfidence: result.lowConfidence,
      });
    } catch (error) {
      showError(error);
    }
  }, [abortWork, announceSwitch, micId, setView, showError, connection.phone, connection.hub, connection.status]);

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
        setView({ name: "suggestions", utteranceId: result.conversationId, heard: result.heard, replies: result.replies, lowConfidence: result.lowConfidence });
      } catch (error) {
        showError(error);
      }
    },
    [abortWork, setView, showError],
  );

  /**
   * Speak a confirmed reply: through the robot phone when it's connected (it reports tts_status),
   * otherwise on this laptop. Talk replies join the conversation's AutoSage chat, and IRIS listens again.
   */
  async function speak(text: string, source: ReplySource) {
    const fromTalk = source === "suggestion" && conversationId.current !== null;
    if (fromTalk) void talkApi.spoken(conversationId.current!, text).catch(() => {});
    const speakId = `s_${crypto.randomUUID()}`;

    if (connection.hub && connection.phone && connection.status === "connected") {
      try {
        connection.hub.send({ type: "speak", speak_id: speakId, text, source, ts: Date.now() });
        resumeListening.current = fromTalk;
        setView({ name: "speaking", text, speakId });
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : "Could not send speech");
      }
      return;
    }

    setView({ name: "speaking", text, speakId });
    await speakAloud(text);
    if (fromTalk) void startListening();
    else setView({ name: "home" });
  }

  // When the phone confirms it finished a talk reply, keep the conversation going.
  const previousView = useRef(view.name);
  useEffect(() => {
    const wasSpeaking = previousView.current === "speaking";
    previousView.current = view.name;
    if (wasSpeaking && view.name === "home" && resumeListening.current) {
      resumeListening.current = false;
      void startListening();
    }
  }, [view.name, startListening]);

  useEffect(() => () => abortWork(), [abortWork]);
  useEffect(() => () => stopSpeaking(), []);
  useEffect(() => () => endConversation(), [endConversation]);

  const goHome = () => {
    abortWork();
    stopSpeaking();
    endConversation();
    setView({ name: "home" });
  };

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    abortWork();
    endConversation();
    connection.disconnect();
    await runAuthAction(() => authClient.signOut(), {
      onSuccess: () => {
        router.push("/login");
        router.refresh();
      },
      onError: (message) => toast.error(message),
      onSettled: () => setSigningOut(false),
    });
  }

  const changeMode = useCallback((next: PatientMode) => {
    // Leaving the control surface cancels recording, speech, and drive holds.
    if (next !== "live") {
      stop();
      abortWork();
      stopSpeaking();
      endConversation();
    }
    setMode(next);
  }, [stop, abortWork, endConversation]);

  const settingsButton = useDwell(() => setSettingsOpen(true));
  const signOutButton = useDwell(() => void signOut(), { ms: 1500, disabled: signingOut });

  // ───────────────────────────── panel content per view ─────────────────────────────

  const home: View = { name: "home" };
  let heading = "What would you like to do?";
  let back: { label: string; onSelect: () => void } | undefined;
  let extra: { label: string; onSelect: () => void; icon?: "refresh" | "settings" } | undefined;
  let cards: PanelCard[] = [];
  let feedStatus: string | null = null;

  switch (view.name) {
    case "home":
      cards = [
        {
          kind: "action",
          key: "drive",
          title: "Drive",
          hint: hasFeed ? "Open directional controls" : "Connect the phone to drive",
          icon: Navigation,
          tone: "teal",
          onSelect: () => setView({ name: "drive" }),
        },
        {
          kind: "action",
          key: "talk",
          title: "Communicate",
          hint: "Choose a phrase or listen and reply",
          icon: MessageSquareText,
          tone: "honey",
          onSelect: () => setView({ name: "communicate" }),
        },
        {
          kind: "action",
          key: "appliances",
          title: "Appliances",
          hint: "Switch things on and off",
          icon: Lightbulb,
          tone: "sky",
          onSelect: () => setView({ name: "appliances" }),
        },
      ];
      break;

    case "drive":
      heading = "Drive the car";
      back = { label: "Actions", onSelect: goHome };
      cards = [
        { kind: "preview", key: "drive-help",
          text: !hasFeed ? "Connect the robot phone" : ready || active ? "Look at a direction on the video" : "Waiting for drive access",
          hint: !hasFeed ? "Use Connect phone in the video panel to open the robot camera." :
            driveStatus === "retry-stop" ? "Select Stop again to confirm." :
            ready || active ? "Hold for 0.9 seconds. Look away to stop." : "On the mounted phone, calibrate, authorize the session and enable driving." },
        { kind: "action", key: "stop", title: "Stop driving", icon: Square, tone: "honey", onSelect: () => stop(true), disabled: !connected },
        { kind: "action", key: "actions", title: "Back to actions", tone: "plain", onSelect: goHome },
      ];
      break;

    case "communicate":
      heading = "Communicate";
      back = { label: "Actions", onSelect: goHome };
      cards = [
        { kind: "action", key: "phrases", title: "Quick phrases", hint: "Choose words to speak", icon: MessageSquareText, tone: "honey", onSelect: () => setView({ name: "phrases" }) },
        { kind: "action", key: "listen", title: "Listen and reply", hint: "Listen to someone and choose a reply", icon: Ear, tone: "teal", onSelect: () => void startListening() },
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
        { kind: "action", key: "done", title: "They’re done", icon: Square, tone: "honey", onSelect: () => {
          const capture = phoneCapture.current;
          if (capture) capture.hub.send({ type: "listen", action: "stop", request_id: capture.id, ts: Date.now() });
          else recorder.current?.stop();
        } },
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

    case "phrases":
      heading = "Quick phrases";
      back = { label: "Back", onSelect: () => setView(home) };
      cards = QUICK_PHRASES.map((p, i) => ({
        kind: "action",
        key: p,
        title: p,
        tone: TONES[i]!,
        onSelect: () => confirm(p, view),
      }));
      break;

    case "appliances":
      // Three appliances, three cards, like every other screen.
      heading = "Appliances";
      back = { label: "Back", onSelect: () => setView(home) };
      cards = APPLIANCE_PINS.map((pin, i) => {
        const state = appliances.states[pin];
        const pending = appliances.pending[pin];
        const noReply = appliances.unconfirmed[pin];
        return {
          kind: "action",
          key: pin,
          title: `Appliance ${i + 1}`,
          disabled: state === undefined || !!pending,
          hint: pending
            ? `Turning ${pending}…`
            : noReply
              ? "No reply from appliance board"
              : state === "on"
                ? "On · look here to turn off"
                : state === "off"
                  ? "Off · look here to turn on"
                  : "Waiting for appliance board",
          icon: pending ? Loader2 : noReply ? TriangleAlert : state === "on" ? Lightbulb : LightbulbOff,
          tone: state === "on" ? "teal" : "plain",
          onSelect: () => void toggleAppliance(pin),
        } satisfies PanelCard;
      });
      break;

    case "suggestions": {
      const fromTalk = conversationId.current !== null && view.utteranceId === conversationId.current;
      if (view.lowConfidence) {
        heading = "Could you repeat that?";
        cards = [
          { kind: "action", key: "repeat", title: "Ask them to repeat", tone: "honey", onSelect: () => confirm("Sorry, could you repeat that?", view, "system") },
          { kind: "action", key: "ignore", title: "Ignore", tone: "plain", onSelect: () => setView(home) },
          { kind: "action", key: "phrases", title: "Use a quick phrase", tone: "sky", onSelect: () => setView({ name: "phrases" }) },
        ];
        break;
      }
      heading = view.lowConfidence ? "Not sure I heard right" : "Pick a reply";
      back = { label: "Ignore", onSelect: goHome };
      if (fromTalk) extra = { label: "New replies", onSelect: () => void moreReplies(view.heard) };
      cards = view.replies.map((r, i) => ({
        kind: "action",
        key: r,
        title: r,
        tone: TONES[i % TONES.length]!,
        onSelect: () => confirm(r, view, "suggestion"),
      }));
      break;
    }

    case "confirm":
      heading = "Say this out loud?";
      cards = [
        { kind: "preview", key: "preview", text: `“${view.text}”` },
        { kind: "action", key: "speak", title: "Speak it", icon: Volume2, tone: "honey", onSelect: () => void speak(view.text, view.source) },
        { kind: "action", key: "cancel", title: "Cancel", icon: X, tone: "plain", onSelect: () => setView(view.from) },
      ];
      break;

    case "speaking":
      heading = "IRIS is speaking";
      cards = [{ kind: "preview", key: "speaking", text: `“${view.text}”`, speaking: true }];
      break;
  }

  const heard =
    view.name === "suggestions"
      ? view.heard
      : view.name === "thinking"
        ? (view.heard ?? null)
        : view.name === "listening" || view.name === "no-speech"
          ? null
          : conversation.heard;

  return (
    <main aria-label="Patient dashboard" className="patient-console flex h-dvh flex-col gap-3 bg-mist p-3 text-pine md:gap-4 md:p-4">
      <header aria-label="Patient bar" className="patient-bar flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 px-1">
        <div className="mr-auto flex min-w-0 items-center gap-2">
          <IrisMark size={38} />
          <h1 className="truncate font-display text-2xl font-bold" title={userName}>{userName}</h1>
        </div>
        <ScreenGazeControls mode={mode} setMode={changeMode} />
        <button type="button" ref={settingsButton.ref} {...settingsButton.props} aria-haspopup="dialog"
          className="patient-tool"><span className="dwell-fill" /><Settings2 aria-hidden className="relative size-5" /><span className="relative">Settings</span></button>
        <button type="button" ref={signOutButton.ref} {...signOutButton.props} disabled={signingOut}
          className="patient-tool"><span className="dwell-fill" /><LogOut aria-hidden className="relative size-5" /><span className="relative">Sign out</span></button>
      </header>
      <section aria-label={mode === "live" ? "Gaze control overlay" : "Patient controls"} className="patient-stage">
          <RobotFeed
            stream={connection.media.remote}
            localCamera={connection.camera}
            fallbackFrameUrl={connection.media.fallbackFrameUrl}
            mediaState={connection.media.state}
            drive={view.name === "drive" ? { enabled: ready || active !== null, active, start, release, stop, frame, lostFeed } : undefined}
            heard={heard}
            heardLabel={
              view.name === "suggestions" && view.lowConfidence
                ? "I think they said"
                : newSpeaker === "greeting"
                  ? "Someone new said"
                  : "Someone nearby said"
            }
            status={feedStatus}
            listening={conversation.activeSpeech || (view.name === "listening" && view.speaking)}
            menu={<ConnectionBar connection={connection} />}
          />

        <SidePanel
          heading={heading}
          back={back}
          extra={extra}
          cards={cards}
          home={view.name === "home"}
        />
      </section>
      <ControlSettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)}
        micId={micId} onMicChange={setMicId} micListVersion={micListVersion} connection={connection} />
    </main>
  );
}
