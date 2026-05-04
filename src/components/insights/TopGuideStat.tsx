import { InsightCard } from "./InsightCard";

export function TopGuideStat({
  data,
  onlyOne,
  onTap,
}: {
  data: { name: string; count: number } | null;
  onlyOne: boolean;
  onTap?: () => void;
}) {
  return (
    <InsightCard
      title="Top guide"
      caption={
        data
          ? onlyOne
            ? `You always reach for ${data.name}.`
            : `${data.count} reading${data.count === 1 ? "" : "s"} together.`
          : "Pick a guide to start tracking."
      }
      onTap={onTap}
    >
      <div
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "1.5rem",
          color: "var(--color-foreground)",
          lineHeight: 1.2,
        }}
      >
        {data ? data.name : "—"}
      </div>
    </InsightCard>
  );
}