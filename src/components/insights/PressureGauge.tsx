/**
 * PressureGauge (v2.46)
 *
 * A filled pressure-dial view of the pattern engine's per-card comparison.
 * Needle = over-index (observed ÷ expected, capped at 5×). The alert (redline)
 * zone + needle light up in --gauge-alert ONLY when the engine's Bonferroni-
 * corrected `isStalker` is true — so the redline reflects real statistical
 * significance, not just needle position.
 *
 * The dial uses its OWN palette (--gauge-track / --gauge-mid / --gauge-alert /
 * --gauge-stroke) so it stays distinct from the gold / accent / teal the
 * Patterns surface owns, wherever the gauge appears.
 *
 * Reusable at three sizes: "lg" (Card Trace), "md" (Overview meters), "sm".
 * When `cardId` is provided, the card image renders behind the dial with the
 * dial bottom-aligned to the card's edge (Overview meter composition); the
 * whole card becomes the tap target via `onCardClick`. Pure presentational.
 */
import type { CardComparison } from "@/lib/pattern-engine";
import { CardImage } from "@/components/card/CardImage";
import { useState } from "react";

type Size = "lg" | "md" | "sm";

const DIMS: Record<Size, { w: number; big: number; label: number; sub: number }> = {
  lg: { w: 300, big: 40, label: 14, sub: 12 },
  md: { w: 200, big: 28, label: 12.5, sub: 11 },
  sm: { w: 140, big: 22, label: 11, sub: 10 },
};

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy - r * Math.sin(rad)];
}

// Filled annular sector over the top of the dial, from startDeg down to endDeg
// (startDeg > endDeg). Outer arc clockwise, inner arc back counter-clockwise.
function sector(
  cx: number,
  cy: number,
  ro: number,
  ri: number,
  startDeg: number,
  endDeg: number,
): string {
  const [ox1, oy1] = polar(cx, cy, ro, startDeg);
  const [ox2, oy2] = polar(cx, cy, ro, endDeg);
  const [ix2, iy2] = polar(cx, cy, ri, endDeg);
  const [ix1, iy1] = polar(cx, cy, ri, startDeg);
  return (
    `M${ox1.toFixed(2)},${oy1.toFixed(2)} ` +
    `A${ro.toFixed(2)},${ro.toFixed(2)} 0 0 1 ${ox2.toFixed(2)},${oy2.toFixed(2)} ` +
    `L${ix2.toFixed(2)},${iy2.toFixed(2)} ` +
    `A${ri.toFixed(2)},${ri.toFixed(2)} 0 0 0 ${ix1.toFixed(2)},${iy1.toFixed(2)} Z`
  );
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
  cardId,
  deckId,
  onCardClick,
}: {
  comparison: CardComparison | null;
  size?: Size;
  cardId?: number | null;
  deckId?: string | null;
  onCardClick?: () => void;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const helpVisible = helpOpen || hover;

  if (!comparison) return null;

  const d = DIMS[size];
  const W = d.w;
  const cx = W / 2;
  const R = W * 0.42;
  const cy = R + 4;
  const Ro = R;
  const Ri = R * 0.72;
  const hubR = Math.max(6, R * 0.1);
  const H = cy + hubR + 3;
  const strokeW = Math.max(1, W * 0.006);
  const needleLen = Ro - Math.max(3, R * 0.04);

  const gathering = comparison.status === "gathering";
  const isStalker = comparison.status === "ok" && comparison.isStalker;
  const overIndex = comparison.status === "ok" ? comparison.overIndex : 0;

  // v2.49 — the dial only renders once the needle leaves the calm zone
  // (building or redline). Calm cards show the card + numbers, no dial.
  // Gathering keeps its dial so the "still gathering" state reads.
  const showDial = comparison.status !== "ok" || overIndex > 1;

  const alertFill = gathering
    ? "var(--gauge-track)"
    : isStalker
    ? "var(--gauge-alert)"
    : "var(--gauge-mid)";
  const needleColor = isStalker
    ? "var(--gauge-alert)"
    : "color-mix(in oklch, var(--color-foreground) 55%, transparent)";

  const nAngle = needleDeg(overIndex);
  const [tipX, tipY] = polar(cx, cy, needleLen, nAngle);
  const [b1x, b1y] = polar(cx, cy, hubR * 0.85, nAngle + 90);
  const [b2x, b2y] = polar(cx, cy, hubR * 0.85, nAngle - 90);
  const needlePts =
    `${b1x.toFixed(2)},${b1y.toFixed(2)} ${tipX.toFixed(2)},${tipY.toFixed(2)} ` +
    `${b2x.toFixed(2)},${b2y.toFixed(2)}`;

  const dial = (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      role="img"
      aria-label={
        gathering
          ? "Pressure gauge — still gathering data"
          : `Pressure gauge — ${overIndex.toFixed(1)} times baseline${
              isStalker ? ", past the redline" : ""
            }`
      }
    >
      <g stroke="var(--gauge-stroke)" strokeWidth={strokeW} strokeLinejoin="round">
        <path d={sector(cx, cy, Ro, Ri, 180, 144)} fill="var(--gauge-track)" />
        <path d={sector(cx, cy, Ro, Ri, 144, 100.8)} fill="var(--gauge-mid)" />
        <path d={sector(cx, cy, Ro, Ri, 100.8, 0)} fill={alertFill} />
      </g>
      {!gathering && (
        <>
          <polygon
            points={needlePts}
            fill={needleColor}
            stroke="var(--gauge-stroke)"
            strokeWidth={strokeW}
            strokeLinejoin="round"
          />
          <circle
            cx={cx}
            cy={cy}
            r={hubR}
            fill="var(--surface-card)"
            stroke="var(--gauge-stroke)"
            strokeWidth={strokeW * 1.2}
          />
        </>
      )}
    </svg>
  );

  // v2.49 — the hint leads with a small labelled dial: the three zones drawn
  // in their true colors with Calm / Building / Redline sitting along the arc,
  // plus this card's own needle so the seeker sees where it lands.
  const zoneDial = (() => {
    const Wg = 210;
    const pad = 22;
    const R2 = Wg * 0.4;
    const cx2 = Wg / 2;
    const cy2 = pad + R2 + 4;
    const Ro2 = R2;
    const Ri2 = R2 * 0.72;
    const hub2 = Math.max(6, R2 * 0.1);
    const H2 = cy2 + hub2 + 4;
    const sw2 = Math.max(1, Wg * 0.006);
    const nlen2 = Ro2 - Math.max(3, R2 * 0.04);
    const na2 = needleDeg(overIndex);
    const [tx, ty] = polar(cx2, cy2, nlen2, na2);
    const [q1x, q1y] = polar(cx2, cy2, hub2 * 0.85, na2 + 90);
    const [q2x, q2y] = polar(cx2, cy2, hub2 * 0.85, na2 - 90);
    const npts = `${q1x.toFixed(2)},${q1y.toFixed(2)} ${tx.toFixed(2)},${ty.toFixed(2)} ${q2x.toFixed(2)},${q2y.toFixed(2)}`;
    const lr = Ro2 + 9;
    const zlab = (deg: number, text: string, fill: string) => {
      const [lx, ly] = polar(cx2, cy2, lr, deg);
      return (
        <text
          x={lx.toFixed(1)}
          y={ly.toFixed(1)}
          textAnchor="middle"
          fontSize="11"
          fill={fill}
          style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}
        >
          {text}
        </text>
      );
    };
    return (
      <svg
        viewBox={`0 0 ${Wg} ${H2}`}
        width="100%"
        role="img"
        aria-label="The gauge zones: Calm, Building, Redline"
        style={{ display: "block", margin: "2px auto 4px" }}
      >
        <g stroke="var(--gauge-stroke)" strokeWidth={sw2} strokeLinejoin="round">
          <path d={sector(cx2, cy2, Ro2, Ri2, 180, 144)} fill="var(--gauge-track)" />
          <path d={sector(cx2, cy2, Ro2, Ri2, 144, 100.8)} fill="var(--gauge-mid)" />
          <path d={sector(cx2, cy2, Ro2, Ri2, 100.8, 0)} fill="var(--gauge-alert)" />
        </g>
        <polygon
          points={npts}
          fill={needleColor}
          stroke="var(--gauge-stroke)"
          strokeWidth={sw2}
          strokeLinejoin="round"
        />
        <circle
          cx={cx2}
          cy={cy2}
          r={hub2}
          fill="var(--surface-card)"
          stroke="var(--gauge-stroke)"
          strokeWidth={sw2 * 1.2}
        />
        {zlab(162, "Calm", "color-mix(in oklch, var(--gauge-track) 55%, var(--color-foreground))")}
        {zlab(122.4, "Building", "color-mix(in oklch, var(--gauge-mid) 72%, var(--color-foreground))")}
        {zlab(50.4, "Redline", "var(--gauge-alert)")}
      </svg>
    );
  })();

  const swatchRow = (swatch: string, lab: string, rest: string, key: string) => (
    <div key={key} style={{ display: "flex", gap: 9, marginBottom: 9 }}>
      <span
        style={{ flex: "0 0 9px", width: 9, height: 9, borderRadius: 3, background: swatch, marginTop: 6 }}
      />
      <div style={{ fontFamily: "var(--font-serif)", fontSize: d.label, lineHeight: 1.45 }}>
        <span style={{ fontStyle: "italic", color: "var(--color-foreground)" }}>{lab}</span>
        {" \u2014 "}
        <span style={{ color: "var(--color-foreground-muted)" }}>{rest}</span>
      </div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      {cardId != null ? (
        <div
          onClick={onCardClick}
          role={onCardClick ? "button" : undefined}
          tabIndex={onCardClick ? 0 : undefined}
          onKeyDown={
            onCardClick
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onCardClick();
                  }
                }
              : undefined
          }
          style={{
            position: "relative",
            width: W,
            cursor: onCardClick ? "pointer" : "default",
            lineHeight: 0,
          }}
        >
          <CardImage cardId={cardId} deckId={deckId ?? undefined} size="custom" widthPx={W} />
          {showDial && (
            <div style={{ position: "absolute", left: "50%", bottom: 0, transform: "translateX(-50%)", zIndex: 2 }}>
              {dial}
            </div>
          )}
        </div>
      ) : (
        showDial ? dial : null
      )}

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
        <div style={{ textAlign: "center", marginTop: 8 }}>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontStyle: "italic",
              fontSize: d.big,
              color: isStalker ? "var(--gauge-alert)" : "var(--color-foreground)",
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
              color: isStalker ? "var(--gauge-alert)" : "var(--color-foreground-muted)",
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
          style={{ marginTop: 8, width: "100%", maxWidth: W, position: "relative" }}
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
              color: "var(--gauge-alert)",
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
                border: "1px solid var(--gauge-alert)",
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
                position: "absolute",
                top: "calc(100% + 6px)",
                left: "50%",
                transform: "translateX(-50%)",
                width: "min(320px, 86vw)",
                maxHeight: "min(70vh, 440px)",
                overflowY: "auto",
                zIndex: "var(--z-popover, 50)" as unknown as number,
                textAlign: "left",
                background: "var(--surface-elevated)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-md, 10px)",
                padding: "12px 14px",
                boxShadow: "0 8px 24px rgba(0, 0, 0, 0.35)",
              }}
            >
              {zoneDial}
              <div style={{ height: 1, background: "var(--border-subtle)", margin: "8px 0 10px" }} />
              {(() => {
                const c = comparison;
                if (c.status !== "ok") return null;
                const rows: Array<[string, string, string]> = [
                  [
                    "var(--gauge-alert)",
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
                    "var(--gauge-alert)",
                    "The redline",
                    "once the needle crosses into the ember zone, the gap is too large for chance to explain \u2014 the card is genuinely following you.",
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
                  "var(--gauge-mid)",
                  `#${c.rank} of ${c.deckSize}`,
                  "where it ranks against every card by over-presence. Separate from the needle \u2014 that's this card vs. chance; this is this card vs. the rest of the deck.",
                ]);
                return (
                  <>
                    {rows.map(([sw, lab, rest], i) => swatchRow(sw, lab, rest, `s${i}`))}
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
