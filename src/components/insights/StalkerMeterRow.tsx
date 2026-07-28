/**
 * StalkerMeterRow (v3.134)
 *
 * The Overview's most-present block: the single most-pulled card shown large
 * (with its gold pull-count badge) at the TOP, then the header, then the
 * plain-language odds sentence. The rest of the ranked cards live in the
 * separate MostPulledStrip below the Suit Trends row. Pure presentational —
 * all data comes from getEngineInsights via the `data` prop.
 */
import { PulledCard } from "@/components/insights/PulledCard";
import type { EngineInsights } from "@/lib/insights.functions";
import type { CardComparison } from "@/lib/pattern-engine";

const CARD_W = 190;

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

  const { topPulled, topComparison, anyStalker } = data;
  if (!topPulled || topPulled.length === 0) return null;

  const big = topPulled[0];
  const sentence = readout(topComparison, rangeLabel);
  const header = anyStalker
    ? "What's been following you"
    : "Your most-present card";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        alignItems: "flex-start",
      }}
    >
      <PulledCard
        cardId={big.cardId}
        cardName={big.cardName}
        count={big.count}
        widthPx={CARD_W}
        big
        title={`Pulled ${big.count} times in ${rangeLabel} — your most-drawn card`}
        onClick={() => onOpenCard(big.cardId)}
      />

      <div
        style={{
          fontFamily: "var(--font-display)",
          fontStyle: "italic",
          fontSize: "var(--text-heading-md)",
          color: "var(--color-foreground)",
          opacity: 0.9,
          textAlign: "left",
          marginTop: 14,
        }}
      >
        {header}
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
            maxWidth: 320,
          }}
        >
          {sentence}
        </div>
      )}
    </div>
  );
}
