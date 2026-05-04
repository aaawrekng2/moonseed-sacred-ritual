import type { CardBackId } from "@/lib/card-backs";
import { cn } from "@/lib/utils";
import { cornerRadiusStyle } from "@/lib/active-deck";

/**
 * Card-back palette.
 *
 * Per design ("The Thread"), every card back's *color* is driven by the
 * current accent (`--gold`) so swapping a sanctuary repaints all backs
 * to match. Only the *artwork pattern* (Celestial / Void / Ember /
 * Ocean / Verdant) is chosen by the user. We expose the accent via
 * `color-mix` expressions so each back keeps its visual hierarchy
 * (primary line, soft fill, dim ornament) regardless of which accent
 * the active sanctuary applies.
 */
const ACCENT = {
  /** Primary accent — most opaque ornament strokes / dots. */
  primary: "color-mix(in oklch, var(--gold) 92%, transparent)",
  /** Slightly softened primary for secondary strokes. */
  strong: "color-mix(in oklch, var(--gold) 75%, transparent)",
  /** Detail / pattern lines. */
  pattern: "color-mix(in oklch, var(--gold) 60%, transparent)",
  /** Ornament strokes. */
  ornament: "color-mix(in oklch, var(--gold) 45%, transparent)",
  /** Soft halo / glow. */
  glow: "color-mix(in oklch, var(--gold) 30%, transparent)",
  /** Faint background tint. */
  faint: "color-mix(in oklch, var(--gold) 18%, transparent)",
  /** Border color. */
  border: "color-mix(in oklch, var(--gold) 50%, transparent)",
  /** Inner ring outer (brighter). */
  innerOuter: "color-mix(in oklch, var(--gold) 45%, transparent)",
  /** Inner ring inner (dimmer). */
  innerInner: "color-mix(in oklch, var(--gold) 22%, transparent)",
};

/** Background gradient anchored on the accent + a deep tint of it. */
const ACCENT_BG =
  "radial-gradient(ellipse at 45% 28%, " +
  "color-mix(in oklch, var(--gold) 30%, oklch(0.14 0.04 280)) 0%, " +
  "color-mix(in oklch, var(--gold) 18%, oklch(0.10 0.03 280)) 55%, " +
  "color-mix(in oklch, var(--gold) 8%, oklch(0.06 0.02 280)) 100%)";

interface Props {
  id?: CardBackId;
  /**
   * BX — when set, render this image as the card back (used by the
   * active custom deck). Falls through to the procedural preset when
   * null/undefined.
   */
  imageUrl?: string | null;
  width?: number;
  className?: string;
  ariaLabel?: string;
  /**
   * When true, render the outer card border in a faint neutral white
   * instead of the accent/signature color. Used by the Themes "Veil"
   * picker so thumbnails don't glow with the active theme color.
   */
  neutralBorder?: boolean;
  /**
   * EE-6 — Per-deck saved corner radius (percentage 0–15). When set,
   * overrides the procedural `m.radius` so the card back matches the
   * face cards' radius (Home gateway, slot rail).
   */
  cornerRadiusPercent?: number | null;
}

const RATIO = 1.75;

// Scale helpers — keep card-back ornaments proportional at any size so the
// design doesn't look chunky on small (~42px) cards or thin on big ones.
function scaleMetrics(width: number) {
  return {
    border: Math.max(0.5, width * 0.015),
    innerInset: Math.max(2, width * 0.08),
    cornerSize: Math.max(6, width * 0.18),
    starDot: Math.max(1, width * 0.025),
    radius: Math.max(3, width * 0.06),
  };
}

function Stars({
  dots,
  defaultColor,
}: {
  dots: { x: number; y: number; r: number; o: number; c?: string }[];
  defaultColor?: string;
}) {
  return (
    <>
      {dots.map((d, i) => (
        <circle
          key={i}
          cx={d.x}
          cy={d.y}
          r={d.r}
          fill={d.c ?? defaultColor ?? ACCENT.primary}
          opacity={d.o}
        />
      ))}
    </>
  );
}

function Corners({ color, dotColor }: { color: string; dotColor: string }) {
  // Four L-shaped corner ornaments inside an 80x80 viewBox container.
  const arms = [
    { x: 6, y: 6, h: [6, 18, 6, 6], v: [6, 6, 6, 18], dx: 6, dy: 6 },
    { x: 74, y: 6, h: [62, 74, 74, 74], v: [74, 6, 74, 18], dx: 74, dy: 6 },
    { x: 6, y: 74, h: [6, 74, 18, 74], v: [6, 62, 6, 74], dx: 6, dy: 74 },
    { x: 74, y: 74, h: [62, 74, 74, 74], v: [74, 62, 74, 74], dx: 74, dy: 74 },
  ];
  return (
    <>
      {arms.map((a, i) => (
        <g key={i} stroke={color} strokeWidth="0.7" fill="none">
          <line x1={a.h[0]} y1={a.h[1]} x2={a.h[2]} y2={a.h[3]} />
          <line x1={a.v[0]} y1={a.v[1]} x2={a.v[2]} y2={a.v[3]} />
          <circle cx={a.dx} cy={a.dy} r="0.9" fill={dotColor} stroke="none" />
        </g>
      ))}
    </>
  );
}

/**
 * Celestial back — luminosity pass.
 * Stars are absolutely positioned in CSS pixels (assumes width=180).
 * SVG motif fills the card and contains crescent + rings + cardinal accents.
 */
function CelestialBack({ width }: { width: number }) {
  // Star coordinates given for a 180px wide card. Scale proportionally.
  const scale = width / 180;
  const STARS: { size: number; top: number; left: number; opacity: number }[] = [
    { size: 2.5, top: 26, left: 20, opacity: 0.95 },
    { size: 2, top: 38, left: 72, opacity: 0.8 },
    { size: 1.5, top: 52, left: 32, opacity: 0.6 },
    { size: 2.5, top: 20, left: 82, opacity: 0.9 },
    { size: 1.5, top: 148, left: 22, opacity: 0.7 },
    { size: 2, top: 158, left: 80, opacity: 0.8 },
    { size: 1, top: 135, left: 55, opacity: 0.5 },
    { size: 1.5, top: 65, left: 88, opacity: 0.55 },
  ];
  return (
    <>
      {/* Soft inner radial glow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(ellipse at 50% 45%, ${ACCENT.faint}, transparent 60%)`,
        }}
      />
      {/* Double inner border */}
      <div
        className="pointer-events-none absolute"
        style={{
          inset: 8,
          borderRadius: 6,
          border: `1px solid ${ACCENT.innerOuter}`,
        }}
      />
      <div
        className="pointer-events-none absolute"
        style={{
          inset: 14,
          borderRadius: 4,
          border: `1px solid ${ACCENT.innerInner}`,
        }}
      />
      {/* Stars */}
      {STARS.map((s, i) => (
        <span
          key={i}
          className="pointer-events-none absolute rounded-full"
          style={{
            top: s.top * scale,
            left: s.left * scale,
            width: s.size * scale,
            height: s.size * scale,
            opacity: s.opacity,
            background: ACCENT.primary,
            boxShadow: `0 0 ${s.size * 2 * scale}px ${ACCENT.glow}`,
          }}
        />
      ))}
      {/* Central motif */}
      <svg
        viewBox="0 0 74 74"
        preserveAspectRatio="xMidYMid meet"
        className="pointer-events-none absolute left-1/2 top-1/2 h-[44%] w-[44%] -translate-x-1/2 -translate-y-1/2"
      >
        <g transform="translate(37 37)" fill="none">
          {/* concentric rings */}
          <circle r="22" stroke={ACCENT.glow} strokeWidth="0.8" />
          <circle r="16" stroke={ACCENT.ornament} strokeWidth="0.8" />
          {/* crescent moon */}
          <path
            d="M -4 -9 A 10 10 0 1 0 -4 9 A 7.5 7.5 0 1 1 -4 -9 Z"
            fill={ACCENT.primary}
            stroke={ACCENT.primary}
            strokeWidth="0.6"
          />
          {/* cardinal tick lines */}
          <line x1="0" y1="-22" x2="0" y2="-19" stroke={ACCENT.strong} strokeWidth="0.8" />
          <line x1="0" y1="19" x2="0" y2="22" stroke={ACCENT.strong} strokeWidth="0.8" />
          <line x1="-22" y1="0" x2="-19" y2="0" stroke={ACCENT.strong} strokeWidth="0.8" />
          <line x1="19" y1="0" x2="22" y2="0" stroke={ACCENT.strong} strokeWidth="0.8" />
          {/* cardinal dot accents */}
          <circle cx="0" cy="-22" r="1.4" fill={ACCENT.strong} />
          <circle cx="0" cy="22" r="1.4" fill={ACCENT.strong} />
          <circle cx="-22" cy="0" r="1.4" fill={ACCENT.strong} />
          <circle cx="22" cy="0" r="1.4" fill={ACCENT.strong} />
        </g>
      </svg>
      {/* Corner ornaments */}
      <svg
        viewBox="0 0 80 80"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 h-full w-full"
      >
        <g stroke={ACCENT.strong} strokeWidth="0.8" fill="none">
          {/* top-left */}
          <line x1="6" y1="6" x2="14" y2="6" />
          <line x1="6" y1="6" x2="6" y2="14" />
          <circle cx="6" cy="6" r="1.2" fill={ACCENT.primary} stroke="none" />
          {/* top-right */}
          <line x1="74" y1="6" x2="66" y2="6" />
          <line x1="74" y1="6" x2="74" y2="14" />
          <circle cx="74" cy="6" r="1.2" fill={ACCENT.primary} stroke="none" />
          {/* bottom-left */}
          <line x1="6" y1="74" x2="14" y2="74" />
          <line x1="6" y1="74" x2="6" y2="66" />
          <circle cx="6" cy="74" r="1.2" fill={ACCENT.primary} stroke="none" />
          {/* bottom-right */}
          <line x1="74" y1="74" x2="66" y2="74" />
          <line x1="74" y1="74" x2="74" y2="66" />
          <circle cx="74" cy="74" r="1.2" fill={ACCENT.primary} stroke="none" />
        </g>
      </svg>
    </>
  );
}

function VoidBack() {
  const stars = [
    { x: 14, y: 14, r: 1.5, o: 0.95 },
    { x: 66, y: 16, r: 1.2, o: 0.85 },
    { x: 22, y: 60, r: 1.4, o: 0.9 },
    { x: 60, y: 64, r: 1.3, o: 0.85 },
    { x: 8, y: 38, r: 1, o: 0.75 },
    { x: 72, y: 44, r: 1, o: 0.75 },
    { x: 40, y: 8, r: 0.9, o: 0.7 },
    { x: 40, y: 74, r: 0.9, o: 0.7 },
  ];
  return (
    <svg viewBox="0 0 80 80" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
      <Stars dots={stars} defaultColor={ACCENT.primary} />
      <g transform="translate(40 40)" stroke={ACCENT.ornament} strokeWidth="0.5" fill="none">
        <circle r="14" opacity="0.7" />
        <circle r="10" opacity="0.6" />
        <circle r="6" opacity="0.5" />
        <line x1="-14" y1="0" x2="14" y2="0" />
        <line x1="0" y1="-14" x2="0" y2="14" />
        <line x1="-10" y1="-10" x2="10" y2="10" opacity="0.5" />
        <line x1="-10" y1="10" x2="10" y2="-10" opacity="0.5" />
        <circle cx="0" cy="-14" r="0.9" fill={ACCENT.strong} stroke="none" />
        <circle cx="0" cy="14" r="0.9" fill={ACCENT.strong} stroke="none" />
        <circle cx="-14" cy="0" r="0.9" fill={ACCENT.strong} stroke="none" />
        <circle cx="14" cy="0" r="0.9" fill={ACCENT.strong} stroke="none" />
        <circle cx="0" cy="0" r="1.1" fill={ACCENT.primary} stroke="none" />
      </g>
      <Corners color={ACCENT.ornament} dotColor={ACCENT.strong} />
    </svg>
  );
}

function EmberBack() {
  const stars = [
    { x: 16, y: 12, r: 1.2, o: 0.9 },
    { x: 64, y: 18, r: 1, o: 0.75 },
    { x: 12, y: 64, r: 1.3, o: 0.85 },
    { x: 70, y: 60, r: 1.1, o: 0.8 },
    { x: 40, y: 8, r: 0.9, o: 0.7 },
  ];
  return (
    <svg viewBox="0 0 80 80" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
      <Stars dots={stars} defaultColor={ACCENT.primary} />
      <g transform="translate(40 42)" stroke={ACCENT.strong} strokeWidth="0.6" fill="none">
        <polygon points="0,-14 12,8 -12,8" />
        <polygon points="0,-10 8.5,5.5 -8.5,5.5" opacity="0.85" />
        <polygon points="0,-6 5,3.5 -5,3.5" opacity="0.7" />
        <circle r="2" />
        <circle r="0.8" fill={ACCENT.primary} stroke="none" />
        {/* vertex accents */}
        <circle cx="0" cy="-14" r="0.9" fill={ACCENT.primary} stroke="none" />
        <circle cx="12" cy="8" r="0.9" fill={ACCENT.strong} stroke="none" />
        <circle cx="-12" cy="8" r="0.9" fill={ACCENT.strong} stroke="none" />
      </g>
      <Corners color={ACCENT.strong} dotColor={ACCENT.primary} />
    </svg>
  );
}

function OceanBack() {
  const stars = [
    { x: 14, y: 12, r: 1.4, o: 0.9 },
    { x: 66, y: 16, r: 1, o: 0.75 },
    { x: 12, y: 60, r: 1.2, o: 0.8 },
    { x: 70, y: 64, r: 1.6, o: 0.95 },
    { x: 40, y: 6, r: 0.9, o: 0.7 },
    { x: 8, y: 36, r: 0.9, o: 0.7 },
    { x: 72, y: 40, r: 0.9, o: 0.7 },
  ];
  return (
    <svg viewBox="0 0 80 80" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
      <Stars dots={stars} defaultColor={ACCENT.primary} />
      <g transform="translate(40 42)" fill="none">
        <circle r="14" stroke={ACCENT.ornament} strokeWidth="0.5" />
        <path
          d="M -12 0 Q -6 -5 0 0 T 12 0"
          stroke={ACCENT.strong}
          strokeWidth="0.9"
        />
        <path
          d="M -12 0 Q -6 5 0 0 T 12 0"
          stroke={ACCENT.strong}
          strokeWidth="0.9"
        />
        <path
          d="M -10 -5 Q -5 -8 0 -5 T 10 -5"
          stroke={ACCENT.ornament}
          strokeWidth="0.6"
        />
        <path
          d="M -10 5 Q -5 8 0 5 T 10 5"
          stroke={ACCENT.ornament}
          strokeWidth="0.6"
        />
        <circle r="1.5" stroke={ACCENT.primary} strokeWidth="0.4" />
        <circle r="0.6" fill={ACCENT.primary} />
      </g>
      <Corners color={ACCENT.strong} dotColor={ACCENT.primary} />
    </svg>
  );
}

function VerdantBack() {
  const stars = [
    { x: 14, y: 12, r: 1.3, o: 0.85 },
    { x: 66, y: 16, r: 1, o: 0.7 },
    { x: 12, y: 60, r: 1.5, o: 0.95 },
    { x: 70, y: 64, r: 1.1, o: 0.8 },
    { x: 40, y: 6, r: 0.9, o: 0.7 },
    { x: 8, y: 38, r: 0.9, o: 0.7 },
  ];
  return (
    <svg viewBox="0 0 80 80" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
      <Stars dots={stars} defaultColor={ACCENT.primary} />
      <g transform="translate(40 42)" fill="none">
        {/* teardrop right (bold) */}
        <path
          d="M 0 -14 C 8 -8 8 8 0 14 C 0 8 0 -8 0 -14 Z"
          fill={ACCENT.ornament}
          stroke={ACCENT.primary}
          strokeWidth="0.6"
        />
        {/* teardrop left (lighter) */}
        <path
          d="M 0 -14 C -8 -8 -8 8 0 14 C 0 8 0 -8 0 -14 Z"
          fill={ACCENT.faint}
          stroke={ACCENT.strong}
          strokeWidth="0.5"
        />
        {/* echo arcs */}
        <path d="M -12 0 Q 0 -3 12 0" stroke={ACCENT.ornament} strokeWidth="0.5" />
        <path d="M -12 0 Q 0 3 12 0" stroke={ACCENT.ornament} strokeWidth="0.5" />
        <circle r="1.4" stroke={ACCENT.primary} strokeWidth="0.4" />
        <circle r="0.6" fill={ACCENT.primary} />
        <circle cx="0" cy="-14" r="0.9" fill={ACCENT.primary} />
      </g>
      <Corners color={ACCENT.strong} dotColor={ACCENT.primary} />
    </svg>
  );
}

/**
 * All five card backs share the same accent-driven palette ("The
 * Thread"). The artwork pattern (Celestial / Void / Ember / Ocean /
 * Verdant) is what differs — the colors all flow from `--gold`.
 */
const SHARED_STYLE = {
  bg: ACCENT_BG,
  borderColor: ACCENT.border,
  innerOuter: ACCENT.innerOuter,
  innerInner: ACCENT.innerInner,
};
const STYLES: Record<
  CardBackId,
  { bg: string; borderColor: string; innerOuter: string; innerInner: string }
> = {
  celestial: SHARED_STYLE,
  void: SHARED_STYLE,
  ember: SHARED_STYLE,
  ocean: SHARED_STYLE,
  verdant: SHARED_STYLE,
};

export function CardBack({ id = "celestial", imageUrl, width = 160, className, ariaLabel, neutralBorder, cornerRadiusPercent }: Props) {
  const height = Math.round(width * RATIO);
  const style = STYLES[id];
  const m = scaleMetrics(width);
  const radiusOverride = cornerRadiusStyle(cornerRadiusPercent ?? null, width);
  const effectiveRadius =
    radiusOverride.borderRadius ?? `${m.radius}px`;
  // BX — custom deck back overrides the procedural artwork.
  if (imageUrl) {
    return (
      <div
        role="img"
        aria-label={ariaLabel ?? "Tarot card back"}
        className={cn("relative overflow-hidden", className)}
        style={{
          width,
          // FB-2 — no hardcoded height; IMG below defines its own
          // height from natural aspect, matching the EY-2 face fix.
          borderRadius: effectiveRadius,
          background: "var(--surface-card)",
          // FB-2 — no outer border. The scanned card art is its own
          // visual edge; the rounded clip handles the corners.
        }}
      >
        <img
          src={imageUrl}
          alt={ariaLabel ?? "Card back"}
          // FB-2 — width 100% / height auto so the back renders at
          // its natural aspect; no cropping, no letterboxing.
          style={{ width: "100%", height: "auto", display: "block" }}
          draggable={false}
        />
      </div>
    );
  }
  const outerBorderColor = neutralBorder
    ? "oklch(1 0 0 / 0.10)"
    : style.borderColor;
  const innerShadow = neutralBorder
    ? `inset 0 0 0 ${m.innerInset}px oklch(1 0 0 / 0.08), inset 0 0 0 ${Math.round(m.innerInset * 1.7)}px oklch(1 0 0 / 0.05)`
    : `inset 0 0 0 ${m.innerInset}px ${style.innerOuter}, inset 0 0 0 ${Math.round(m.innerInset * 1.7)}px ${style.innerInner}`;
  return (
    <div
      role="img"
      aria-label={ariaLabel ?? "Tarot card back"}
      className={cn("relative overflow-hidden", className)}
      style={{
        width,
        height,
        borderRadius: effectiveRadius,
        background: style.bg,
        border: `${m.border}px solid ${outerBorderColor}`,
        // Inner double-ring scales with card size for a proportional look.
        // When `neutralBorder` is set (e.g. theme picker thumbnails), use a
        // faint white inset so the preview never glows the active accent.
        boxShadow: innerShadow,
      }}
    >
      {id === "celestial" && <CelestialBack width={width} />}
      {id === "void" && <VoidBack />}
      {id === "ember" && <EmberBack />}
      {id === "ocean" && <OceanBack />}
      {id === "verdant" && <VerdantBack />}
    </div>
  );
}