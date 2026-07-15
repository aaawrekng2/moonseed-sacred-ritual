/**
 * v3.44 — curated card-combination meanings for the current cast.
 * Renders the pairs present in the spread (dominant-theme first, capped) plus a
 * one-line dominant-theme summary. Shows nothing when no known pair is present.
 */
import { matchCombinations } from "@/lib/card-combinations";

const MAX_PAIRS = 6;

export function SpreadCombinationsStrip({ cardIds }: { cardIds: number[] }) {
  const { pairs, dominantTheme } = matchCombinations(cardIds);
  if (!pairs.length) return null;
  const shown = pairs.slice(0, MAX_PAIRS);
  const extra = pairs.length - shown.length;
  return (
    <div
      style={{
        width: "100%",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-lg, 14px)",
        background: "var(--surface-card)",
        padding: "10px 14px",
        marginTop: 12,
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
        Card combinations{dominantTheme ? ` · leans ${dominantTheme}` : ""}
      </div>
      {shown.map((p) => (
        <div key={`${p.aId}-${p.bId}`} style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 6 }}>
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontStyle: "italic",
              fontSize: "var(--text-body-sm, 13px)",
              color: "var(--accent)",
              whiteSpace: "nowrap",
            }}
          >
            {p.aName} + {p.bName}
          </span>
          <span style={{ fontSize: "var(--text-caption, 12px)", color: "var(--color-foreground-muted)" }}>
            {p.meaning}
          </span>
        </div>
      ))}
      {extra > 0 && (
        <div style={{ fontSize: "var(--text-caption, 12px)", color: "var(--color-foreground-muted)", fontStyle: "italic" }}>
          + {extra} more pair{extra === 1 ? "" : "s"}
        </div>
      )}
    </div>
  );
}
