import { InsightCard } from "./InsightCard";

export function RhythmHeatmap({
  days,
  onTap,
}: {
  days: Array<{ date: string; count: number }>;
  onTap?: () => void;
}) {
  const max = Math.max(1, ...days.map((d) => d.count));
  const total = days.reduce((a, b) => a + b.count, 0);
  return (
    <InsightCard
      title="Rhythm — last 30 days"
      caption={`${total} reading${total === 1 ? "" : "s"} in the last 30 days.`}
      onTap={onTap}
    >
      <div className="grid grid-cols-6 gap-1">
        {days.map((d) => {
          const intensity = d.count === 0 ? 0.08 : 0.2 + (d.count / max) * 0.8;
          return (
            <div
              key={d.date}
              title={`${d.date}: ${d.count}`}
              style={{
                aspectRatio: "1 / 1",
                background: "var(--gold)",
                opacity: intensity,
                borderRadius: 4,
              }}
            />
          );
        })}
      </div>
    </InsightCard>
  );
}