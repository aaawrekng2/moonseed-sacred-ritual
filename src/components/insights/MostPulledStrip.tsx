/**
 * MostPulledStrip (v3.135)
 *
 * A bare, full-width, horizontally-scrolling strip of every card the seeker has
 * pulled in the active window (ranked by count; the #1 card is shown large in
 * the most-present block above, so it's excluded here). No border, heading, or
 * caption — just the cards. Each tile carries the gold pull-count badge.
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
          faded={c.count === 0}
          title={
            c.count === 0
              ? `Not drawn in ${rangeLabel}`
              : `Pulled ${c.count} times in ${rangeLabel}`
          }
          onClick={() => onOpenCard(c.cardId)}
        />
      ))}
    </div>
  );
}
