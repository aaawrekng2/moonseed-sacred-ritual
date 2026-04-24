import { useEffect, useId, useRef } from "react";
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

// Dev-only: warn at most once per (phase + reason) so a regression can't
// silently re-introduce the "empty rung" bug. No-op in production builds.
const warnedKeys = new Set<string>();
function warnOnce(key: string, message: string) {
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  // eslint-disable-next-line no-console
  console.warn(`[MoonPhaseIcon] ${message}`);
}

export function MoonPhaseIcon({ phase, size = 64, className, ariaHidden = true }: Props) {
  // useId guarantees a unique base for every rendered instance, so multiple
  // icons in the document never collide on <defs>/<mask>/<radialGradient> IDs.
  // Without this the second-and-later instances of the same phase can render
  // empty in some browsers because the URL reference resolves to a stripped
  // duplicate def.
  const reactId = useId().replace(/[:]/g, "");
  const id = `mp-${phase.replace(/\s+/g, "-").toLowerCase()}-${reactId}`;
  const bodyId = `${id}-body`;
  const glowId = `${id}-glow`;
  const pearlId = `${id}-pearl`;
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Dev-only assertion: after mount, verify (a) the SVG has non-zero box,
  // and (b) every url(#...) reference inside it resolves to a real def in
  // the same document. Catches regressions where a parent rule clips the
  // icon to 0×0, or where a future refactor breaks the unique-id wiring.
  useEffect(() => {
    if (import.meta.env.PROD) return;
    const svg = svgRef.current;
    if (!svg) return;
    // Defer one frame so layout has settled before measuring.
    const raf = requestAnimationFrame(() => {
      // Skip if the element was unmounted between schedule and tick — a
      // 0×0 box on a detached node is an unmount race, not a layout bug.
      if (!svg.isConnected) return;
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        warnOnce(
          `${phase}-zero-box`,
          `phase "${phase}" rendered with zero box (${rect.width}×${rect.height}). A parent flex/clip rule is likely cropping the icon.`,
        );
      }
      const refs = svg.querySelectorAll<SVGElement>(
        "[mask], [fill^='url('], [stroke^='url(']",
      );
      refs.forEach((el) => {
        for (const attr of ["mask", "fill", "stroke"] as const) {
          const val = el.getAttribute(attr);
          if (!val || !val.startsWith("url(#")) continue;
          const refId = val.slice(5, -1);
          if (!svg.querySelector(`#${CSS.escape(refId)}`)) {
            warnOnce(
              `${phase}-missing-${refId}`,
              `phase "${phase}" references missing def "#${refId}" via ${attr}. Mask/gradient wiring is broken.`,
            );
          }
        }
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  return (
    <svg
      ref={svgRef}
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
        {/* Mask used for crescent/gibbous: white = visible pearl, black = hidden */}
        <PhaseMask phase={phase} maskId={`${id}-mask`} />
      </defs>
      <circle cx={CX} cy={CY} r={R + 2} fill={`url(#${id}-halo)`} />
      <circle cx={CX} cy={CY} r={R} fill={`url(#${bodyId})`} />
      <PhaseIllumination phase={phase} pearlId={pearlId} glowId={glowId} maskId={`${id}-mask`} />
      <circle cx={CX} cy={CY} r={R} fill="none" stroke="rgba(212,175,55,0.25)" strokeWidth={0.5} />
    </svg>
  );
}

function PhaseIllumination({
  phase,
  pearlId,
  glowId,
  maskId,
}: {
  phase: MoonPhaseName;
  pearlId: string;
  glowId: string;
  maskId: string;
}) {
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
    case "Waning Crescent":
    case "Waxing Gibbous":
    case "Waning Gibbous":
      // Render the full pearl disc and mask away the dark portion. This is
      // far more reliable than two-arc paths (which can degenerate to empty
      // shapes if sweep flags or radii are off) and guarantees the moon is
      // always visibly illuminated.
      return (
        <circle
          cx={CX}
          cy={CY}
          r={R}
          fill={pearl}
          filter={filter}
          mask={`url(#${maskId})`}
        />
      );
    default:
      // Safety fallback — render a Full Moon so no phase ever renders empty.
      return <circle cx={CX} cy={CY} r={R} fill={pearl} filter={filter} />;
  }
}

/**
 * Build an SVG <mask> for crescent/gibbous phases. White areas = visible
 * pearl; black areas = hidden (dark side of the moon).
 *
 * Approach: start with a full-white disc (entire moon visible), then paint
 * a black ellipse to subtract the shadowed portion. Ellipse position and
 * width are chosen so the visible illumination matches the named phase.
 */
function PhaseMask({ phase, maskId }: { phase: MoonPhaseName; maskId: string }) {
  // shadowSide = which side of the moon is dark.
  // shadowWidth = horizontal radius of the shadow ellipse, as a fraction of R.
  //   Smaller value → smaller shadow → more illumination (gibbous).
  //   Larger value → larger shadow → less illumination (crescent).
  let shadowSide: "left" | "right";
  let shadowWidthFrac: number;
  let shadowOffsetFrac: number; // how far the shadow ellipse center sits from CX, as fraction of R
  switch (phase) {
    case "Waxing Crescent":
      shadowSide = "left";
      shadowWidthFrac = 0.85;
      shadowOffsetFrac = 0.35;
      break;
    case "Waning Crescent":
      shadowSide = "right";
      shadowWidthFrac = 0.85;
      shadowOffsetFrac = 0.35;
      break;
    case "Waxing Gibbous":
      shadowSide = "left";
      shadowWidthFrac = 0.55;
      shadowOffsetFrac = 0.85;
      break;
    case "Waning Gibbous":
      shadowSide = "right";
      shadowWidthFrac = 0.55;
      shadowOffsetFrac = 0.85;
      break;
    default:
      // Mask is only consulted for crescent/gibbous; default to "all visible".
      return (
        <mask id={maskId}>
          <rect x={0} y={0} width={VB} height={VB} fill="white" />
        </mask>
      );
  }
  const shadowCx =
    shadowSide === "left" ? CX - R * shadowOffsetFrac : CX + R * shadowOffsetFrac;
  const shadowRx = R * shadowWidthFrac;
  return (
    <mask id={maskId}>
      {/* Reveal the entire moon disc */}
      <circle cx={CX} cy={CY} r={R} fill="white" />
      {/* Subtract the dark side */}
      <ellipse cx={shadowCx} cy={CY} rx={shadowRx} ry={R} fill="black" />
    </mask>
  );
}
