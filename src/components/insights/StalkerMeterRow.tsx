/**
 * StalkerMeterRow (v3.135)
 *
 * The Overview's most-present block, laid out as a row: the single most-pulled
 * card shown large on the LEFT (sized to roughly match the Suit Trends box
 * height), and the header + plain-language odds sentence in a vertically-
 * centered column to its RIGHT. Pure presentational — data from
 * getEngineInsights via the `data` prop.
 */
import { PulledCard } from "@/components/insights/PulledCard";
import type { EngineInsights } from "@/lib/insights.functions";
import type { CardComparison } from "@/lib/pattern-engine";

// ~ the Suit Trends box height (fixed 300px chart + chrome) at RWS card aspect.
const CARD_W = 230;

function poissonAtLeast(k: number, lambda: number): number {
  if (k <= 0) return 1;
  if (lambda <= 0) return 0;
  let cdf = 0;
  let term = Math.exp(-lambda); // P(X = 0)
  for (let i = 0; i < k; i++) {
    cdf += term;
    term *= lambda / (i + 1);
  }
  return Math.max(0, Math.min(1, 1 - cdf));
}

function formatOneIn(oneInN: number): string {
  if (!Number.isFinite(oneInN) || oneInN > 1_000_000) return "~1 in 1,000,000+";
  if (oneInN < 1) return "common";
  return `~1 in ${Math.round(oneInN).toLocaleString()}`;
}

function readout(
  comparison: CardComparison | null,
  rangeLabel: string,
): string | null {
  if (!comparison || comparison.status !== "ok") return null;
  const observed = comparison.observed;
  const expected = comparison.expected;
  const overIndex = expected > 0 ? observed / expected : 0;
  const prob = poissonAtLeast(observed, expected);
  const oneIn = prob > 0 ? 1 / prob : Infinity;
  const showOdds = overIndex > 1 && oneIn >= 3;
  const base = `In ${rangeLabel}, you drew it ${observed} times — about ${overIndex.toFixed(
    1,
  )}× what chance alone would deal.`;
  return showOdds ? `${base} The odds of that are ${formatOneIn(oneIn)}.` : base;
}

export function StalkerMeterRow({
  data,
  onOpenCard,
  rangeLabel,
}: {
  data: EngineInsights | null;
  onOpenCard: (cardId: number) => void;
  rangeLabel: string;
}) {
  if (!data) return null;

  if (data.status === "gathering") {
    return (
      <div style={{ textAlign: "center", padding: "6px 0" }}>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontStyle: "italic",
            fontSize: "var(--text-heading-md)",
            color: "var(--color-foreground)",
            opacity: 0.9,
          }}
        >
          Your patterns are still gathering
        </div>
        <div
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body-sm)",
            color: "var(--color-foreground-muted)",
            marginTop: 4,
          }}
        >
          {data.totalSlots} of {data.needed} draws — the pattern wakes once
          there's enough to tell it from chance.
        </div>
      </div>
    );
  }

  const { topPulled, topComparison } = data;
  if (!topPulled || topPulled.length === 0) return null;

  const big = topPulled[0];
  const sentence = readout(topComparison, rangeLabel);

  return (
    <div className="flex shrink-0 flex-col gap-4 sm:flex-row sm:items-start">
      <PulledCard
        cardId={big.cardId}
        cardName={big.cardName}
        count={big.count}
        widthPx={CARD_W}
        big
        title={`Pulled ${big.count} times in ${rangeLabel} — your most-drawn card`}
        onClick={() => onOpenCard(big.cardId)}
      />

      <div className="flex flex-col gap-2" style={{ width: CARD_W }}>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontStyle: "italic",
            fontSize: "var(--text-heading-md)",
            color: "var(--color-foreground)",
            opacity: 0.9,
            textAlign: "left",
            textTransform: "uppercase",
            lineHeight: 1.1,
          }}
        >
          <div>Your most</div>
          <div>drawn card</div>
        </div>

        {sentence && (
          <div
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-body-sm)",
              color: "var(--color-foreground)",
              textAlign: "left",
              lineHeight: 1.55,
            }}
          >
            {sentence}
          </div>
        )}
      </div>
    </div>
  );
}
