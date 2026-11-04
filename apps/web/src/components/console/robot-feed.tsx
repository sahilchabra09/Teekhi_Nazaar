"use client";

import { VideoOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { ReactNode } from "react";
import { VideoTool } from "./connection-bar";
import type { DriveAction, Direction, DriveSource, StopState } from "@/lib/mqtt/robot";
import type { RobotStream } from "@/lib/rtc";

export type DriveControls = {
  enabled: boolean;
  stopState: StopState;
  active: Direction | null;
  start: (action: Direction, source: DriveSource) => void;
  release: (action: DriveAction, source?: DriveSource) => void;
  stop: (explicit?: boolean) => void;
  frame: () => void;
  lostFeed: () => void;
};

type Props = {
  stream: MediaStream | null;
  localCamera?: MediaStream;
  fallbackFrameUrl?: string | null;
  mediaState?: RobotStream["state"];
  listening?: boolean;
  mirrored?: boolean;
  /** Present → the coloured regions become clickable while robot video is showing. */
  drive?: DriveControls;
  heard: string | null;
  /** Caption above the heard text, e.g. "Someone nearby said". */
  heardLabel?: string;
  /** Small status pill at the top of the feed, e.g. "Listening…". */
  status?: string | null;
  menu?: ReactNode;
};

export function RobotFeed({
  stream,
  localCamera,
  fallbackFrameUrl,
  mediaState = "idle",
  listening,
  mirrored,
  drive,
  heard,
  heardLabel = "Someone nearby said",
  status,
  menu,
}: Props) {
  // Regions only exist while the robot's camera (stream or JPEG fallback) is on screen;
  // the green waiting screen is never clickable.
  const hasFeed = Boolean(stream || fallbackFrameUrl);
  const stopOnly = !hasFeed && (drive?.stopState === "pending" || drive?.stopState === "available");
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

  const frame = drive?.frame;
  const lostFeed = drive?.lostFeed;
  useEffect(() => () => { lostFeed?.(); }, [stream, mediaState, lostFeed]);
  useEffect(() => {
    const video = videoRef.current;
    if (!stream || !video || !frame || mediaState !== "live") return;
    let token = 0;
    const seen = () => {
      if (video.videoWidth && !video.paused && stream.getVideoTracks().some(t => t.readyState === "live" && !t.muted)) frame();
    };
    if (typeof video.requestVideoFrameCallback === "function") {
      const next = () => { seen(); token = video.requestVideoFrameCallback(next); };
      token = video.requestVideoFrameCallback(next);
    } else {
      video.addEventListener("timeupdate", seen);
    }
    return () => {
      if (token) video.cancelVideoFrameCallback(token);
      video.removeEventListener("timeupdate", seen);
    };
  }, [stream, mediaState, frame]);

  return (
    <section aria-label="Robot video" className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[1.75rem] bg-pine text-white">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2.5 md:px-5">
        <h2 className="mr-auto flex items-center gap-2 font-display text-lg font-bold">
          <span aria-hidden className={`size-2 rounded-full ${hasFeed ? "bg-teal-light" : "bg-sky"}`} />Robot video
        </h2>
        {menu}
      </header>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={muted}
          onEnded={() => lostFeed?.()}
          onError={() => lostFeed?.()}
          onPause={() => lostFeed?.()}
          aria-label="Live robot camera"
          className={stream && !fallbackFrameUrl ? "size-full object-cover" : "hidden"}
          style={mirrored ? { transform: "scaleX(-1)" } : undefined}
        />
      {fallbackFrameUrl && <img src={fallbackFrameUrl} onLoad={frame} onError={lostFeed} alt="Live robot camera, JPEG fallback" className="size-full object-cover" />}
      {!hasFeed && !stopOnly && <EmptyFeed mediaState={mediaState} />}

      {hasFeed && drive && <GuideLines />}
      {drive && (hasFeed || stopOnly) && <DriveRegions drive={drive} stopOnly={stopOnly} />}

      {/* Everything below sits above the regions (z-20), so clicking it never moves the robot. */}
      {(stream || fallbackFrameUrl || listening) && <div className="absolute top-3 left-3 z-20 flex items-center gap-2 rounded-full bg-pine/85 px-3 py-1.5 text-xs font-semibold text-white">
        <span>{listening ? "Someone is speaking…" : `Robot video · ${mediaState}`}</span>
        {stream && <VideoTool className="bg-white/15 text-white" onSelect={() => {
          const nextMuted = playbackError ? false : !muted;
          setMuted(nextMuted);
          if (videoRef.current) {
            videoRef.current.muted = nextMuted;
            void videoRef.current.play().then(() => setPlaybackError(false), () => setPlaybackError(true));
          }
        }}>{playbackError ? "Play audio" : muted ? "Enable audio" : "Mute audio"}</VideoTool>}
      </div>}
      <div className={localCamera ? "absolute right-4 bottom-4 z-20 w-36 overflow-hidden rounded-xl bg-pine shadow-lg ring-1 ring-white/25 sm:w-48" : "hidden"}>
        <video ref={localRef} autoPlay playsInline muted aria-label="Your camera shared with the phone" className="aspect-video w-full object-cover" />
        <p className="px-2 py-1 text-center text-xs font-semibold text-white">Your camera → phone</p>
      </div>

      {/* What someone near the robot just said */}
      {heard && !drive && (
        <div className="absolute top-[14%] left-1/2 z-20 max-w-[70%] -translate-x-1/2 rounded-2xl rounded-bl-sm bg-honey px-5 py-3 text-pine shadow-[0_12px_28px_-10px_rgb(0_0_0/0.45)]">
          <p className="text-xs font-semibold opacity-70">{heardLabel}</p>
          <p className="font-display text-[clamp(1.2rem,1.8vw,1.6rem)] leading-tight font-bold">“{heard}”</p>
        </div>
      )}

      {status && !heard && (
        <div className="absolute top-[14%] left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full bg-white/90 px-4 py-2 text-sm font-semibold text-pine shadow-lg">
          <span className="size-2.5 animate-pulse rounded-full bg-honey" />
          {status}
        </div>
      )}

      </div>
      {drive && (hasFeed || stopOnly || drive.stopState === "disarmed") && (
        <p role="status" className="shrink-0 border-t border-white/15 px-4 py-2 text-sm font-semibold">
          {drive.stopState === "pending" ? "Stop requested. Waiting for the phone. Select the center to retry."
            : drive.stopState === "disarmed" ? "Phone reports driving is disarmed. Enable driving on the phone to move again."
            : !hasFeed ? "Video unavailable. Only Stop is available."
            : drive.active ? "Release the direction or look away to stop."
            : drive.enabled ? "Hold a direction to move. The center stops the robot."
            : "Waiting for drive access. Check the mounted phone’s calibration and drive session."}
        </p>
      )}
    </section>
  );
}

const V_LINES = [
  { left: "25%", color: "#f4b23e" }, // honey
  { left: "75%", color: "#8ec5dd" }, // sky
];
const H_LINES = [
  { top: "30%", color: "#9bd56a" }, // lime
  { top: "70%", color: "#ff8fb1" }, // pink
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

const REGIONS: { action: DriveAction; label: string; style: React.CSSProperties }[] = [
  { action: "left", label: "Turn left", style: { left: 0, top: 0, width: "25%", height: "100%" } },
  { action: "right", label: "Turn right", style: { left: "75%", top: 0, width: "25%", height: "100%" } },
  { action: "forward", label: "Forward", style: { left: "25%", top: 0, width: "50%", height: "30%" } },
  { action: "stop", label: "Stop", style: { left: "25%", top: "30%", width: "50%", height: "40%" } },
  { action: "backward", label: "Back", style: { left: "25%", top: "70%", width: "50%", height: "30%" } },
];

function DriveRegions({ drive, stopOnly }: { drive: DriveControls; stopOnly: boolean }) {
  return <div className="absolute inset-0 z-10" aria-label="Robot drive controls">
    {REGIONS.filter(region => !stopOnly || region.action === "stop").map(region => <DriveRegion key={region.action} {...region} drive={drive} />)}
  </div>;
}

function DriveRegion({ action, label, style, drive }: (typeof REGIONS)[number] & { drive: DriveControls }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [looking, setLooking] = useState(false);
  const { start, release, stop, enabled } = drive;
  const isStop = action === "stop";

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const enter = () => setLooking(true);
    const select = () => {
      if (isStop) { stop(true); return; }
      start(action, "gaze");
    };
    const leave = () => {
      setLooking(false);
      release(action, "gaze");
    };
    el.addEventListener("gaze:enter", enter);
    el.addEventListener("gaze:select", select);
    el.addEventListener("gaze:leave", leave);
    return () => {
      el.removeEventListener("gaze:enter", enter);
      el.removeEventListener("gaze:select", select);
      el.removeEventListener("gaze:leave", leave);
      release(action);
    };
  }, [action, isStop, start, release, stop]);

  return <button ref={ref} type="button" data-gaze-target="" data-gaze-dwell="900"
    disabled={isStop ? drive.stopState === "unavailable" || drive.stopState === "disarmed" : !enabled}
    aria-label={isStop ? "Stop driving" : `Hold to drive: ${label}`}
    onClick={isStop ? () => stop(true) : undefined}
    onPointerDown={e => {
      if (isStop || !e.isPrimary || e.button !== 0) return;
      start(action, "pointer");
    }}
    onPointerMove={e => {
      if (!e.isPrimary || !(e.buttons & 1)) return;
      const r = e.currentTarget.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX >= r.right || e.clientY < r.top || e.clientY >= r.bottom) release(action, "pointer");
    }}
    onPointerUp={() => release(action, "pointer")} onPointerCancel={() => release(action, "pointer")}
    onPointerLeave={() => release(action, "pointer")} onLostPointerCapture={() => release(action, "pointer")}
    onKeyDown={e => {
      if (isStop || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      if (!e.repeat) start(action, "keyboard");
    }}
    onKeyUp={e => { if (e.key === "Enter" || e.key === " ") release(action, "keyboard"); }}
    onBlur={() => release(action, "keyboard")}
    style={style}
    className={`absolute grid touch-none select-none place-items-center transition-colors focus-visible:bg-white/15 disabled:opacity-50 ${
      drive.active === action ? "bg-honey/20" : looking ? "bg-white/15" : "enabled:hover:bg-white/10"
    }`}>
    <span className={`rounded-full px-3 py-1 font-display text-base font-bold text-white ${
      drive.active === action ? "bg-teal" : isStop ? "bg-tomato px-5 py-2 text-xl" : "bg-pine/65"
    }`}>{isStop && drive.stopState === "pending" ? "Retry stop" : label}</span>
  </button>;
}

function EmptyFeed({ mediaState }: { mediaState?: RobotStream["state"] }) {
  return (
    <div className="absolute inset-0 grid place-items-center p-4">
      <div className="max-w-sm text-center">
        <VideoOff aria-hidden className="mx-auto mb-3 size-9 text-white/55" strokeWidth={1.5} />
        <p className="font-display text-xl font-semibold text-white/90">{mediaState === "failed" ? "Camera stream unavailable" : "Waiting for phone video"}</p>
        <p className="mt-1 text-sm text-white/70">{mediaState === "failed" ? "Check the phone session and reconnect." : "The camera picture appears here when the mounted phone is streaming."}</p>
      </div>
    </div>
  );
}
