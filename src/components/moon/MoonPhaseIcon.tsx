import { useEffect, useId, useRef } from "react";
import type { MoonPhaseName } from "@/lib/moon";
import { cn } from "@/lib/utils";

type Props = {
  phase: MoonPhaseName;
  size?: number;
  className?: string;
  ariaHidden?: boolean;
  /**
   * Illumination percentage (0–100). When provided, drives the terminator
   * width for crescent/gibbous phases so a 58%-lit moon and an 85%-lit moon
   * render visibly different shapes. When omitted, a canonical mid-phase
   * value is used (good for icons that represent the phase category itself,
   * like the ladder rungs).
   */
  illumination?: number;
  /**
   * Optional gold ring rendered INSIDE the SVG, touching the moon body.
   * Use this instead of a CSS border on the wrapper element — a CSS border
   * traces the SVG box edge, which leaves a visible halo gap because the
   * moon body only occupies the inner ~81% of the viewBox. Drawing the
   * ring inside the SVG makes it hug the moon at every rendered size.
   *
   * Pass `null` (default) for no ring; pass an rgba/hex string to enable.
   */
  ringColor?: string | null;
  /** Stroke width of the ring, in viewBox units (1 unit ≈ size/64 px). */
  ringWidth?: number;
};

const VB = 64;
// Moon body radius. Kept at 24 (was 26) so the optional gold ring drawn at
// R + ringWidth/2 plus the halo at R + 2 both sit comfortably inside the
// 64×64 viewBox without visually cropping the moon. Reverting this to 26
// makes ringed icons feel zoomed-in because the bright ring becomes the
// perceived edge of the icon and there's no breathing room to the box.
const R = 24;
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

export function MoonPhaseIcon({
  phase,
  size = 64,
  className,
  ariaHidden = true,
  illumination,
  ringColor = null,
  ringWidth = 1.5,
}: Props) {
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
      // Skip if any ancestor has display:none (e.g. mobile ladder on a
      // desktop viewport, or vice versa). A hidden subtree always measures
      // 0×0 and that's expected, not a clip bug.
      let node: Element | null = svg;
      while (node) {
        const cs = getComputedStyle(node);
        if (cs.display === "none" || cs.visibility === "hidden") return;
        node = node.parentElement;
      }
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
        {/* ER-4 — tightened halo: inner stop pushed to 78% and outer
            alpha reduced so the glow hugs the moon instead of bleeding
            into the day-label area below. */}
        <radialGradient id={`${id}-halo`} cx="50%" cy="50%" r="50%">
          <stop offset="78%" stopColor="rgba(212,175,55,0)" />
          <stop offset="100%" stopColor="rgba(212,175,55,0.10)" />
        </radialGradient>
        {/* Mask used for crescent/gibbous: white = visible pearl, black = hidden */}
        <PhaseMask phase={phase} maskId={`${id}-mask`} illumination={illumination} />
      </defs>
      <circle cx={CX} cy={CY} r={R + 2} fill={`url(#${id}-halo)`} />
      <circle cx={CX} cy={CY} r={R} fill={`url(#${bodyId})`} />
      <PhaseIllumination phase={phase} pearlId={pearlId} glowId={glowId} maskId={`${id}-mask`} />
      <circle cx={CX} cy={CY} r={R} fill="none" stroke="rgba(212,175,55,0.25)" strokeWidth={0.5} />
      {ringColor && (
        // Ring sits at exactly the moon body radius, offset outward by half
        // its stroke width so the inner edge of the ring kisses the body.
        <circle
          cx={CX}
          cy={CY}
          r={R + ringWidth / 2}
          fill="none"
          stroke={ringColor}
          strokeWidth={ringWidth}
        />
      )}
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
function PhaseMask({
  phase,
  maskId,
  illumination,
}: {
  phase: MoonPhaseName;
  maskId: string;
  illumination?: number;
}) {
  // The terminator (boundary between lit and dark) on a real moon is an
  // ellipse whose horizontal radius shrinks as the phase approaches full and
  // grows as it approaches new. We model the dark side as a half-disc (the
  // unlit hemisphere) UNIONED with an ellipse that either eats into the lit
  // side (crescent: terminator bulges toward the lit side, leaving a sliver)
  // or carves out of the dark side (gibbous: terminator bulges away from the
  // lit side, leaving only a sliver of dark).
  //
  // Implementation: paint the unlit hemisphere black, then paint a white or
  // black ellipse centered at CX to nudge the terminator. Width of that
  // ellipse encodes how far past center the terminator reaches.
  //
  // shadowSide = which hemisphere is unlit.
  // terminatorRx = horizontal radius of the terminator ellipse (fraction of R).
  //   For crescents: large value → terminator bulges into lit side → thin sliver lit.
  //   For gibbous:   large value → terminator bulges into dark side → thin sliver dark.
  // shadowSide = which hemisphere is unlit (the side opposite the lit limb).
  // kind = whether the terminator ellipse subtracts from lit (crescent) or
  //        adds to lit (gibbous).
  let shadowSide: "left" | "right";
  let kind: "crescent" | "gibbous";
  // Default illumination per phase if the caller didn't supply one. These
  // are mid-phase canonical values used by the ladder rung icons.
  let defaultIllum: number;
  switch (phase) {
    case "Waxing Crescent":
      shadowSide = "left";
      kind = "crescent";
      defaultIllum = 25;
      break;
    case "Waning Crescent":
      shadowSide = "right";
      kind = "crescent";
      defaultIllum = 25;
      break;
    case "Waxing Gibbous":
      shadowSide = "left";
      kind = "gibbous";
      defaultIllum = 75;
      break;
    case "Waning Gibbous":
      shadowSide = "right";
      kind = "gibbous";
      defaultIllum = 75;
      break;
    default:
      return (
        <mask id={maskId}>
          <rect x={0} y={0} width={VB} height={VB} fill="white" />
        </mask>
      );
  }
  // Real lunar terminator math: the projected terminator is an ellipse whose
  // horizontal radius is R × |2f − 1|, where f is the illuminated fraction.
  //   f = 0.5 → terminatorRx = 0 → exact half (quarter phase).
  //   f → 0 or 1 → terminatorRx → R → terminator hugs the limb.
  // Clamp f to (0.02, 0.98) so the mask never degenerates to an empty shape.
  const rawIllum = illumination != null && Number.isFinite(illumination) ? illumination : defaultIllum;
  const f = Math.min(0.98, Math.max(0.02, rawIllum / 100));
  const terminatorRx = R * Math.abs(2 * f - 1);
  // Half-rect covering the unlit hemisphere.
  const halfX = shadowSide === "left" ? CX - R : CX;
  const halfWidth = R;
  // For a crescent, the terminator ellipse is BLACK and overlaps onto the lit
  // side, shrinking the lit area to a sliver. For a gibbous, the terminator
  // ellipse is WHITE and overlaps onto the dark side, shrinking the dark
  // area to a sliver.
  const terminatorFill = kind === "crescent" ? "black" : "white";
  return (
    <mask id={maskId}>
      {/* Reveal the entire moon disc */}
      <circle cx={CX} cy={CY} r={R} fill="white" />
      {/* Paint the entire unlit hemisphere black. */}
      <rect x={halfX} y={CY - R} width={halfWidth} height={R * 2} fill="black" />
      {/* Nudge the terminator with an ellipse centered on the moon's center. */}
      <ellipse cx={CX} cy={CY} rx={terminatorRx} ry={R} fill={terminatorFill} />
    </mask>
  );
}
