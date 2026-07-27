/**
 * StalkerMeterRow (v3.130)
 *
 * The Overview's most-present block: the single most-pulled card shown large
 * with a pull-count badge and the plain-language odds sentence above it, then
 * a row of the next four most-pulled cards as badged thumbnails. Tapping any
 * card opens its Card Trace. Pure presentational — all data comes from
 * getEngineInsights via the `data` prop.
 */
import { CardImage } from "@/components/card/CardImage";
import type { EngineInsights } from "@/lib/insights.functions";
import type { CardComparison } from "@/lib/pattern-engine";

const CARD_W = 190;
const THUMB_GAP = 6;
const THUMB_W = Math.floor((CARD_W - THUMB_GAP * 3) / 4); // 4 thumbs span card width

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

// v3.130 — the plain-language readout, now placed above the card and with the
// bare "(~expected)" figure removed at the seeker's request.
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

function CountBadge({ count, big }: { count: number; big?: boolean }) {
  return (
    <div
      style={{
        position: "absolute",
        top: big ? 6 : 3,
        right: big ? 6 : 3,
        background: "rgba(0,0,0,0.72)",
        color: "var(--gold)",
        border: "1px solid var(--gold)",
        borderRadius: 999,
        fontFamily: "var(--font-serif)",
        fontStyle: "italic",
        fontWeight: 600,
        fontSize: big ? 13 : 10,
        lineHeight: 1,
        padding: big ? "3px 8px" : "2px 5px",
        pointerEvents: "none",
      }}
    >
      {count}
    </div>
  );
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
  const thumbs = topPulled.slice(1, 5);
  const sentence = readout(topComparison, rangeLabel);
  const header = anyStalker
    ? "What's been following you"
    : "Your most-present card";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        alignItems: "center",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontStyle: "italic",
          fontSize: "var(--text-heading-md)",
          color: "var(--color-foreground)",
          opacity: 0.9,
          textAlign: "center",
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
            textAlign: "center",
            lineHeight: 1.55,
            maxWidth: 320,
          }}
        >
          {sentence}
        </div>
      )}

      <div style={{ width: CARD_W }}>
        <button
          type="button"
          onClick={() => onOpenCard(big.cardId)}
          style={{
            position: "relative",
            display: "block",
            width: "100%",
            padding: 0,
            border: "none",
            background: "none",
            cursor: "pointer",
            lineHeight: 0,
          }}
          aria-label={`${big.cardName}, drawn ${big.count} times — open card trace`}
        >
          <CardImage cardId={big.cardId} size="custom" widthPx={CARD_W} />
          <CountBadge count={big.count} big />
        </button>

        {thumbs.length > 0 && (
          <div style={{ display: "flex", gap: THUMB_GAP, marginTop: 8 }}>
            {thumbs.map((t) => (
              <button
                key={t.cardId}
                type="button"
                onClick={() => onOpenCard(t.cardId)}
                style={{
                  position: "relative",
                  padding: 0,
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  lineHeight: 0,
                }}
                aria-label={`${t.cardName}, drawn ${t.count} times — open card trace`}
              >
                <CardImage cardId={t.cardId} size="custom" widthPx={THUMB_W} />
                <CountBadge count={t.count} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
