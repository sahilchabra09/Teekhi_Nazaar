import type { CSSProperties } from "react";

type Shape = {
  kind: "ball" | "ring" | "pill" | "cube" | "half" | "squiggle" | "spark";
  tone: "teal" | "honey" | "sky" | "pine" | "tomato";
  size: number; // px
  top: string;
  left: string;
  rotate?: number;
  delay?: number;
  drift?: number;
  /** Hidden below the lg breakpoint, where it would sit behind text. */
  desktopOnly?: boolean;
};

/** A scattered field of clay shapes: dense on the sign-in page, sparse on the console. */
const SIGN_IN: Shape[] = [
  { kind: "ball", tone: "honey", size: 150, top: "8%", left: "6%", delay: 0, drift: 10, desktopOnly: true },
  { kind: "ring", tone: "teal", size: 190, top: "62%", left: "-3%", rotate: -12, delay: 120, drift: 12 },
  { kind: "pill", tone: "sky", size: 210, top: "80%", left: "30%", rotate: -24, delay: 200, drift: 11, desktopOnly: true },
  { kind: "cube", tone: "pine", size: 96, top: "14%", left: "44%", rotate: 18, delay: 260, drift: 9, desktopOnly: true },
  { kind: "half", tone: "tomato", size: 120, top: "4%", left: "80%", rotate: 200, delay: 320, drift: 13 },
  { kind: "squiggle", tone: "honey", size: 180, top: "72%", left: "78%", rotate: -8, delay: 440, drift: 12 },
  { kind: "ring", tone: "sky", size: 92, top: "40%", left: "90%", rotate: 30, delay: 560, drift: 10 },
];

const CONSOLE: Shape[] = [
  { kind: "ball", tone: "honey", size: 120, top: "88%", left: "93%", drift: 14 },
  { kind: "ring", tone: "teal", size: 150, top: "78%", left: "68%", rotate: 20, delay: 120, drift: 16 },
  { kind: "pill", tone: "sky", size: 160, top: "86%", left: "-4%", rotate: -20, delay: 200, drift: 15 },
  { kind: "half", tone: "tomato", size: 90, top: "-3%", left: "56%", rotate: 180, delay: 260, drift: 13 },
  { kind: "spark", tone: "honey", size: 46, top: "90%", left: "40%", delay: 320, drift: 10 },
];

export function ClayShapes({ variant = "sign-in" }: { variant?: "sign-in" | "console" }) {
  const shapes = variant === "sign-in" ? SIGN_IN : CONSOLE;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {shapes.map((s, i) => (
        <div
          key={i}
          className={`shape-pop absolute tone-${s.tone} ${s.desktopOnly ? "max-lg:hidden" : ""}`}
          style={
            {
              top: s.top,
              left: s.left,
              width: s.size,
              height: s.size,
              "--r": `${s.rotate ?? 0}deg`,
              "--delay": `${s.delay ?? 0}ms`,
              "--drift": `${s.drift ?? 10}s`,
            } as CSSProperties
          }
        >
          <ShapeBody shape={s} />
        </div>
      ))}
    </div>
  );
}

function ShapeBody({ shape }: { shape: Shape }) {
  const { kind, size } = shape;
  switch (kind) {
    case "ball":
      return <div className="clay-ball size-full rounded-full" />;
    case "ring":
      return (
        <div
          className="size-full rounded-full"
          style={{
            border: `${size * 0.2}px solid var(--tone)`,
            boxShadow:
              "12px 16px 28px var(--tone-shadow), inset 6px 8px 14px rgb(0 0 0 / 0.14), inset -2px -2px 6px rgb(255 255 255 / 0.4)",
            background: "transparent",
          }}
        >
          <div
            className="size-full rounded-full"
            style={{ boxShadow: "inset -6px -8px 12px rgb(0 0 0 / 0.12), 4px 6px 10px rgb(255 255 255 / 0.35)" }}
          />
        </div>
      );
    case "pill":
      return <div className="clay-tone rounded-full" style={{ width: size, height: size * 0.38 }} />;
    case "cube":
      return <div className="clay-tone size-full" style={{ borderRadius: size * 0.28 }} />;
    case "half":
      return (
        <div
          className="clay-tone"
          style={{ width: size, height: size / 2, borderRadius: `${size}px ${size}px 0 0` }}
        />
      );
    case "squiggle":
      return (
        <svg viewBox="0 0 180 60" width={size} height={size / 3} className="overflow-visible">
          <path
            d="M10 40 Q 32 6 54 30 T 98 30 T 142 30 T 172 22"
            fill="none"
            stroke="var(--tone-shadow)"
            strokeWidth="22"
            strokeLinecap="round"
            transform="translate(6 9)"
          />
          <path
            d="M10 40 Q 32 6 54 30 T 98 30 T 142 30 T 172 22"
            fill="none"
            stroke="var(--tone)"
            strokeWidth="20"
            strokeLinecap="round"
          />
          <path
            d="M10 40 Q 32 6 54 30 T 98 30 T 142 30 T 172 22"
            fill="none"
            stroke="rgb(255 255 255 / 0.45)"
            strokeWidth="5"
            strokeLinecap="round"
            transform="translate(-3 -5)"
          />
        </svg>
      );
    case "spark":
      return (
        <svg viewBox="0 0 64 64" width={size} height={size} className="overflow-visible">
          <path
            d="M32 2 C35 22 42 29 62 32 C42 35 35 42 32 62 C29 42 22 35 2 32 C22 29 29 22 32 2 Z"
            fill="var(--tone-shadow)"
            transform="translate(4 6)"
          />
          <path
            d="M32 2 C35 22 42 29 62 32 C42 35 35 42 32 62 C29 42 22 35 2 32 C22 29 29 22 32 2 Z"
            fill="var(--tone)"
          />
          <path d="M30 14 C31 22 33 26 38 28" stroke="rgb(255 255 255 / 0.6)" strokeWidth="3" fill="none" strokeLinecap="round" />
        </svg>
      );
  }
}
