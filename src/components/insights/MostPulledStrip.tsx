/**
 * MostPulledStrip (v3.134)
 *
 * A full-width, horizontally-scrolling strip of every card the seeker has
 * pulled in the active window, ranked by count (the #1 card is shown large in
 * the most-present block above, so it's excluded here). Each tile is ~50%
 * larger than the old thumbnails and carries the same gold pull-count badge.
 */
import { PulledCard } from "@/components/insights/PulledCard";
import type { EngineInsights } from "@/lib/insights.functions";

export function MostPulledStrip({
  data,
  onOpenCard,
  rangeLabel,
}: {
  data: EngineInsights | null;
  onOpenCard: (cardId: number) => void;
  rangeLabel: string;
}) {
  if (!data || data.status !== "ok") return null;
  const cards = data.topPulled.slice(1); // hero shown large above
  if (cards.length === 0) return null;

  const W = 65; // ~50% larger than the old 43px thumbnails

  return (
    <section
      style={{
        background: "var(--surface-card)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-md, 10px)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 10,
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
          Your most-pulled cards
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
          Ranked by how often you drew them — scroll for more.
        </p>
      </div>

      <div
        style={{
          display: "flex",
          gap: 16,
          overflowX: "auto",
          paddingTop: 6,
          paddingBottom: 18,
          paddingRight: 16,
        }}
      >
        {cards.map((c) => (
          <PulledCard
            key={c.cardId}
            cardId={c.cardId}
            cardName={c.cardName}
            count={c.count}
            widthPx={W}
            title={`Pulled ${c.count} times in ${rangeLabel}`}
            onClick={() => onOpenCard(c.cardId)}
          />
        ))}
      </div>
    </section>
  );
}
