import { InsightCard } from "./InsightCard";

export function MajorMinorChart({
  data,
  onTap,
}: {
  data: { major: number; minor: number };
  onTap?: () => void;
}) {
  const total = data.major + data.minor;
  const caption =
    total === 0
      ? "Pull a few cards to see the major/minor balance."
      : data.major > 60
        ? "Major-heavy: big life themes are loud right now."
        : data.minor > 60
          ? "Minor-heavy: day-to-day energy dominates."
          : "Balanced between archetypal and everyday.";
  return (
    <InsightCard title="Major / Minor" caption={caption} onTap={onTap}>
      <div className="flex h-6 w-full overflow-hidden rounded-full">
        <div
          style={{
            width: total === 0 ? "50%" : `${data.major}%`,
            background: "var(--gold)",
            opacity: total === 0 ? 0.25 : 1,
          }}
        />
        <div
          style={{
            width: total === 0 ? "50%" : `${data.minor}%`,
            background: "color-mix(in oklch, var(--gold) 25%, transparent)",
          }}
        />
      </div>
      <div
        className="mt-2 flex justify-between"
        style={{
          fontSize: "var(--text-caption, 0.65rem)",
          color: "var(--color-foreground)",
          opacity: 0.65,
          letterSpacing: "0.1em",
        }}
      >
        <span>Major {Math.round(data.major)}%</span>
        <span>Minor {Math.round(data.minor)}%</span>
      </div>
    </InsightCard>
  );
}