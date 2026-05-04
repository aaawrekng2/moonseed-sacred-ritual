import { InsightCard } from "./InsightCard";
import { useTrackReversals } from "@/lib/use-track-reversals";

export function ReversalStat({
  rate,
  onTap,
}: {
  /** 0–1. */
  rate: number;
  onTap?: () => void;
}) {
  // ER-8 — hide entirely when the seeker has turned off reversal tracking.
  const { trackReversals, loaded } = useTrackReversals();
  if (loaded && !trackReversals) return null;
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