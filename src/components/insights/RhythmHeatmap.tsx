import { useEffect, useRef } from "react";
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
  const scrollRef = useRef<HTMLDivElement>(null);
  // 26-05-08-Q11 — Pan rhythm strip to the most recent day on mount.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [days.length]);
  return (
    <InsightCard
      title="Rhythm — last 30 days"
      caption={`${total} reading${total === 1 ? "" : "s"} in the last 30 days.`}
      onTap={onTap}
    >
      <div
        ref={scrollRef}
        className="flex gap-1 overflow-x-auto pb-1"
        style={{ scrollbarWidth: "none" }}
      >
        {days.map((d) => {
          const intensity = d.count === 0 ? 0.08 : 0.2 + (d.count / max) * 0.8;
          return (
            <div
              key={d.date}
              title={`${d.date}: ${d.count}`}
              style={{
                width: 18,
                height: 28,
                flex: "0 0 auto",
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