"use client";

import { Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { IrisMark } from "@/components/iris/logo";
import type { RobotStream } from "@/lib/rtc";

import { useDwell } from "./use-dwell";

export type Direction = "forward" | "backward" | "left" | "right";

type Props = {
  stream: MediaStream | null;
  localCamera?: MediaStream;
  fallbackFrameUrl?: string | null;
  mediaState?: RobotStream["state"];
  listening?: boolean;
  mirrored?: boolean;
  driveEnabled: boolean;
  moving: Direction | null;
  heard: string | null;
  /** Caption above the heard text, e.g. "Someone nearby said". */
  heardLabel?: string;
  /** Small status pill at the top of the feed, e.g. "Listening…". */
  status?: string | null;
  onMove: (d: Direction) => void;
  onPreviewWebcam: () => void;
};

export function RobotFeed({
  stream,
  localCamera,
  fallbackFrameUrl,
  mediaState = "idle",
  listening,
  mirrored,
  driveEnabled,
  moving,
  heard,
  heardLabel = "Someone nearby said",
  status,
  onMove,
  onPreviewWebcam,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const localRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const [playbackError, setPlaybackError] = useState(false);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      if (stream) void videoRef.current.play().catch(() => setPlaybackError(true));
    }
  }, [stream]);
  useEffect(() => {
    if (localRef.current) {
      localRef.current.srcObject = localCamera ?? null;
      if (localCamera) void localRef.current.play().catch(() => {});
    }
  }, [localCamera]);

  return (
    <div className="relative h-full overflow-hidden rounded-[1.5rem] bg-pine shadow-[0_10px_30px_-12px_rgb(18_56_50/0.45)]">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={muted}
          aria-label="Live robot camera"
          className={stream && !fallbackFrameUrl ? "size-full object-cover" : "hidden"}
          style={mirrored ? { transform: "scaleX(-1)" } : undefined}
        />
      {fallbackFrameUrl && <img src={fallbackFrameUrl} alt="Live robot camera, JPEG fallback" className="size-full object-cover" />}
      {!stream && !fallbackFrameUrl && <EmptyFeed onPreviewWebcam={onPreviewWebcam} mediaState={mediaState} />}

      <GuideLines />
      <div className="absolute top-3 left-3 flex items-center gap-2 rounded-full bg-pine/85 px-3 py-1.5 text-xs font-semibold text-white">
        <span>{listening ? "Someone is speaking…" : `Robot video · ${mediaState}`}</span>
        {stream && <button type="button" className="rounded-full bg-white/15 px-2 py-1" onClick={() => {
          const nextMuted = playbackError ? false : !muted;
          setMuted(nextMuted);
          if (videoRef.current) {
            videoRef.current.muted = nextMuted;
            void videoRef.current.play().then(() => setPlaybackError(false), () => setPlaybackError(true));
          }
        }}>{playbackError ? "Play audio" : muted ? "Enable audio" : "Mute audio"}</button>}
      </div>
      <div className={localCamera ? "absolute right-4 bottom-4 w-36 overflow-hidden rounded-xl bg-pine shadow-lg ring-1 ring-white/25 sm:w-48" : "hidden"}>
        <video ref={localRef} autoPlay playsInline muted aria-label="Your camera shared with the phone" className="aspect-video w-full object-cover" />
        <p className="px-2 py-1 text-center text-xs font-semibold text-white">Your camera → phone</p>
      </div>

      {/* Invisible gaze drive zones along the edges. Only a soft glow shows while one is active.
          The centre of the feed is a safe zone that never moves the robot. */}
      {driveEnabled && (
        <>
          <EdgeZone dir="forward" onMove={onMove} active={moving === "forward"} />
          <EdgeZone dir="backward" onMove={onMove} active={moving === "backward"} />
          <EdgeZone dir="left" onMove={onMove} active={moving === "left"} />
          <EdgeZone dir="right" onMove={onMove} active={moving === "right"} />
        </>
      )}

      {/* What someone near the robot just said */}
      {heard && (
        <div className="pointer-events-none absolute top-[14%] left-1/2 max-w-[70%] -translate-x-1/2 rounded-2xl rounded-bl-sm bg-honey px-5 py-3 text-pine shadow-[0_12px_28px_-10px_rgb(0_0_0/0.45)]">
          <p className="text-xs font-semibold opacity-70">{heardLabel}</p>
          <p className="font-display text-[clamp(1.2rem,1.8vw,1.6rem)] leading-tight font-bold">“{heard}”</p>
        </div>
      )}

      {status && !heard && (
        <div className="pointer-events-none absolute top-[14%] left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-white/90 px-4 py-2 text-sm font-semibold text-pine shadow-lg">
          <span className="size-2.5 animate-pulse rounded-full bg-honey" />
          {status}
        </div>
      )}

      {moving && (
        <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-white/90 px-4 py-1.5 text-sm font-semibold text-pine">
          Moving {moving}
        </div>
      )}
    </div>
  );
}

/**
 * Guide grid on the feed:
 * - 2 vertical lines → left 25% | middle 50% (widest) | right 25%
 * - 4 horizontal lines inside the middle column → 5 rows; the centre row is tallest (40%),
 *   the other four are equal (15% each).
 * Every line has its own colour.
 */
const V_LINES = [
  { left: "25%", color: "#f4b23e" }, // honey
  { left: "75%", color: "#8ec5dd" }, // sky
];
const H_LINES = [
  { top: "15%", color: "#e4553f" }, // tomato
  { top: "30%", color: "#9bd56a" }, // lime
  { top: "70%", color: "#ff8fb1" }, // pink
  { top: "85%", color: "#3fd1b8" }, // aqua
];

function GuideLines() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {V_LINES.map((l) => (
        <span
          key={l.left}
          className="absolute inset-y-0 w-0.5 -translate-x-1/2 opacity-80"
          style={{ left: l.left, background: l.color, boxShadow: `0 0 8px ${l.color}` }}
        />
      ))}
      {H_LINES.map((l) => (
        <span
          key={l.top}
          className="absolute opacity-80"
          style={{
            top: l.top,
            left: "25%",
            width: "50%",
            height: 2,
            transform: "translateY(-50%)",
            background: l.color,
            boxShadow: `0 0 8px ${l.color}`,
          }}
        />
      ))}
    </div>
  );
}

const ZONE: Record<Direction, { box: string; glow: string; label: string }> = {
  forward: { box: "inset-x-[15%] top-0 h-[13%]", glow: "bg-gradient-to-b", label: "Drive forward" },
  backward: { box: "inset-x-[15%] bottom-0 h-[13%]", glow: "bg-gradient-to-t", label: "Reverse" },
  left: { box: "inset-y-[15%] left-0 w-[10%]", glow: "bg-gradient-to-r", label: "Turn left" },
  right: { box: "inset-y-[15%] right-0 w-[10%]", glow: "bg-gradient-to-l", label: "Turn right" },
};

function EdgeZone({ dir, onMove, active }: { dir: Direction; onMove: (d: Direction) => void; active: boolean }) {
  const { ref, dwelling, props } = useDwell<HTMLDivElement>(() => onMove(dir), { ms: 600, repeatMs: 150 });
  const z = ZONE[dir];
  return (
    <div
      ref={ref}
      {...props}
      role="button"
      aria-label={z.label}
      className={`absolute ${z.box} ${z.glow} from-honey/45 to-transparent transition-opacity duration-300 ${
        active ? "opacity-100" : dwelling ? "opacity-50" : "opacity-0"
      }`}
    />
  );
}

function EmptyFeed({ onPreviewWebcam, mediaState }: { onPreviewWebcam: () => void; mediaState: RobotStream["state"] }) {
  return (
    <div className="absolute inset-0 grid size-full place-items-center">
      <div className="flex max-w-sm flex-col items-center px-6 text-center">
        <IrisMark size={72} />
        <h2 className="mt-5 font-display text-2xl font-bold text-white">{mediaState === "failed" ? "Robot video unavailable" : "Waiting for the robot’s camera"}</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-white/60">
                Sign in with the same Google email on your phone, start IRIS, then click Connect phone. Its camera appears here; your laptop camera is shared to the phone.
        </p>
        <button
          onClick={onPreviewWebcam}
          className="mt-6 flex items-center gap-2 rounded-full bg-white/10 px-4 py-2.5 text-sm font-semibold text-white ring-1 ring-white/15 transition-colors hover:bg-white/15"
        >
          <Video className="size-4" />
          Share this laptop’s camera with the phone
        </button>
      </div>
    </div>
  );
}
