"use client";

import { ChevronLeft } from "lucide-react";
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
    }
  | { kind: "preview"; key: string; text: string; speaking?: boolean };

type Props = {
  heading: string;
  /** Shown when the panel is in a sub-view; dwell on it to go back. */
  back?: { label: string; onSelect: () => void };
  cards: PanelCard[];
  footer?: React.ReactNode;
};

export function SidePanel({ heading, back, cards, footer }: Props) {
  return (
    <aside className="flex h-full min-h-0 flex-col gap-3" aria-label="Actions">
      <div className="flex min-h-10 items-center justify-between gap-2 px-1">
        <h2 className="font-display text-lg leading-tight font-bold text-pine">{heading}</h2>
        {back && <BackPill {...back} />}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-5 px-1 pb-2">
        {cards.map((c) =>
          c.kind === "preview" ? <PreviewCard key={c.key} text={c.text} speaking={c.speaking} /> : <ActionCard key={c.key} card={c} />,
        )}
      </div>

      {footer}
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
  const { ref, props } = useDwell<HTMLButtonElement>(card.onSelect);
  const Icon = card.icon;
  return (
    <button
      ref={ref}
      {...props}
      className={`clay-press relative flex min-h-0 flex-1 basis-0 flex-col items-center justify-center gap-3 overflow-hidden rounded-[2.25rem] px-5 py-4 text-center ${TONE_CLASS[card.tone]}`}
    >
      <span className="dwell-fill" />
      {Icon && (
        <span className="relative grid size-14 shrink-0 place-items-center rounded-2xl bg-white/25 shadow-[inset_2px_3px_6px_rgb(255_255_255/0.5),inset_-2px_-3px_6px_rgb(0_0_0/0.1)]">
          <Icon className="size-7" strokeWidth={2.5} />
        </span>
      )}
      <span className="relative font-display text-[clamp(1.15rem,1.6vw,1.6rem)] leading-tight font-bold text-balance">
        {card.title}
      </span>
      {card.hint && <span className="relative text-sm leading-snug font-medium opacity-80">{card.hint}</span>}
    </button>
  );
}

function PreviewCard({ text, speaking }: { text: string; speaking?: boolean }) {
  return (
    <div className="clay-well flex min-h-0 flex-1 basis-0 flex-col items-center justify-center gap-4 rounded-[2.25rem] px-5 py-4 text-center">
      <p className="font-display text-[clamp(1.1rem,1.5vw,1.45rem)] leading-tight font-bold text-pine text-balance">“{text}”</p>
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
    </div>
  );
}

function BackPill({ label, onSelect }: { label: string; onSelect: () => void }) {
  const { ref, props } = useDwell<HTMLButtonElement>(onSelect, { ms: 800 });
  return (
    <button
      ref={ref}
      {...props}
      className="clay-sm clay-press relative flex shrink-0 items-center gap-1 overflow-hidden rounded-full py-2 pr-3.5 pl-2.5 text-sm font-bold text-pine"
    >
      <span className="dwell-fill !bg-honey/60" />
      <ChevronLeft className="relative size-4" strokeWidth={2.5} />
      <span className="relative">{label}</span>
    </button>
  );
}
