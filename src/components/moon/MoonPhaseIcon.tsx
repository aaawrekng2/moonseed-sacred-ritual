import type { MoonPhaseName } from "@/lib/moon";
import { cn } from "@/lib/utils";

type Props = {
  phase: MoonPhaseName;
  size?: number;
  className?: string;
  ariaHidden?: boolean;
};

const VB = 64;
const R = 26;
const CX = 32;
const CY = 32;

export function MoonPhaseIcon({ phase, size = 64, className, ariaHidden = true }: Props) {
  const id = `mp-${phase.replace(/\s+/g, "-").toLowerCase()}`;
  const bodyId = `${id}-body`;
  const glowId = `${id}-glow`;
  const pearlId = `${id}-pearl`;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${VB} ${VB}`}
      className={cn("block", className)}
      aria-hidden={ariaHidden}
      role={ariaHidden ? undefined : "img"}
    >
      <defs>
        <radialGradient id={bodyId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#1a1438" />
          <stop offset="70%" stopColor="#0d0a24" />
          <stop offset="100%" stopColor="#06051a" />
        </radialGradient>
        <radialGradient id={pearlId} cx="40%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#fffbe8" />
          <stop offset="60%" stopColor="#e8e3d0" />
          <stop offset="100%" stopColor="#a8a392" />
        </radialGradient>
        <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.5" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <radialGradient id={`${id}-halo`} cx="50%" cy="50%" r="50%">
          <stop offset="60%" stopColor="rgba(212,175,55,0)" />
          <stop offset="100%" stopColor="rgba(212,175,55,0.18)" />
        </radialGradient>
      </defs>
      <circle cx={CX} cy={CY} r={R + 4} fill={`url(#${id}-halo)`} />
      <circle cx={CX} cy={CY} r={R} fill={`url(#${bodyId})`} />
      <PhaseIllumination phase={phase} pearlId={pearlId} glowId={glowId} />
      <circle cx={CX} cy={CY} r={R} fill="none" stroke="rgba(212,175,55,0.25)" strokeWidth={0.5} />
    </svg>
  );
}

function PhaseIllumination({ phase, pearlId, glowId }: { phase: MoonPhaseName; pearlId: string; glowId: string }) {
  const pearl = `url(#${pearlId})`;
  const filter = `url(#${glowId})`;
  switch (phase) {
    case "New Moon":
      return <circle cx={CX} cy={CY} r={R} fill="none" stroke="rgba(255,251,232,0.18)" strokeWidth={0.6} />;
    case "Full Moon":
      return <circle cx={CX} cy={CY} r={R} fill={pearl} filter={filter} />;
    case "First Quarter":
      return <path d={`M ${CX} ${CY - R} A ${R} ${R} 0 0 1 ${CX} ${CY + R} Z`} fill={pearl} filter={filter} />;
    case "Last Quarter":
      return <path d={`M ${CX} ${CY - R} A ${R} ${R} 0 0 0 ${CX} ${CY + R} Z`} fill={pearl} filter={filter} />;
    case "Waxing Crescent":
      return <path d={crescentPath({ side: "right", thickness: 0.35 })} fill={pearl} filter={filter} />;
    case "Waning Crescent":
      return <path d={crescentPath({ side: "left", thickness: 0.35 })} fill={pearl} filter={filter} />;
    case "Waxing Gibbous":
      return <path d={gibbousPath({ side: "right", thickness: 0.7 })} fill={pearl} filter={filter} />;
    case "Waning Gibbous":
      return <path d={gibbousPath({ side: "left", thickness: 0.7 })} fill={pearl} filter={filter} />;
    default:
      // Safety fallback — render a Full Moon so no phase ever renders empty.
      return <circle cx={CX} cy={CY} r={R} fill={pearl} filter={filter} />;
  }
}

function crescentPath({ side, thickness }: { side: "left" | "right"; thickness: number }): string {
  const sweepOuter = side === "right" ? 1 : 0;
  const sweepInner = side === "right" ? 0 : 1;
  const rx = R * (1 - thickness * 2);
  const innerRx = Math.abs(rx);
  return [
    `M ${CX} ${CY - R}`,
    `A ${R} ${R} 0 0 ${sweepOuter} ${CX} ${CY + R}`,
    `A ${innerRx} ${R} 0 0 ${sweepInner} ${CX} ${CY - R}`,
    "Z",
  ].join(" ");
}

function gibbousPath({ side, thickness }: { side: "left" | "right"; thickness: number }): string {
  const sweepOuter = side === "right" ? 1 : 0;
  const sweepInner = side === "right" ? 1 : 0;
  const rx = R * (thickness * 2 - 1);
  const innerRx = Math.max(0.001, rx);
  return [
    `M ${CX} ${CY - R}`,
    `A ${R} ${R} 0 0 ${sweepOuter} ${CX} ${CY + R}`,
    `A ${innerRx} ${R} 0 0 ${sweepInner} ${CX} ${CY - R}`,
    "Z",
  ].join(" ");
}
