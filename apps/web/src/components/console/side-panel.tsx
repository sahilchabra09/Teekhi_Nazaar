"use client";

import { ChevronLeft, KeyRound, RefreshCw } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { useDwell } from "./use-dwell";

export type Tone = "teal" | "honey" | "sky" | "pine" | "tomato" | "plain";

export type PanelCard =
  | {
      kind: "action";
      key: string;
      title: string;
      hint?: string;
      icon?: LucideIcon;
      tone: Tone;
      onSelect: () => void;
      disabled?: boolean;
    }
  | {
      kind: "preview";
      key: string;
      text: string;
      /** Small line under the text. */
      hint?: string;
      speaking?: boolean;
      /** Live mic level 0–1: shows a level meter (listening state). */
      level?: number;
      /** Spinner-style pulse while waiting on the server. */
      busy?: boolean;
    };

type Props = {
  heading: string;
  /** Shown when the panel is in a sub-view; dwell on it to go back. */
  back?: { label: string; onSelect: () => void };
  /** Optional second pill, e.g. "New replies" or "Password". */
  extra?: { label: string; onSelect: () => void; icon?: "refresh" | "settings" };
  cards: PanelCard[];
  /** Custom content instead of the three cards (e.g. the appliance grid). */
  children?: React.ReactNode;
  home?: boolean;
};

export function SidePanel({ heading, back, extra, cards, children, home }: Props) {
  return (
    <aside className="patient-actions flex min-h-0 min-w-0 flex-col" aria-label="Actions">
      <div className={home ? "sr-only" : "mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2 px-1"}>
        <h2 className="font-display text-lg leading-tight font-bold text-pine">{heading}</h2>
        <div className="flex shrink-0 items-center gap-2">
          {extra && <Pill {...extra} icon={extra.icon ?? "refresh"} />}
          {back && <Pill {...back} icon="back" />}
        </div>
      </div>

      {children ?? (
        <div className="flex min-h-0 flex-1 flex-col gap-2.5 md:gap-4">
          {cards.map((c) =>
            c.kind === "preview" ? <PreviewCard key={c.key} card={c} /> : <ActionCard key={c.key} card={c} />,
          )}
        </div>
      )}

    </aside>
  );
}

const TONE_CLASS: Record<Tone, string> = {
  teal: "clay-tone tone-teal text-white",
  honey: "clay-tone tone-honey text-pine",
  sky: "clay-tone tone-sky text-pine",
  pine: "clay-tone tone-pine text-white",
  tomato: "clay-tone tone-tomato text-white",
  plain: "clay text-pine",
};

function ActionCard({ card }: { card: Extract<PanelCard, { kind: "action" }> }) {
  const { ref, props } = useDwell<HTMLButtonElement>(card.onSelect, { disabled: card.disabled });
  const Icon = card.icon;
  return (
    <button
      ref={ref}
      {...props}
      disabled={card.disabled}
      className={`patient-action-card clay-press relative flex min-h-0 flex-1 basis-0 items-center justify-center overflow-hidden rounded-[1.75rem] text-center ${TONE_CLASS[card.tone]}`}
    >
      <span className="dwell-fill" />
      {Icon && (
        <span className="patient-card-icon relative grid shrink-0 place-items-center rounded-2xl bg-white/25 shadow-[inset_2px_3px_6px_rgb(255_255_255/0.5),inset_-2px_-3px_6px_rgb(0_0_0/0.1)]">
          <Icon className="size-7" strokeWidth={2.5} />
        </span>
      )}
      <span className="relative font-display text-[clamp(1.15rem,2.3vw,2.6rem)] leading-tight font-bold text-balance">
        {card.title}
      </span>
      {card.hint && <span className="patient-card-hint relative text-sm leading-snug font-medium opacity-90">{card.hint}</span>}
    </button>
  );
}

function PreviewCard({ card }: { card: Extract<PanelCard, { kind: "preview" }> }) {
  const { text, hint, speaking, level, busy } = card;
  return (
    <div className="clay-well flex min-h-0 flex-1 basis-0 flex-col items-center justify-center gap-4 rounded-[2.25rem] px-5 py-4 text-center">
      <p className={`font-display text-[clamp(1.1rem,1.5vw,1.45rem)] leading-tight font-bold text-pine text-balance ${busy ? "animate-pulse" : ""}`}>
        {text}
      </p>
      {level !== undefined && <LevelMeter level={level} />}
      {speaking && (
        <div className="flex h-7 items-center gap-1.5" aria-label="Speaking">
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className="speak-bar h-full w-1.5 rounded-full bg-teal"
              style={{ animation: `speak-bar 900ms ease-in-out ${i * 120}ms infinite` }}
            />
          ))}
        </div>
      )}
      {hint && <p className="text-sm font-medium text-pine-soft">{hint}</p>}
    </div>
  );
}

/** Seven bars that follow the mic level; the middle ones react most. */
function LevelMeter({ level }: { level: number }) {
  const weights = [0.35, 0.6, 0.85, 1, 0.85, 0.6, 0.35];
  return (
    <div className="flex h-10 items-center gap-1.5" aria-label="Microphone level">
      {weights.map((w, i) => (
        <span
          key={i}
          className="w-2 rounded-full bg-honey transition-[height] duration-100"
          style={{ height: `${Math.max(14, Math.min(100, level * w * 160))}%` }}
        />
      ))}
    </div>
  );
}

function Pill({ label, onSelect, icon }: { label: string; onSelect: () => void; icon: "back" | "refresh" | "settings" }) {
  const { ref, props } = useDwell<HTMLButtonElement>(onSelect, { ms: 800 });
  const Icon = icon === "back" ? ChevronLeft : icon === "settings" ? KeyRound : RefreshCw;
  return (
    <button
      ref={ref}
      {...props}
      className="clay-sm clay-press relative flex shrink-0 items-center gap-1 overflow-hidden rounded-full py-2 pr-3.5 pl-2.5 text-sm font-bold text-pine"
    >
      <span className="dwell-fill !bg-honey/60" />
      <Icon className={`relative ${icon === "back" ? "size-4" : "size-3.5"}`} strokeWidth={2.5} />
      <span className="relative">{label}</span>
    </button>
  );
}
