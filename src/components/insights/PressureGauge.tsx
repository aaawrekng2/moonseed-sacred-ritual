/**
 * PressureGauge (v2.41)
 *
 * A pressure-dial view of the pattern engine's per-card comparison.
 * Needle = over-index (observed ÷ expected, capped at 5×). The "surprising"
 * upper band + needle light up in --gold ONLY when the engine's
 * Bonferroni-corrected `isStalker` is true — so the redline reflects real
 * statistical significance, not just needle position, and stays theme-safe
 * (no hardcoded alarm color).
 *
 * Reusable at three sizes: "lg" (Card Trace), "md" (Overview meters),
 * "sm" (hover popover). All values come in via the `comparison` prop —
 * pure presentational, no data fetching.
 */
import type { CardComparison } from "@/lib/pattern-engine";

type Size = "lg" | "md" | "sm";

const DIMS: Record<Size, { w: number; sw: number; big: number; label: number; sub: number }> = {
  lg: { w: 300, sw: 15, big: 40, label: 14, sub: 12 },
  md: { w: 200, sw: 11, big: 28, label: 12.5, sub: 11 },
  sm: { w: 140, sw: 8, big: 22, label: 11, sub: 10 },
};

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy - r * Math.sin(rad)];
}

function arc(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const [x1, y1] = polar(cx, cy, r, startDeg);
  const [x2, y2] = polar(cx, cy, r, endDeg);
  return `M${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 0 1 ${x2.toFixed(2)},${y2.toFixed(2)}`;
}

// over-index v -> needle angle. 0× = 180° (left), 5× = 0° (right).
function needleDeg(v: number): number {
  const clamped = Math.max(0, Math.min(5, v));
  return 180 - 36 * clamped;
}

function formatOneIn(oneInN: number): string {
  if (!Number.isFinite(oneInN) || oneInN > 1_000_000) return "~1 in 1,000,000+";
  if (oneInN < 1) return "common";
  return `~1 in ${Math.round(oneInN).toLocaleString()}`;
}

export function PressureGauge({
  comparison,
  size = "lg",
}: {
  comparison: CardComparison | null;
  size?: Size;
}) {
  if (!comparison) return null;

  const d = DIMS[size];
  const W = d.w;
  const sw = d.sw;
  const cx = W / 2;
  const R = W * 0.42;
  const cy = R + sw / 2 + 4;
  const H = cy + 8;
  const needleLen = R - sw / 2 - 2;
  const hubR = sw * 0.55;

  const gathering = comparison.status === "gathering";
  const isStalker = comparison.status === "ok" && comparison.isStalker;
  const overIndex = comparison.status === "ok" ? comparison.overIndex : 0;

  const track = "color-mix(in oklch, var(--color-foreground) 14%, transparent)";
  const buildingColor = "color-mix(in oklch, var(--accent) 55%, transparent)";
  const surprisingColor = isStalker
    ? "var(--gold)"
    : "color-mix(in oklch, var(--gold) 22%, transparent)";
  const needleColor = isStalker ? "var(--gold)" : "var(--color-foreground)";

  const [tipX, tipY] = polar(cx, cy, needleLen, needleDeg(overIndex));

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        role="img"
        aria-label={
          gathering
            ? "Pressure gauge — still gathering data"
            : `Pressure gauge — ${overIndex.toFixed(1)} times baseline${isStalker ? ", past the redline" : ""}`
        }
      >
        {/* base track */}
        <path d={arc(cx, cy, R, 180, 0)} fill="none" stroke={track} strokeWidth={sw} strokeLinecap="round" />
        {/* building band (1× → ~2.2×) */}
        <path d={arc(cx, cy, R, 144, 100.8)} fill="none" stroke={buildingColor} strokeWidth={sw} />
        {/* surprising band (~2.2× → 5×) — lit gold only when a true stalker */}
        <path
          d={arc(cx, cy, R, 100.8, 0)}
          fill="none"
          stroke={surprisingColor}
          strokeWidth={sw}
          strokeLinecap="round"
        />
        {!gathering && (
          <>
            <line
              x1={cx}
              y1={cy}
              x2={tipX.toFixed(2)}
              y2={tipY.toFixed(2)}
              stroke={needleColor}
              strokeWidth={Math.max(2, sw * 0.22)}
              strokeLinecap="round"
            />
            <circle
              cx={cx}
              cy={cy}
              r={hubR}
              fill="var(--surface-card)"
              stroke="var(--gold)"
              strokeWidth={Math.max(2, sw * 0.18)}
            />
          </>
        )}
      </svg>

      {gathering ? (
        <div
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: d.sub,
            color: "var(--color-foreground-muted)",
            marginTop: 6,
            textAlign: "center",
          }}
        >
          Still gathering — {comparison.totalSlots} of {comparison.needed} draws
        </div>
      ) : comparison.status === "ok" ? (
        <div style={{ textAlign: "center", marginTop: -2 }}>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: d.big,
              color: "var(--gold)",
              lineHeight: 1,
            }}
          >
            {overIndex.toFixed(1)}&times;
          </div>
          <div
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: d.label,
              color: "var(--color-foreground)",
              marginTop: 4,
            }}
          >
            drawn {comparison.observed}&times; &middot; expected ~{comparison.expected.toFixed(1)}&times;
          </div>
          <div
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: d.sub,
              marginTop: 5,
              color: isStalker ? "var(--gold)" : "var(--color-foreground-muted)",
            }}
          >
            {isStalker && comparison.best
              ? `past the redline · ${formatOneIn(comparison.best.oneInN)}`
              : `within normal range · #${comparison.rank} of ${comparison.deckSize}`}
          </div>
        </div>
      ) : null}
    </div>
  );
}
