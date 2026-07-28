import { useEffect, useRef } from "react";
import { InsightCard } from "./InsightCard";

export function RhythmHeatmap({
  days,
  onTap,
  windowDays = 30,
  inlineTotal = false,
}: {
  days: Array<{ date: string; count: number }>;
  onTap?: () => void;
  /** How many trailing days to show (the parent supplies up to 60). */
  windowDays?: number;
  /** Fold the spread total into the title and hide the bottom caption. */
  inlineTotal?: boolean;
}) {
  // EJ41 — defensive: parent may pass undefined on partial payloads.
  const safeDays = Array.isArray(days) ? days : [];
  const shown = windowDays > 0 ? safeDays.slice(-windowDays) : safeDays;
  const max = Math.max(1, ...shown.map((d) => d.count));
  const total = shown.reduce((a, b) => a + b.count, 0);
  const scrollRef = useRef<HTMLDivElement>(null);
  // 26-05-08-Q11 — Pan rhythm strip to the most recent day on mount.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [shown.length]);

  const spreadsText = `${total} spread${total === 1 ? "" : "s"} in the last ${windowDays} days`;

  return (
    <InsightCard
      title={inlineTotal ? `Rhythm — ${spreadsText}` : `Rhythm — last ${windowDays} days`}
      caption={inlineTotal ? undefined : `${spreadsText}.`}
      onTap={onTap}
    >
      <div
        ref={scrollRef}
        className="flex gap-1 overflow-x-auto pb-1"
        style={{ scrollbarWidth: "none" }}
      >
        {shown.map((d) => {
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
