/**
 * SuitCompositionRing (v2.44)
 *
 * A whole-deck composition view fed by the pattern engine. The outer ring is
 * suit volume (each arc sized by how often that suit is drawn); a gold rim
 * marks a suit whose over-presence is statistically real (Bonferroni-corrected).
 * The inner ring is the Major / Minor split. Complements the per-card gauges:
 * gauges are about single cards vs. chance, this is the deck's overall lean.
 * Pure presentational — data comes from getEngineInsights.
 */
import type { EngineInsights } from "@/lib/insights.functions";

const SUIT_FILL: Record<string, string> = {
  majors: "color-mix(in oklch, var(--accent) 88%, white)",
  wands: "color-mix(in oklch, var(--accent) 55%, oklch(0.62 0.20 35))",
  cups: "color-mix(in oklch, var(--accent) 40%, oklch(0.45 0.13 240))",
  swords: "color-mix(in oklch, var(--accent) 30%, oklch(0.78 0.02 250))",
  pentacles: "color-mix(in oklch, var(--accent) 35%, oklch(0.55 0.10 145))",
};

function dashFor(frac: number, startFrac: number, circ: number) {
  const on = Math.max(0, frac * circ);
  return { da: `${on.toFixed(2)} ${(circ - on).toFixed(2)}`, off: (-startFrac * circ).toFixed(2) };
}

function fmtX(n: number): string {
  return n >= 10 ? `${Math.round(n)}\u00d7` : `${n.toFixed(1)}\u00d7`;
}

export function SuitCompositionRing({ data }: { data: EngineInsights | null }) {
  if (!data || data.status !== "ok") return null;
  const { suits, majorMinor, totalSlots } = data;
  if (totalSlots <= 0) return null;

  const cx = 110;
  const cy = 110;
  const R = 88;
  const TH = 22;
  const C = 2 * Math.PI * R;
  const Rrim = R + TH / 2 + 3;
  const Crim = 2 * Math.PI * Rrim;
  const ri = 58;
  const thi = 15;
  const Ci = 2 * Math.PI * ri;

  let accFrac = 0;
  const outer = suits.map((s) => {
    const frac = s.observed / totalSlots;
    const startFrac = accFrac;
    accFrac += frac;
    return { key: s.key, label: s.label, frac, startFrac, isOver: s.isOver };
  });

  const majFrac = majorMinor.major / totalSlots;

  return (
    <section
      style={{
        background: "var(--surface-card)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-md, 10px)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <h3
          style={{
            fontFamily: "var(--font-display)",
            fontStyle: "italic",
            fontSize: "var(--text-heading-md)",
            margin: 0,
          }}
        >
          Suit composition
        </h3>
        <p
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-caption)",
            opacity: 0.7,
            margin: 0,
          }}
        >
          Which suits you pull more than chance — a gold rim marks a real lean.
        </p>
      </div>

      <div style={{ display: "flex", justifyContent: "center" }}>
        <svg viewBox="0 0 220 220" width="220" role="img" aria-label="Suit composition ring">
          <circle
            cx={cx}
            cy={cy}
            r={R}
            fill="none"
            stroke="color-mix(in oklch, var(--color-foreground) 8%, transparent)"
            strokeWidth={TH}
          />
          {outer.map((o) => {
            const seg = dashFor(o.frac, o.startFrac, C);
            const rim = dashFor(o.frac, o.startFrac, Crim);
            return (
              <g key={o.key}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={R}
                  fill="none"
                  stroke={SUIT_FILL[o.key]}
                  strokeWidth={TH}
                  strokeDasharray={seg.da}
                  strokeDashoffset={seg.off}
                  transform={`rotate(-90 ${cx} ${cy})`}
                />
                {o.isOver && (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={Rrim}
                    fill="none"
                    stroke="var(--gold)"
                    strokeWidth={3}
                    strokeDasharray={rim.da}
                    strokeDashoffset={rim.off}
                    transform={`rotate(-90 ${cx} ${cy})`}
                  />
                )}
                {o.frac >= 0.05 &&
                  (() => {
                    // Label sits on the band at the segment's mid-angle,
                    // outlined so it reads on any theme's fill.
                    const th = (o.startFrac + o.frac / 2) * 2 * Math.PI;
                    const lx = cx + R * Math.sin(th);
                    const ly = cy - R * Math.cos(th);
                    const txt = o.key === "pentacles" ? "Pents" : o.label;
                    return (
                      <text
                        x={lx.toFixed(1)}
                        y={ly.toFixed(1)}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize="10.5"
                        fill="var(--color-foreground)"
                        stroke="var(--background)"
                        strokeWidth={2.2}
                        paintOrder="stroke"
                        strokeLinejoin="round"
                        style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}
                      >
                        {txt}
                      </text>
                    );
                  })()}
              </g>
            );
          })}

          <circle
            cx={cx}
            cy={cy}
            r={ri}
            fill="none"
            stroke="color-mix(in oklch, var(--color-foreground) 16%, transparent)"
            strokeWidth={thi}
          />
          {(() => {
            const s = dashFor(majFrac, 0, Ci);
            return (
              <circle
                cx={cx}
                cy={cy}
                r={ri}
                fill="none"
                stroke="color-mix(in oklch, var(--gold) 55%, transparent)"
                strokeWidth={thi}
                strokeDasharray={s.da}
                strokeDashoffset={s.off}
                transform={`rotate(-90 ${cx} ${cy})`}
              />
            );
          })()}

          <text
            x={cx}
            y={cy - 2}
            textAnchor="middle"
            fontSize="26"
            fill="var(--color-foreground)"
            style={{ fontFamily: "var(--font-display)", fontStyle: "italic" }}
          >
            {totalSlots}
          </text>
          <text
            x={cx}
            y={cy + 16}
            textAnchor="middle"
            fontSize="13"
            fill="var(--color-foreground)"
            style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", letterSpacing: "0.03em" }}
          >
            draws
          </text>
        </svg>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "6px 14px" }}>
        {suits.map((s) => (
          <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 3,
                background: SUIT_FILL[s.key],
                outline: s.isOver ? "1.5px solid var(--gold)" : "none",
                outlineOffset: 1,
              }}
            />
            <span
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: "var(--text-caption)",
                color: "var(--color-foreground)",
              }}
            >
              {s.label}
            </span>
            <span
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: "var(--text-caption)",
                color: s.isOver ? "var(--gold)" : "var(--color-foreground-muted)",
              }}
            >
              {fmtX(s.overIndex)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
