/**
 * DR — Iconographic level marks for the share canvas.
 *
 * Each sigil is a small line-art SVG rendered top-left on the share
 * canvas. Stroke colour defaults to `var(--accent)` so the marks
 * inherit whichever theme is active. The MoonseedMark component is
 * the matching upper-right wordmark (crescent + "moonseed").
 */
import type { ReactElement } from "react";
import type { ShareLevel } from "./share-types";

type SigilProps = { size?: number; color?: string };

/**
 * DS — Sigil with accent-colored glow halo behind it. The halo is a
 * blurred radial gradient sized ~30-40px larger than the sigil on
 * each side. Reads as a wax seal / pressed emblem.
 */
export function SigilWithGlow({
  Sigil,
  size = 128,
}: {
  Sigil: (p: SigilProps) => ReactElement;
  size?: number;
}) {
  const halo = size + 64;
  return (
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
        display: "inline-block",
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: (size - halo) / 2,
          top: (size - halo) / 2,
          width: halo,
          height: halo,
          background:
            "radial-gradient(circle, var(--accent-glow, var(--accent)) 0%, transparent 70%)",
          filter: "blur(16px)",
          opacity: 0.6,
          pointerEvents: "none",
        }}
      />
      <div style={{ position: "relative" }}>
        <Sigil size={size} />
      </div>
    </div>
  );
}

function SigilSvg({
  size = 64,
  color = "var(--accent)",
  children,
}: SigilProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="-32 -32 64 64"
      fill="none"
      stroke={color}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

export function Level1Sigil(props: SigilProps) {
  const c = props.color ?? "var(--accent)";
  return (
    <SigilSvg {...props}>
      {/* The Vessel — downward triangle (water/receptivity) with a
          horizontal mid-line and a single dot inside. Reads as
          "a single moment, received." */}
      <polygon points="-22,-18 22,-18 0,22" />
      <line x1={-14} y1={-2} x2={14} y2={-2} />
      <circle cx={0} cy={8} r={3} fill={c} stroke="none" />
    </SigilSvg>
  );
}

export function Level2Sigil(props: SigilProps) {
  const c = props.color ?? "var(--accent)";
  return (
    <SigilSvg {...props}>
      {/* The Wheel — outer ring with three radial spokes at 12/4/8
          o'clock, terminating in tick marks; small inner circle at
          the hub. Geometric, never reads as a kebab menu. */}
      <circle cx={0} cy={0} r={28} />
      <circle cx={0} cy={0} r={6} />
      {[0, 1, 2].map((i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
        const x1 = Math.cos(a) * 6;
        const y1 = Math.sin(a) * 6;
        const x2 = Math.cos(a) * 28;
        const y2 = Math.sin(a) * 28;
        const tx = Math.cos(a) * 32 - Math.sin(a) * 4;
        const ty = Math.sin(a) * 32 + Math.cos(a) * 4;
        const tx2 = Math.cos(a) * 32 + Math.sin(a) * 4;
        const ty2 = Math.sin(a) * 32 - Math.cos(a) * 4;
        return (
          <g key={i}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} />
            <line x1={tx} y1={ty} x2={tx2} y2={ty2} />
          </g>
        );
      })}
      <circle cx={0} cy={0} r={2} fill={c} stroke="none" />
    </SigilSvg>
  );
}

export function Level3Sigil(props: SigilProps) {
  const c = props.color ?? "var(--accent)";
  return (
    <SigilSvg {...props}>
      {/* The Compass — circle with a single arrow extending from the
          center outward at the top-right diagonal. A small filled dot
          opposite the arrow anchors the origin. */}
      <circle cx={0} cy={0} r={28} />
      <line x1={0} y1={0} x2={20} y2={-20} />
      <polyline points="14,-22 22,-22 22,-14" />
      <circle cx={-14} cy={14} r={3} fill={c} stroke="none" />
    </SigilSvg>
  );
}

export function Level4Sigil(props: SigilProps) {
  const c = props.color ?? "var(--accent)";
  return (
    <SigilSvg {...props}>
      {/* The Eye — vesica almond (wider than tall) with a smaller
          circle and a focused pupil dot inside. Short rays at top
          and bottom suggest attention. */}
      <path d="M -30 0 Q 0 -18 30 0 Q 0 18 -30 0 Z" />
      <circle cx={0} cy={0} r={10} />
      <circle cx={0} cy={0} r={3} fill={c} stroke="none" />
      <line x1={0} y1={-18} x2={0} y2={-26} />
      <line x1={0} y1={18} x2={0} y2={26} />
      <line x1={-12} y1={-13} x2={-16} y2={-19} />
      <line x1={12} y1={-13} x2={16} y2={-19} />
      <line x1={-12} y1={13} x2={-16} y2={19} />
      <line x1={12} y1={13} x2={16} y2={19} />
    </SigilSvg>
  );
}

export function Level5Sigil(props: SigilProps) {
  const c = props.color ?? "var(--accent)";
  // The Sigil Crown — outer ring binding everything; a halo of evenly-
  // spaced dots forming the crown; an inner circle holding a solid
  // upward-pointing triangle (alchemical fire/spirit). Most ornate
  // of the five.
  const dotCount = 12;
  const haloR = 22;
  const dots: { x: number; y: number }[] = [];
  for (let i = 0; i < dotCount; i += 1) {
    const a = (i * 2 * Math.PI) / dotCount - Math.PI / 2;
    dots.push({ x: Math.cos(a) * haloR, y: Math.sin(a) * haloR });
  }
  return (
    <SigilSvg {...props}>
      <circle cx={0} cy={0} r={30} />
      <circle cx={0} cy={0} r={14} />
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={1.6} fill={c} stroke="none" />
      ))}
      <polygon points="0,-9 8,6 -8,6" fill={c} stroke="none" />
    </SigilSvg>
  );
}

export function getSigilForLevel(
  level: ShareLevel,
): (props: SigilProps) => ReactElement {
  switch (level) {
    case "pull":
      return Level1Sigil;
    case "reading":
      return Level2Sigil;
    case "position":
      return Level3Sigil;
    case "lens":
      return Level4Sigil;
    case "artifact":
      return Level5Sigil;
    default:
      return Level2Sigil;
  }
}

/**
 * Upper-right wordmark — crescent glyph + "moonseed" in serif italic.
 * Mirrors the level sigil in the opposite corner.
 */
export function MoonseedMark({
  color = "var(--accent)",
}: {
  color?: string;
}) {
  return (
    <div
      aria-hidden
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        color,
        opacity: 0.7,
      }}
    >
      <span
        style={{
          fontSize: 28,
          lineHeight: 1,
          fontFamily: "ui-serif, Georgia, serif",
        }}
      >
        ☽
      </span>
      <span
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: 22,
          letterSpacing: "0.04em",
        }}
      >
        moonseed
      </span>
    </div>
  );
}