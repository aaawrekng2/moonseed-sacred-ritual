import { getCardName } from "@/lib/tarot";
import type { StalkerCardsResult, InsightsFilters } from "@/lib/insights.types";
import { CardImage } from "@/components/card/CardImage";
import { CardHoverTip } from "@/components/card/CardRichPopover";

/**
 * EJ-6 — Hero card for the Overview tab.
 * Variants:
 *   A — totalReadings === 0 → handled by parent empty state (not rendered).
 *   B — totalReadings 1–4 → "Just getting started."
 *   C — 5+ readings, no clear stalker → "Most-drawn so far."
 *   D — Stalker detected → "Stalker emerging." (gold ring).
 */
export function HeroCard({ result, onTap, filters }: { result: StalkerCardsResult; onTap?: () => void; filters: InsightsFilters }) {
  const { stalkerCards, topCard, totalReadings } = result;
  // EJ41 — defensive: stalkerCards may be undefined on partial payloads.
  const safeStalkerCards = Array.isArray(stalkerCards) ? stalkerCards : [];
  const stalker = safeStalkerCards[0];
  const featuredId = stalker?.cardId ?? topCard?.cardId ?? 0;
  const count = stalker?.count ?? topCard?.count ?? 0;
  const isStalker = !!stalker;
  const isLowData = (totalReadings ?? 0) > 0 && (totalReadings ?? 0) < 5;
  const overline = isLowData
    ? "Just getting started"
    : isStalker
      ? "Stalker emerging"
      : "Most-drawn card";
  const cardName = getCardName(featuredId);

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", width: "100%" }}>
      <div
        className="uppercase text-center mb-1"
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
        className="text-center mb-3"
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-body-lg)",
          color: "var(--color-foreground)",
        }}
      >
        {cardName}
      </div>
      <button
        type="button"
        onClick={onTap}
        className="flex items-center justify-center p-4 transition-opacity hover:opacity-95"
        style={{
          width: "100%",
          background: "transparent",
          borderRadius: 20,
          // v2.27 — panel color and emphasis ring removed; card sits on the page.
          boxShadow: "none",
        }}
      >
        <div style={{ position: "relative", width: 96, containerType: "inline-size" }}>
          <CardHoverTip cardId={featuredId} filters={filters}>
            <CardImage
              cardId={featuredId}
              variant="face"
              size="custom"
              widthPx={96}
              ariaLabel={cardName}
              eager
              style={{ width: "100%" }}
            />
          </CardHoverTip>
          <span className="tarotseed-card-badge" aria-label={`${count} appearances`}>
            {count}
            <span style={{ fontSize: "0.7em", marginLeft: "0.05em" }}>×</span>
          </span>
        </div>
      </button>
    </div>
  );
}
