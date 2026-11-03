"use client";

import { LifeBuoy, LogOut, MessageSquareText, Navigation, OctagonX, Phone, ScanEye, Volume2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useReducer, useState } from "react";
import { toast } from "sonner";

import { IrisMark } from "@/components/iris/logo";
import { authClient } from "@/lib/auth-client";
import { runAuthAction } from "@/lib/auth-actions";
import { useRobotConnection } from "@/lib/robot/use-robot-connection";
import { conversationReducer, initialConversation } from "@/lib/robot/conversation";
import type { ConsoleView as View, ReplySource } from "@/lib/robot/conversation";

import { RobotFeed } from "./robot-feed";
import { ConnectionBar } from "./connection-bar";
import { type PanelCard, SidePanel } from "./side-panel";

const QUICK_PHRASES = ["Please come here.", "I need some help.", "Could you repeat that?"];

export default function Console({ userName }: { userName: string }) {
  const router = useRouter();
  const connection = useRobotConnection();
  const [conversation, dispatch] = useReducer(conversationReducer, initialConversation);
  const { view } = conversation;
  const [signingOut, setSigningOut] = useState(false);
  const setView = (next: View) => dispatch({ type: "navigate", view: next });
  const confirm = (text: string, from: View, source: ReplySource = "phrase") => setView({ name: "confirm", text, source, from });

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
    if (conversation.error) { toast.error(conversation.error); dispatch({ type: "clear_error" }); }
  }, [conversation.error]);
  useEffect(() => {
    if (view.name !== "speaking") return;
    const timer = setTimeout(() => dispatch({ type: "timeout", speakId: view.speakId }), 95_000);
    return () => clearTimeout(timer);
  }, [view]);

  function speak(text: string, source: ReplySource) {
    if (!connection.phone || connection.status !== "connected") { toast.error("Connect the robot phone before speaking."); return; }
    const speakId = `s_${crypto.randomUUID()}`;
    try {
      connection.hub!.send({ type: "speak", speak_id: speakId, text, source, ts: Date.now() });
      setView({ name: "speaking", text, speakId });
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Could not send speech"); }
  }

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    connection.disconnect();
    await runAuthAction(() => authClient.signOut(), {
      onSuccess: () => { router.push("/login"); router.refresh(); },
      onError: (message) => toast.error(message),
      onSettled: () => setSigningOut(false),
    });
  }

  const home: View = { name: "home" };
  let heading = "What would you like to do?";
  let back: { label: string; onSelect: () => void } | undefined;
  let cards: PanelCard[] = [];

  switch (view.name) {
    case "home":
      cards = [
        {
          kind: "action",
          key: "drive",
          title: "Driving unavailable",
          hint: "MQTT control session required",
          icon: Navigation,
          tone: "plain",
          onSelect: () => toast("The MQTT controller/session publisher is not connected. Motor control stays off."),
        },
        { kind: "action", key: "phrases", title: "Say something", hint: "Phrases you use often", icon: MessageSquareText, tone: "honey", onSelect: () => setView({ name: "phrases" }) },
        { kind: "action", key: "help", title: "Help", hint: "Caregiver, eyes, stop", icon: LifeBuoy, tone: "sky", onSelect: () => setView({ name: "help" }) },
      ];
      break;
    case "phrases":
      heading = "Say something";
      back = { label: "Back", onSelect: () => setView(home) };
      cards = QUICK_PHRASES.map((p, i) => ({
        kind: "action",
        key: p,
        title: p,
        tone: (["teal", "honey", "sky"] as const)[i]!,
        onSelect: () => confirm(p, view),
      }));
      break;
    case "help":
      heading = "Help";
      back = { label: "Back", onSelect: () => setView(home) };
      cards = [
        {
          kind: "action",
          key: "caregiver",
          title: "Ask for help",
          icon: Phone,
          tone: "honey",
          onSelect: () => {
            confirm("Please come here. I need assistance.", view, "system");
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
            toast("Use STOP on the mounted phone. This console has no authorized MQTT drive connection yet.");
          },
        },
      ];
      break;
    case "suggestions":
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
      back = { label: "Ignore", onSelect: () => setView(home) };
      cards = view.replies.map((r, i) => ({
        kind: "action",
        key: r,
        title: r,
        tone: (["teal", "honey", "sky"] as const)[i]!,
        onSelect: () => confirm(r, view, "suggestion"),
      }));
      break;
    case "confirm":
      heading = "Say this out loud?";
      cards = [
        { kind: "preview", key: "preview", text: view.text },
        { kind: "action", key: "speak", title: "Speak it", icon: Volume2, tone: "honey", onSelect: () => speak(view.text, view.source) },
        { kind: "action", key: "cancel", title: "Cancel", icon: X, tone: "plain", onSelect: () => setView(view.from) },
      ];
      break;
    case "speaking":
      heading = "IRIS is speaking";
      cards = [{ kind: "preview", key: "speaking", text: view.text, speaking: true }];
      break;
  }

  const heard = view.name === "suggestions" ? view.heard : conversation.heard;

  return (
    <main className="flex h-svh flex-col gap-3 overflow-y-auto bg-mist p-3">
      <ConnectionBar connection={connection} />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-[minmax(0,4fr)_minmax(14rem,1fr)]">
      {/* left: camera fills the whole height */}
      <div className="min-h-[55vh] md:min-h-0">
        <RobotFeed
          stream={connection.media.remote}
          localCamera={connection.camera}
          fallbackFrameUrl={connection.media.fallbackFrameUrl}
          mediaState={connection.media.state}
          driveEnabled={false}
          moving={null}
          heard={heard}
          listening={conversation.activeSpeech}
          onMove={() => {}}
          onPreviewWebcam={() => void connection.openCamera()}
        />
      </div>

      {/* right: three cards */}
      <SidePanel
        heading={heading}
        back={back}
        cards={cards}
        footer={
          <div className="flex items-center gap-2 px-1 pt-1">
            <IrisMark size={26} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-pine-soft">{userName}</span>
            <button
              onClick={signOut}
              disabled={signingOut}
              aria-label="Sign out"
              title="Sign out"
              className="grid size-8 place-items-center rounded-full text-pine-soft transition-colors hover:bg-white hover:text-pine"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        }
      />
      </div>
    </main>
  );
}
