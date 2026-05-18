import { getCardName } from "@/lib/tarot";
import type { StalkerCardsResult } from "@/lib/insights.types";
import { CardImage } from "@/components/card/CardImage";
import { DrawCalendar } from "./DrawCalendar";

/**
 * EJ-6 — Hero card for the Overview tab.
 * Variants:
 *   A — totalReadings === 0 → handled by parent empty state (not rendered).
 *   B — totalReadings 1–4 → "Just getting started."
 *   C — 5+ readings, no clear stalker → "Most-drawn so far."
 *   D — Stalker detected → "Stalker emerging." (gold ring).
 */
export function HeroCard({
  result,
  onTap,
}: {
  result: StalkerCardsResult;
  onTap?: () => void;
}) {
  const { stalkerCards, topCard, totalReadings } = result;
  const stalker = stalkerCards[0];
  const featuredId = stalker?.cardId ?? topCard?.cardId ?? 0;
  const count = stalker?.count ?? topCard?.count ?? 0;
  const appearances = stalker?.appearances ?? [];
  const monthCount =
    appearances.length > 0
      ? Math.min(3, new Set(appearances.map((a) => a.date.slice(0, 7))).size)
      : 0;
  const isStalker = !!stalker;
  const isLowData = totalReadings > 0 && totalReadings < 5;
  const overline = isLowData
    ? "Just getting started"
    : isStalker
      ? "Stalker emerging"
      : "Most-drawn card";
  const cardName = getCardName(featuredId);

  return (
    <button
      type="button"
      onClick={onTap}
      className="flex items-stretch gap-4 p-4 text-left transition-opacity hover:opacity-95"
      style={{
        maxWidth: 640,
        margin: "0 auto",
        width: "100%",
        background: "var(--surface-card)",
        borderRadius: 20,
        boxShadow: isStalker
          ? "0 0 0 1px var(--emphasis-fg-passive), 0 4px 30px var(--emphasis-bg-passive)"
          : "0 1px 3px color-mix(in oklch, var(--cosmos, #0a0a14) 25%, transparent)",
      }}
    >
      {/* EY-7 — unified card render. */}
      <CardImage
        cardId={featuredId}
        variant="face"
        size="custom"
        widthPx={120}
        ariaLabel={cardName}
        eager
        style={{ flexShrink: 0 }}
      />
      <div className="flex flex-1 flex-col justify-center gap-1">
        <div
          className="uppercase"
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-caption, 0.75rem)",
            letterSpacing: "0.18em",
            color: "var(--gold)",
            opacity: 0.85,
          }}
        >
          {overline}
        </div>
        <div
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "3rem",
            lineHeight: 1,
            color: "var(--color-foreground)",
          }}
        >
          {count}
        </div>
        <div
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body-sm)",
            opacity: 0.75,
            lineHeight: 1.3,
          }}
        >
          appearance{count === 1 ? "" : "s"} of {cardName}
        </div>
        {monthCount > 0 && (
          <div className="hidden md:block mt-2">
            <DrawCalendar appearances={appearances} monthsBack={monthCount} />
          </div>
        )}
      </div>
    </button>
  );
}