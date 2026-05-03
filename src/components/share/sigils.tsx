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
      <circle cx={0} cy={0} r={30} />
      <circle cx={0} cy={0} r={5} fill={c} stroke="none" />
    </SigilSvg>
  );
}

export function Level2Sigil(props: SigilProps) {
  const c = props.color ?? "var(--accent)";
  return (
    <SigilSvg {...props}>
      <circle cx={0} cy={0} r={30} />
      <circle cx={-14} cy={0} r={3.5} fill={c} stroke="none" />
      <circle cx={0} cy={0} r={3.5} fill={c} stroke="none" />
      <circle cx={14} cy={0} r={3.5} fill={c} stroke="none" />
    </SigilSvg>
  );
}

export function Level3Sigil(props: SigilProps) {
  const c = props.color ?? "var(--accent)";
  return (
    <SigilSvg {...props}>
      <circle cx={0} cy={0} r={26} />
      <circle cx={0} cy={0} r={5} fill={c} stroke="none" />
      <line x1={26} y1={0} x2={40} y2={0} />
    </SigilSvg>
  );
}

export function Level4Sigil(props: SigilProps) {
  const c = props.color ?? "var(--accent)";
  return (
    <SigilSvg {...props}>
      <circle cx={0} cy={0} r={30} />
      <circle cx={0} cy={0} r={16} />
      <circle cx={0} cy={0} r={4.5} fill={c} stroke="none" />
    </SigilSvg>
  );
}

export function Level5Sigil(props: SigilProps) {
  const c = props.color ?? "var(--accent)";
  // Eight-point star: alternate long (24) and short (12) radii at 22.5° steps.
  const pts: string[] = [];
  for (let i = 0; i < 16; i += 1) {
    const r = i % 2 === 0 ? 24 : 12;
    const a = (i * Math.PI) / 8 - Math.PI / 2;
    pts.push(`${(Math.cos(a) * r).toFixed(2)},${(Math.sin(a) * r).toFixed(2)}`);
  }
  return (
    <SigilSvg {...props}>
      <circle cx={0} cy={0} r={32} />
      <polygon points={pts.join(" ")} />
      <circle cx={0} cy={0} r={3.5} fill={c} stroke="none" />
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