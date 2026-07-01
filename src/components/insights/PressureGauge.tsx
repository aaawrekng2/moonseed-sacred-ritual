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
import { useState } from "react";

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
  const [helpOpen, setHelpOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const helpVisible = helpOpen || hover;

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

      {comparison.status === "ok" && size !== "sm" && (
        <div
          style={{ marginTop: 8, width: "100%", maxWidth: W }}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
        >
          <button
            type="button"
            onClick={() => setHelpOpen((o) => !o)}
            aria-expanded={helpVisible}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              margin: "0 auto",
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: d.sub,
              color: "var(--gold)",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "2px 6px",
            }}
          >
            <span
              aria-hidden
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 15,
                height: 15,
                borderRadius: "50%",
                border: "1px solid var(--gold)",
                fontStyle: "normal",
                fontSize: 10,
                lineHeight: 1,
              }}
            >
              ?
            </span>
            what this means
          </button>

          {helpVisible && (
            <div
              style={{
                marginTop: 8,
                textAlign: "left",
                background: "var(--surface-card)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-md, 10px)",
                padding: "12px 14px",
              }}
            >
              {(() => {
                const c = comparison;
                if (c.status !== "ok") return null;
                const rows: Array<[string, string, string]> = [
                  [
                    "var(--gold)",
                    "The needle",
                    "how hard this card outruns chance. Dead left is exactly as often as a random deck would deal it; the further right, the more it's seeking you out.",
                  ],
                  [
                    "var(--color-foreground)",
                    `Drawn ${c.observed}\u00d7 \u00b7 expected ~${c.expected.toFixed(1)}\u00d7`,
                    "your real pulls versus what pure luck would land across the same number of draws.",
                  ],
                ];
                if (isStalker) {
                  rows.push([
                    "var(--gold)",
                    "The gold redline",
                    "once the needle crosses into gold, the gap is too large for chance to explain \u2014 the card is genuinely following you.",
                  ]);
                }
                if (isStalker && c.best) {
                  rows.push([
                    "color-mix(in oklch, var(--color-foreground) 55%, transparent)",
                    formatOneIn(c.best.oneInN),
                    "the odds of this much repetition by luck alone. The rarer it is, the more the pattern means.",
                  ]);
                }
                rows.push([
                  "var(--accent)",
                  `#${c.rank} of ${c.deckSize}`,
                  "where it ranks against every card by over-presence. Separate from the needle \u2014 that's this card vs. chance; this is this card vs. the rest of the deck.",
                ]);
                return (
                  <>
                    {rows.map(([sw, lab, rest], i) => (
                      <div key={i} style={{ display: "flex", gap: 9, marginBottom: 9 }}>
                        <span
                          style={{
                            flex: "0 0 9px",
                            width: 9,
                            height: 9,
                            borderRadius: 3,
                            background: sw,
                            marginTop: 6,
                          }}
                        />
                        <div
                          style={{
                            fontFamily: "var(--font-serif)",
                            fontSize: d.label,
                            lineHeight: 1.45,
                          }}
                        >
                          <span style={{ fontStyle: "italic", color: "var(--color-foreground)" }}>
                            {lab}
                          </span>
                          {" \u2014 "}
                          <span style={{ color: "var(--color-foreground-muted)" }}>{rest}</span>
                        </div>
                      </div>
                    ))}
                    <div
                      style={{
                        fontFamily: "var(--font-serif)",
                        fontStyle: "italic",
                        fontSize: d.sub,
                        color: "var(--color-foreground-muted)",
                        lineHeight: 1.5,
                        marginTop: 2,
                      }}
                    >
                      {c.kind === "acute"
                        ? "Acute \u2014 a recent burst; it's been close lately. "
                        : c.kind === "chronic"
                        ? "Chronic \u2014 a slow, steady over-presence across your whole history. "
                        : ""}
                      Below 60 draws the gauge stays quiet, until a pattern can be told from coincidence.
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
