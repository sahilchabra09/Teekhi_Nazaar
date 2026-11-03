"use client";

import { LifeBuoy, LogOut, MessageSquareText, Navigation, OctagonX, Phone, ScanEye, Volume2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { IrisMark } from "@/components/iris/logo";
import { authClient } from "@/lib/auth-client";

import { type Direction, RobotFeed } from "./robot-feed";
import { type PanelCard, SidePanel } from "./side-panel";

type View =
  | { name: "home" }
  | { name: "phrases" }
  | { name: "help" }
  | { name: "suggestions"; heard: string; replies: string[] }
  | { name: "confirm"; text: string; from: View }
  | { name: "speaking"; text: string };

const QUICK_PHRASES = ["Please come here.", "I need some help.", "Could you repeat that?"];

// Stand-in conversation until the hub sends real `suggestions` (docs/interfaces.md §3).
const MOCK_CONVERSATIONS = [
  { heard: "Hey, do you need anything?", replies: ["Could you bring me some water?", "I’m okay, thank you.", "Can we talk for a minute?"] },
  { heard: "How are you feeling today?", replies: ["Pretty good, thanks.", "A little tired today.", "Better now that you’re here."] },
  { heard: "Want me to open the window?", replies: ["Yes, please.", "No, I’m fine.", "Maybe in a few minutes."] },
];

export default function Console({ userName }: { userName: string }) {
  const router = useRouter();
  const [view, setView] = useState<View>({ name: "home" });
  const [driveEnabled, setDriveEnabled] = useState(true);
  const [moving, setMoving] = useState<Direction | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mockIndex = useRef(0);

  // ── robot movement: short bounded bursts, re-sent while the gaze stays (interfaces.md §3)
  const move = useCallback((d: Direction) => {
    setMoving(d);
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = setTimeout(() => setMoving(null), 300);
    // TODO(hub): hub.send({ type: "move", direction: d, duration_ms: 300, seq })
  }, []);

  const speak = useCallback((text: string) => {
    setView({ name: "speaking", text });
    // TODO(hub): hub.send({ type: "speak", speak_id, text, source }); return home on tts_status: finished
    setTimeout(() => setView({ name: "home" }), 2600);
  }, []);

  const confirm = (text: string, from: View) => setView({ name: "confirm", text, from });

  // ── zero-prompt moment: someone speaks near the robot → replies appear on their own.
  //    Until the hub is connected, press S to simulate it.
  const simulateSpeech = useCallback(() => {
    const c = MOCK_CONVERSATIONS[mockIndex.current++ % MOCK_CONVERSATIONS.length]!;
    setView((v) => (v.name === "confirm" || v.name === "speaking" ? v : { name: "suggestions", ...c }));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "s" && !(e.target instanceof HTMLInputElement)) simulateSpeech();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [simulateSpeech]);

  useEffect(() => () => stream?.getTracks().forEach((t) => t.stop()), [stream]);

  async function previewWebcam() {
    try {
      setStream(await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false }));
    } catch {
      toast.error("Camera access was blocked. Allow it in the browser’s address bar and try again.");
    }
  }

  async function signOut() {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
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
          title: driveEnabled ? "Driving is on" : "Driving is off",
          hint: driveEnabled ? "Look here to pause driving" : "Look here to drive again",
          icon: Navigation,
          tone: driveEnabled ? "teal" : "plain",
          onSelect: () => setDriveEnabled((d) => !d),
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
          title: "Call my caregiver",
          icon: Phone,
          tone: "honey",
          onSelect: () => {
            toast.success("Caregiver alert sent");
            setView(home);
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
            setView(home);
          },
        },
      ];
      break;
    case "suggestions":
      heading = "Pick a reply";
      back = { label: "Ignore", onSelect: () => setView(home) };
      cards = view.replies.map((r, i) => ({
        kind: "action",
        key: r,
        title: r,
        tone: (["teal", "honey", "sky"] as const)[i]!,
        onSelect: () => confirm(r, view),
      }));
      break;
    case "confirm":
      heading = "Say this out loud?";
      cards = [
        { kind: "preview", key: "preview", text: view.text },
        { kind: "action", key: "speak", title: "Speak it", icon: Volume2, tone: "honey", onSelect: () => speak(view.text) },
        { kind: "action", key: "cancel", title: "Cancel", icon: X, tone: "plain", onSelect: () => setView(view.from) },
      ];
      break;
    case "speaking":
      heading = "IRIS is speaking";
      cards = [{ kind: "preview", key: "speaking", text: view.text, speaking: true }];
      break;
  }

  const heard = view.name === "suggestions" ? view.heard : null;

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
          onMove={move}
          onPreviewWebcam={previewWebcam}
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
              aria-label="Sign out"
              title="Sign out"
              className="grid size-8 place-items-center rounded-full text-pine-soft transition-colors hover:bg-white hover:text-pine"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        }
      />
    </main>
  );
}
