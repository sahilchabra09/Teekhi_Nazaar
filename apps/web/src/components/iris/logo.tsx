import { useId } from "react";

/** IRIS mark: a clay eyeball (teal iris, pine pupil, honey flecks) with an AI spark. */
export function IrisMark({ size = 44, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="IRIS"
    >
      <defs>
        <radialGradient id={`${id}-ball`} cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="55%" stopColor="#edf6f1" />
          <stop offset="100%" stopColor="#b9d4ca" />
        </radialGradient>
        <radialGradient id={`${id}-iris`} cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#5fc0ad" />
          <stop offset="60%" stopColor="#22786a" />
          <stop offset="100%" stopColor="#155a4f" />
        </radialGradient>
        <filter id={`${id}-shadow`} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="2.5" dy="3.5" stdDeviation="3" floodColor="#1e4e44" floodOpacity="0.28" />
        </filter>
      </defs>

      {/* eyeball */}
      <circle cx="30" cy="34" r="25" fill={`url(#${id}-ball)`} filter={`url(#${id}-shadow)`} />
      {/* iris */}
      <circle cx="30" cy="34" r="14" fill={`url(#${id}-iris)`} />
      {/* honey flecks */}
      <circle cx="30" cy="34" r="9.5" fill="none" stroke="#f4b23e" strokeWidth="2.2" strokeDasharray="2.4 3.2" opacity="0.9" />
      {/* pupil */}
      <circle cx="30" cy="34" r="6" fill="#123832" />
      {/* catchlight */}
      <ellipse cx="26" cy="29.5" rx="3.2" ry="2.4" fill="#ffffff" opacity="0.9" />

      {/* AI spark */}
      <path
        d="M52 4 C53 10 54 11 60 12 C54 13 53 14 52 20 C51 14 50 13 44 12 C50 11 51 10 52 4 Z"
        fill="#f4b23e"
        stroke="#d98f12"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IrisWordmark({ size = 44 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2.5">
      <IrisMark size={size} />
      <span
        className="font-display font-extrabold tracking-tight text-pine"
        style={{ fontSize: size * 0.62, lineHeight: 1 }}
      >
        IRIS
      </span>
    </span>
  );
}
