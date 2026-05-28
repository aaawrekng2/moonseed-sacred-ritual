/**
 * EJ70 — TagCloud
 *
 * All-time tag word cloud for a single card on Card Trace. Tags are
 * sized by how often they appear on readings containing this card
 * (bigger = used more). Scoped to the card and independent of the
 * page filter bar — the data arrives pre-aggregated all-time from
 * getStalkerCardDetail.tagCloud.
 *
 * No pills (per the styling doc) — these are sized text, flowing
 * inline. Font size maps the frequency range onto a small/large band.
 */
import type { CSSProperties } from "react";

export type TagCloudEntry = { tag: string; count: number };

export function TagCloud({ entries }: { entries: TagCloudEntry[] }) {
  if (!entries || entries.length === 0) return null;

  const counts = entries.map((e) => e.count);
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  // Map count → font-size in the 12–26px band. When every tag has the
  // same count (max === min) they all render at the mid size.
  const sizeFor = (count: number): number => {
    if (max === min) return 17;
    const t = (count - min) / (max - min);
    return Math.round(12 + t * 14);
  };
  // Opacity scales gently with frequency too, so the most-used tags
  // read brightest.
  const opacityFor = (count: number): number => {
    if (max === min) return 0.85;
    const t = (count - min) / (max - min);
    return 0.55 + t * 0.4;
  };

  const sectionLabel: CSSProperties = {
    fontSize: 10,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color: "var(--accent, var(--gold))",
    opacity: 0.75,
    marginBottom: 8,
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        borderTop:
          "1px solid color-mix(in oklab, var(--accent, var(--gold)) 15%, transparent)",
        paddingTop: 10,
      }}
    >
      <div style={sectionLabel}>Tags most used with this card</div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "baseline",
          gap: "6px 14px",
        }}
      >
        {entries.map((e) => (
          <span
            key={e.tag}
            title={`${e.tag} · ${e.count} ${e.count === 1 ? "reading" : "readings"}`}
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: sizeFor(e.count),
              lineHeight: 1.2,
              color: "var(--color-foreground)",
              opacity: opacityFor(e.count),
              cursor: "help",
            }}
          >
            {e.tag}
          </span>
        ))}
      </div>
    </div>
  );
}
