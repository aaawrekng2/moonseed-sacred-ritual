import { getCardImagePath, getCardName } from "@/lib/tarot";
import type { StalkerCardsResult } from "@/lib/insights.types";
import { useActiveDeckImage, useActiveDeckCornerRadius, cornerRadiusStyle } from "@/lib/active-deck";
import { useElementWidth } from "@/lib/use-element-width";

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
  const isStalker = !!stalker;
  const isLowData = totalReadings > 0 && totalReadings < 5;
  const overline = isLowData
    ? "Just getting started"
    : isStalker
      ? "Stalker emerging"
      : "Most-drawn card";
  const resolveImage = useActiveDeckImage();
  const displayUrl = resolveImage(featuredId, "display");
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const radiusPct = useActiveDeckCornerRadius();
  const radiusStyle = cornerRadiusStyle(radiusPct, width || 120);
  const cardName = getCardName(featuredId);

  // Twice-this-week banner: count appearances in last 7 days.
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentCount =
    stalker?.appearances.filter((a) => new Date(a.date).getTime() >= sevenDaysAgo).length ?? 0;

  return (
    <button
      type="button"
      onClick={onTap}
      className="flex w-full items-stretch gap-4 p-4 text-left transition-opacity hover:opacity-95"
      style={{
        background: "var(--surface-card)",
        borderRadius: 20,
        boxShadow: isStalker
          ? "0 0 0 1px color-mix(in oklch, var(--gold) 40%, transparent), 0 4px 30px color-mix(in oklch, var(--gold) 18%, transparent)"
          : "0 1px 3px color-mix(in oklch, var(--cosmos, #0a0a14) 25%, transparent)",
      }}
    >
      <div
        ref={ref}
        style={{
          width: 120,
          aspectRatio: "1 / 1.75",
          overflow: "hidden",
          background: "var(--cosmos, #0a0a14)",
          flexShrink: 0,
          ...radiusStyle,
        }}
      >
        <img
          src={displayUrl ?? getCardImagePath(featuredId)}
          alt={cardName}
          className="h-full w-full object-cover"
          style={radiusStyle}
        />
      </div>
      <div className="flex flex-1 flex-col justify-center gap-1">
        <div
          className="uppercase"
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-caption, 0.7rem)",
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
        {recentCount >= 2 && (
          <div
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-body-sm)",
              color: "var(--gold)",
              marginTop: 4,
            }}
          >
            Twice this week.
          </div>
        )}
      </div>
    </button>
  );
}