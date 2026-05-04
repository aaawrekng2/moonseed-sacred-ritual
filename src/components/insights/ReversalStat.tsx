import { InsightCard } from "./InsightCard";

export function ReversalStat({
  rate,
  onTap,
}: {
  /** 0–1. */
  rate: number;
  onTap?: () => void;
}) {
  const pct = Math.round(rate * 100);
  const sub =
    rate > 0.4
      ? "Above average — shadow work is active."
      : rate >= 0.25
        ? "Within typical range."
        : "Mostly upright — forward energy.";
  return (
    <InsightCard
      title="Reversal rate"
      caption={
        <>
          <em>{sub}</em>
        </>
      }
      onTap={onTap}
    >
      <div className="flex items-baseline gap-2">
        <span
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "3rem",
            lineHeight: 1,
            color: "var(--gold)",
          }}
        >
          {pct}%
        </span>
        <span
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body-sm)",
            opacity: 0.7,
          }}
        >
          arrive reversed
        </span>
      </div>
    </InsightCard>
  );
}