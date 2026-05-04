import { InsightCard } from "./InsightCard";

export function TopLensStat({
  data,
  totalDeep,
  onTap,
}: {
  data: { name: string; count: number } | null;
  totalDeep: number;
  onTap?: () => void;
}) {
  if (!data || totalDeep === 0) return null;
  return (
    <InsightCard
      title="Top lens"
      caption={`${data.count} of ${totalDeep} deep readings.`}
      onTap={onTap}
    >
      <div
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "1.4rem",
          color: "var(--color-foreground)",
          lineHeight: 1.2,
        }}
      >
        {data.name}
      </div>
      <div
        style={{
          fontStyle: "italic",
          fontSize: "var(--text-body-sm)",
          opacity: 0.7,
          marginTop: 4,
        }}
      >
        is the lens you reach for most.
      </div>
    </InsightCard>
  );
}