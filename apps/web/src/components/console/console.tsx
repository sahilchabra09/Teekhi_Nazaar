"use client";

import { ArrowLeft, Ear, Lightbulb, LightbulbOff, Loader2, LogOut, MessageSquareText, Navigation, Settings2, Square, TriangleAlert, Volume2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { toast } from "sonner";

import { IrisMark } from "@/components/iris/logo";
import { runAuthAction } from "@/lib/auth-actions";
import { authClient } from "@/lib/auth-client";
import { APPLIANCE_PINS, type AppliancePin, useAppliances } from "@/lib/mqtt/appliances";
import { broker, useBrokerStatus } from "@/lib/mqtt/broker";
import { DRIVE_INTERVAL_MS, DRIVE_TOPIC, DrivePublisher, type DriveAction, type DriveSource, type StopState, type Direction } from "@/lib/mqtt/robot";
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
import { ActionCard, type PanelAction, type PanelCard, SidePanel } from "./side-panel";

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
  const [micListVersion, setMicListVersion] = useState(0);
  const recorder = useRef<UtteranceRecorder | null>(null);
  const request = useRef<AbortController | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const phoneCapture = useRef<{ id: string; approved: boolean; expires: number; hub: NonNullable<typeof connection.hub>; timer: ReturnType<typeof setTimeout> } | null>(null);
  /** Current conversation (= one AutoSage chat). Cleared when the patient leaves conversation mode. */
  const conversationId = useRef<string | null>(null);
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
  const [ready, setReady] = useState(false);
  const [stopState, setStopState] = useState<StopState>("unavailable");
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
      setReady(driver.ready);
      setStopState(driver.stopState);
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
    const offTts = connection.hub.on("tts_status", message => dispatch({ type: "event", message }));
    const offError = connection.hub.on("error", message => toast.error(typeof message.message === "string" ? message.message : "The hub reported an error."));
    return () => { offTts(); offError(); };
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

  const clearPhoneTurn = useCallback((notifyPhone: boolean) => {
    const capture = phoneCapture.current;
    if (!capture) return;
    phoneCapture.current = null;
    clearTimeout(capture.timer);
    setPendingId(null);
    if (notifyPhone) {
      try { capture.hub.send({ type: "listen", action: "cancel", request_id: capture.id, ts: Date.now() }); } catch { /* Peer disconnected. */ }
    }
  }, []);

  const abortWork = useCallback(() => {
    clearPhoneTurn(true);
    request.current?.abort();
    request.current = null;
    recorder.current?.cancel();
    recorder.current = null;
  }, [clearPhoneTurn]);

  useEffect(() => {
    const hub = connection.hub;
    if (!hub) return;
    const offListen = hub.on("listen", message => {
      const id = message.request_id;
      if (typeof id !== "string" || !id || id.length > 128) return;
      if (message.action === "cancel" && phoneCapture.current?.id === id) {
        const approved = phoneCapture.current.approved;
        clearPhoneTurn(false);
        if (approved) setView({ name: "listen" });
        return;
      }
      if (message.action !== "request" || phoneCapture.current) return;
      if (request.current) {
        hub.send({ type: "listen", action: "cancel", request_id: id, ts: Date.now() });
        return;
      }
      // Receiving a request can never navigate, open the mic, or interrupt Drive.
      const expires = Math.min(Date.now() + 60_000, typeof message.expires_at_ms === "number" ? message.expires_at_ms : Infinity);
      if (expires <= Date.now()) return;
      const timer = setTimeout(() => { if (phoneCapture.current?.id === id) clearPhoneTurn(true); }, expires - Date.now());
      phoneCapture.current = { id, hub, timer, expires, approved: false };
      setPendingId(id);
    });
    const offResult = hub.on("talk_result", message => {
      const capture = phoneCapture.current;
      if (!capture?.approved || capture.hub !== hub || capture.id !== message.request_id) return;
      clearPhoneTurn(false);
      const result = message.result as import("@/lib/talk/api").UtteranceResult | null;
      if (message.ok && result?.status === "no_speech") { setView({ name: "no-speech" }); return; }
      if (!message.ok || result?.status !== "ok" || typeof result.conversationId !== "string" ||
          typeof result.heard !== "string" || !Array.isArray(result.replies) || result.replies.length !== 3 ||
          !result.replies.every(r => typeof r === "string" && r.trim() && r.length <= 4000)) {
        toast.error("The phone could not complete this listening turn.");
        setView({ name: "listen" }); return;
      }
      conversationId.current = result.conversationId;
      announceSwitch(result.newConversation);
      setView({ name: "suggestions", utteranceId: result.conversationId, heard: result.heard, replies: result.replies, lowConfidence: result.lowConfidence });
    });
    const offState = hub.on("speech_state", message => {
      const capture = phoneCapture.current;
      if (!capture?.approved || capture.hub !== hub || capture.id !== message.request_id) return;
      if (message.state === "processing") setView({ name: "thinking" });
      else if (message.state === "listening") setView({ name: "listening", speaking: true });
      else if (message.state === "no_speech" || message.state === "failed") {
        clearPhoneTurn(false); setView({ name: "no-speech" });
        if (message.state === "failed") toast.error("Phone speech processing failed. Request another turn.");
      }
    });
    return () => { offListen(); offResult(); offState(); };
  }, [announceSwitch, connection.hub, clearPhoneTurn, setView]);
  useEffect(() => {
    const capture = phoneCapture.current;
    if (capture && (!connected || capture.hub !== connection.hub)) {
      clearPhoneTurn(false);
      if (capture.approved) setView({ name: "listen" });
    }
  }, [connected, connection.hub, clearPhoneTurn, setView]);

  useEffect(() => {
    const leave = () => {
      if (!phoneCapture.current?.approved && !request.current) return;
      abortWork();
      setView({ name: "listen" });
    };
    const visibility = () => { if (document.hidden) leave(); };
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [abortWork, setView]);

  const approveListening = () => {
    const capture = phoneCapture.current;
    if (view.name !== "listen" || !connected || document.hidden || mode === "setup" || settingsOpen || !capture ||
        capture.hub !== connection.hub || capture.approved || capture.id !== pendingId || Date.now() >= capture.expires) return;
    clearTimeout(capture.timer);
    capture.approved = true;
    setPendingId(null);
    capture.timer = setTimeout(() => {
      if (phoneCapture.current !== capture) return;
      clearPhoneTurn(true);
      setView({ name: "listen" });
    }, 100_000);
    try {
      capture.hub.send({ type: "listen", action: "start", request_id: capture.id, conversationId: conversationId.current, ts: Date.now() });
      setView({ name: "listening", speaking: false });
    } catch { clearPhoneTurn(false); toast.error("The phone disconnected before approval reached it."); }
  };

  /** Leaving conversation mode ends the conversation; the next "Say something" opens a new chat. */
  const endConversation = useCallback(() => {
    const id = conversationId.current;
    conversationId.current = null;
    setNewSpeaker(null);
    if (id) void talkApi.endConversation(id).catch(() => {});
  }, []);

  const showError = useCallback(
    (error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return; // user cancelled
      if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) {
        toast.error("Microphone access is blocked. Allow it in the browser’s address bar.");
      } else if (error instanceof DOMException && (error.name === "NotFoundError" || error.name === "OverconstrainedError")) {
        toast.error("That microphone isn’t available. Choose another in Settings.");
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

  /** Explicit local capture is available on the listening page when no phone is paired online. */
  const startLocalListening = async () => {
    if (view.name !== "listen" || connected || request.current || phoneCapture.current || settingsOpen || mode === "setup") return;
    const controller = new AbortController();
    request.current = controller;
    setView({ name: "listening", speaking: false });
    let rec: UtteranceRecorder;
    try {
      rec = await UtteranceRecorder.start({
        deviceId: micId || undefined, signal: controller.signal,
        onSpeechStart: () => setView({ name: "listening", speaking: true }),
      });
    } catch (error) {
      if (!controller.signal.aborted) { request.current = null; showError(error); }
      return;
    }
    if (controller.signal.aborted) { rec.cancel(); return; }
    recorder.current = rec;
    setMicListVersion((v) => v + 1); // permission granted → device labels are available now

    try {
      const recording = await rec.done;
      if (controller.signal.aborted) return;
      recorder.current = null;
      if (!recording.hadSpeech) return setView({ name: "no-speech" });

      setView({ name: "thinking" });
      const result = await talkApi.utterance(recording.wav, conversationId.current, controller.signal);
      if (controller.signal.aborted) return;
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
      if (!controller.signal.aborted) showError(error);
    } finally { if (request.current === controller) request.current = null; }
  };

  const moreReplies = useCallback(
    async (heard: string) => {
      if (!conversationId.current) return;
      abortWork();
      setView({ name: "thinking", heard });
      const controller = new AbortController();
      request.current = controller;
      try {
        const result = await talkApi.moreReplies(conversationId.current, controller.signal);
        if (controller.signal.aborted) return;
        setView({ name: "suggestions", utteranceId: result.conversationId, heard: result.heard, replies: result.replies, lowConfidence: result.lowConfidence });
      } catch (error) {
        if (!controller.signal.aborted) showError(error);
      } finally { if (request.current === controller) request.current = null; }
    },
    [abortWork, setView, showError],
  );

  /**
   * Speak a confirmed reply: through the robot phone when it's connected (it reports tts_status),
   * otherwise on this laptop. A new listening turn needs another approval.
   */
  async function speak(text: string, source: ReplySource) {
    const fromTalk = source === "suggestion" && conversationId.current !== null;
    if (fromTalk) void talkApi.spoken(conversationId.current!, text).catch(() => {});
    const after = fromTalk ? "listen" : "home";
    const speakId = `s_${crypto.randomUUID()}`;

    if (connection.hub && connection.phone && connection.status === "connected") {
      try {
        connection.hub.send({ type: "speak", speak_id: speakId, text, source, ts: Date.now() });
        setView({ name: "speaking", text, speakId, after });
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : "Could not send speech");
      }
      return;
    }

    setView({ name: "speaking", text, speakId, after });
    await speakAloud(text);
    dispatch({ type: "event", message: { type: "tts_status", speak_id: speakId, state: "finished" } });
  }

  useEffect(() => () => abortWork(), [abortWork]);
  useEffect(() => () => stopSpeaking(), []);
  useEffect(() => () => endConversation(), [endConversation]);

  const leaveConversation = (name: "home" | "drive") => {
    abortWork();
    stopSpeaking();
    endConversation();
    setView({ name });
  };
  const goHome = () => leaveConversation("home");

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
      if (view.name === "listening" || view.name === "thinking") setView({ name: "listen" });
    }
    setMode(next);
  }, [stop, abortWork, endConversation, setView, view.name]);

  const settingsButton = useDwell(() => {
    if (view.name === "listening" || view.name === "thinking") {
      abortWork();
      setView({ name: "listen" });
    }
    setSettingsOpen(true);
  });
  const signOutButton = useDwell(() => void signOut(), { ms: 1500, disabled: signingOut });

  // ───────────────────────────── panel content per view ─────────────────────────────

  const home: View = { name: "home" };
  let heading = "What would you like to do?";
  let options: PanelAction[] = [];
  const inCommunication = view.name === "communicate" || view.name === "phrases";
  const phrasesOpen = view.name === "phrases";
  const communicateCard: PanelAction = {
    kind: "action", key: "talk", title: "Communicate", icon: MessageSquareText, tone: "honey",
    pressed: inCommunication,
    hint: inCommunication ? "Select again for main actions" : "Choose a phrase or listen and reply",
    onSelect: inCommunication ? goHome : () => setView({ name: "communicate" }),
  };
  const driveCard: PanelAction = {
    kind: "action", key: "drive", title: "Drive", icon: Navigation, tone: "teal",
    pressed: view.name === "drive",
    hint: view.name === "drive" ? "Select again for main actions" : hasFeed ? "Open directional controls" : "Connect the phone to drive",
    onSelect: () => leaveConversation(view.name === "drive" ? "home" : "drive"),
  };
  let cards: PanelCard[] = [];
  let feedStatus: string | null = null;

  switch (view.name) {
    case "home":
    case "drive":
      cards = [
        driveCard,
        communicateCard,
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

    case "communicate":
    case "phrases":
      heading = phrasesOpen ? "Quick phrases" : "Communicate";
      cards = [
        { kind: "action", key: "phrases", title: "Quick phrases", pressed: phrasesOpen,
          hint: phrasesOpen ? "Select again to close phrases" : "Choose words to speak", icon: MessageSquareText, tone: "sky",
          onSelect: () => setView({ name: phrasesOpen ? "communicate" : "phrases" }) },
        communicateCard,
        { kind: "action", key: "listen", title: "Listen and reply", hint: "Listen to someone and choose a reply", icon: Ear, tone: "teal", onSelect: () => setView({ name: "listen" }) },
      ];
      if (phrasesOpen) options = QUICK_PHRASES.map((text, i) => ({
        kind: "action", key: text, title: text, tone: TONES[i]!, onSelect: () => confirm(text, view),
      }));
      break;

    case "listen":
      heading = pendingId ? "The person at the robot is asking to speak" : "Listen and reply";
      cards = [driveCard];
      if (pendingId) {
        cards.push({ kind: "action", key: "allow", title: "Allow microphone", hint: "Listen to the robot phone for one turn", tone: "teal", onSelect: approveListening },
          { kind: "action", key: "decline", title: "Decline", tone: "plain", onSelect: () => clearPhoneTurn(true) });
      } else {
        cards.push(connected
          ? { kind: "preview", key: "waiting", text: "Waiting for a request", hint: "The person at the robot can request the microphone on the phone." }
          : { kind: "action", key: "local", title: "Use laptop microphone", hint: "Record one turn on this device", tone: "teal", onSelect: () => void startLocalListening() },
          { kind: "action", key: "close", title: "Close listening", tone: "plain", onSelect: goHome });
      }
      break;

    case "listening":
      heading = view.speaking ? "Hearing them…" : "Listening…";
      feedStatus = view.speaking ? "Hearing someone speak" : "Listening for someone to speak";
      cards = [
        driveCard,
        { kind: "action", key: "done", title: "They’re done", icon: Square, tone: "honey", onSelect: () => {
          const capture = phoneCapture.current;
          if (capture?.approved) {
            try { capture.hub.send({ type: "listen", action: "stop", request_id: capture.id, ts: Date.now() }); }
            catch { abortWork(); setView({ name: "listen" }); }
          }
          else recorder.current?.stop();
        } },
        { kind: "action", key: "cancel", title: "Cancel", icon: X, tone: "plain", onSelect: goHome },
      ];
      break;

    case "thinking":
      heading = "Finding replies…";
      feedStatus = view.heard ? null : "Understanding what they said";
      cards = [driveCard, { kind: "preview", key: "thinking", text: view.heard ? "Writing new replies…" : "Understanding what they said…", busy: true }];
      cards.push({ kind: "action", key: "cancel", title: "Cancel request", tone: "honey", onSelect: goHome });
      break;

    case "no-speech":
      heading = "Didn’t catch that";
      cards = [
        { kind: "action", key: "again", title: "Listen again", icon: Ear, tone: "teal", onSelect: () => setView({ name: "listen" }) },
        { kind: "action", key: "phrases", title: "Quick phrases", icon: MessageSquareText, tone: "honey", onSelect: () => setView({ name: "phrases" }) },
        { kind: "action", key: "home", title: "Finish conversation", tone: "honey", onSelect: goHome },
      ];
      break;

    case "appliances":
      heading = "Appliances";
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
      cards.push({ kind: "action", key: "back", title: "Back to actions", icon: ArrowLeft, tone: "honey", onSelect: () => setView(home) });
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
      heading = "Pick a reply";
      options = [{ kind: "action", key: "ignore", title: "Ignore", tone: "plain", onSelect: goHome }];
      if (fromTalk) options.push({ kind: "action", key: "more", title: "New replies", tone: "honey", onSelect: () => void moreReplies(view.heard) });
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

  if (["suggestions", "no-speech", "confirm", "speaking"].includes(view.name)) options.unshift(driveCard);

  const heard =
    view.name === "suggestions"
      ? view.heard
      : view.name === "thinking"
        ? (view.heard ?? null)
        : null;

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
        <div className="patient-media">
          <RobotFeed
            stream={connection.media.remote}
            localCamera={connection.camera}
            fallbackFrameUrl={connection.media.fallbackFrameUrl}
            mediaState={connection.media.state}
            drive={view.name === "drive" ? {
              enabled: ready || active !== null,
              stopState: connected && brokerState.status === "connected" ? stopState : "unavailable",
              active, start, release, stop, frame, lostFeed,
            } : undefined}
            heard={heard}
            heardLabel={
              view.name === "suggestions" && view.lowConfidence
                ? "I think they said"
                : newSpeaker === "greeting"
                  ? "Someone new said"
                  : "Someone nearby said"
            }
            status={feedStatus}
            listening={view.name === "listening" && view.speaking}
            menu={<ConnectionBar connection={connection} />}
          />

          {options.length > 0 && (
            <div role="group" aria-label={phrasesOpen ? "Phrase choices" : "Reply options"} className="patient-options">
              {options.map(card => <ActionCard key={card.key} card={card} />)}
            </div>
          )}
        </div>
        <SidePanel heading={heading} cards={cards}
          showHeading={view.name !== "home" && view.name !== "drive" && !inCommunication} />
      </section>
      <ControlSettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)}
        micId={micId} onMicChange={setMicId} micListVersion={micListVersion} connection={connection} />
    </main>
  );
}
