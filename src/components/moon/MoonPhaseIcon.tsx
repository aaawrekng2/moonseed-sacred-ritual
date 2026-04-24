import type { MoonPhaseName } from "@/lib/moon";

interface Props {
  phase: MoonPhaseName;
  size?: number;
  className?: string;
  ariaHidden?: boolean;
}

const CX = 32;
const CY = 32;
const R = 26;

function crescentPath(side: "right" | "left", thickness: number): string {
  const rx = R * (1 - thickness * 2);
  const sweepOuter = side === "right" ? 1 : 0;
  const sweepInner = side === "right" ? 0 : 1;
  return `M ${CX} ${CY - R} A ${R} ${R} 0 0 ${sweepOuter} ${CX} ${CY + R} A ${Math.abs(rx)} ${R} 0 0 ${sweepInner} ${CX} ${CY - R} Z`;
}

function gibbousPath(side: "right" | "left", thickness: number): string {
  const rx = R * (thickness * 2 - 1);
  const sweepOuter = side === "right" ? 1 : 0;
  const sweepInner = side === "right" ? 1 : 0;
  return `M ${CX} ${CY - R} A ${R} ${R} 0 0 ${sweepOuter} ${CX} ${CY + R} A ${Math.abs(rx)} ${R} 0 0 ${sweepInner} ${CX} ${CY - R} Z`;
}

export function MoonPhaseIcon({
  phase,
  size = 64,
  className,
  ariaHidden = true,
}: Props) {
  const id = `moon-${phase.replace(/\s+/g, "-").toLowerCase()}`;
  const pearl = `pearl-${id}`;
  const glow = `glow-${id}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      aria-hidden={ariaHidden}
    >
      <defs>
        <radialGradient id={pearl} cx="50%" cy="45%" r="55%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
          <stop offset="55%" stopColor="#e6e6f0" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#a8a8c0" stopOpacity="0.6" />
        </radialGradient>
        <filter id={glow} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {phase === "New Moon" && (
        <>
          <circle cx={CX} cy={CY} r={R} fill="#1a1530" />
          <circle
            cx={CX}
            cy={CY}
            r={R}
            fill="none"
            stroke="rgba(220,210,255,0.25)"
            strokeWidth="0.6"
          />
        </>
      )}

      {phase === "Full Moon" && (
        <circle
          cx={CX}
          cy={CY}
          r={R}
          fill={`url(#${pearl})`}
          filter={`url(#${glow})`}
        />
      )}

      {phase === "First Quarter" && (
        <>
          <circle cx={CX} cy={CY} r={R} fill="#1a1530" />
          <path
            d={`M ${CX} ${CY - R} A ${R} ${R} 0 0 1 ${CX} ${CY + R} Z`}
            fill={`url(#${pearl})`}
          />
        </>
      )}

      {phase === "Last Quarter" && (
        <>
          <circle cx={CX} cy={CY} r={R} fill="#1a1530" />
          <path
            d={`M ${CX} ${CY - R} A ${R} ${R} 0 0 0 ${CX} ${CY + R} Z`}
            fill={`url(#${pearl})`}
          />
        </>
      )}

      {phase === "Waxing Crescent" && (
        <>
          <circle cx={CX} cy={CY} r={R} fill="#1a1530" />
          <path d={crescentPath("right", 0.15)} fill={`url(#${pearl})`} />
        </>
      )}

      {phase === "Waning Crescent" && (
        <>
          <circle cx={CX} cy={CY} r={R} fill="#1a1530" />
          <path d={crescentPath("left", 0.15)} fill={`url(#${pearl})`} />
        </>
      )}

      {phase === "Waxing Gibbous" && (
        <>
          <circle cx={CX} cy={CY} r={R} fill="#1a1530" />
          <path d={gibbousPath("right", 0.7)} fill={`url(#${pearl})`} />
        </>
      )}

      {phase === "Waning Gibbous" && (
        <>
          <circle cx={CX} cy={CY} r={R} fill="#1a1530" />
          <path d={gibbousPath("left", 0.7)} fill={`url(#${pearl})`} />
        </>
      )}
    </svg>
  );
}