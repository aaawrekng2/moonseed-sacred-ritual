/**
 * v3.41 — live structural read-out for the current cast on the draw table.
 * Renders the composition signals from analyzeSpread() as compact rows. Shows
 * nothing when there are no signals (short spreads, or nothing notable).
 */
import type { SpreadSignal } from "@/lib/spread-structure";

export function SpreadStructureStrip({ signals }: { signals: SpreadSignal[] }) {
  if (!signals.length) return null;
  return (
    <div
      style={{
        width: "100%",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-lg, 14px)",
        background: "var(--surface-card)",
        padding: "10px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontStyle: "italic",
          fontSize: "var(--text-caption)",
          color: "var(--color-foreground-muted)",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          marginBottom: 2,
        }}
      >
        This spread
      </div>
      {signals.map((s) => (
        <div key={s.key} style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 6 }}>
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontStyle: "italic",
              fontSize: "var(--text-body-sm, 13px)",
              color: "var(--accent)",
              whiteSpace: "nowrap",
            }}
          >
            {s.label}
          </span>
          <span
            style={{
              fontSize: "var(--text-caption, 12px)",
              color: "var(--color-foreground-muted)",
            }}
          >
            {s.detail}
          </span>
        </div>
      ))}
    </div>
  );
}
