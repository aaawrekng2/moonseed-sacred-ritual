import { InsightCard } from "./InsightCard";

const SUIT_COLORS = {
  wands: "oklch(0.62 0.20 35)",
  cups: "oklch(0.45 0.13 240)",
  swords: "oklch(0.78 0.02 250)",
  pentacles: "oklch(0.55 0.10 145)",
} as const;

const CAPTIONS: Record<keyof typeof SUIT_COLORS, string> = {
  wands: "Wands-heavy: action and will lead the way.",
  cups: "Cups-heavy: emotion is the dominant frequency.",
  swords: "Swords-heavy: thought and clarity are sharpening.",
  pentacles: "Pentacles-heavy: the body and the material call.",
};

const SUIT_SHORT: Record<keyof typeof SUIT_COLORS, string> = {
  wands: "Wands",
  cups: "Cups",
  swords: "Swords",
  pentacles: "Pent.",
};

export function SuitBalanceChart({
  data,
  onTap,
}: {
  data: { wands: number; cups: number; swords: number; pentacles: number };
  onTap?: () => void;
}) {
  const total = data.wands + data.cups + data.swords + data.pentacles;
  const entries = (Object.keys(SUIT_COLORS) as Array<keyof typeof SUIT_COLORS>).map(
    (k) => ({ key: k, value: data[k] }),
  );
  const dominant = entries.slice().sort((a, b) => b.value - a.value)[0];
  const balanced =
    total === 0 || entries.every((e) => Math.abs(e.value - total / 4) < total * 0.08);
  const caption = total === 0
    ? "No minor arcana in this window yet."
    : balanced
      ? "Balanced across all four suits."
      : CAPTIONS[dominant.key];

  return (
    <InsightCard title="Suit balance" caption={caption} onTap={onTap}>
      <div className="flex h-6 w-full overflow-hidden rounded-full">
        {entries.map((e) => (
          <div
            key={e.key}
            style={{
              width: total === 0 ? "25%" : `${(e.value / total) * 100}%`,
              background: SUIT_COLORS[e.key],
              opacity: total === 0 ? 0.25 : 1,
            }}
            title={`${e.key}: ${Math.round(e.value)}%`}
          />
        ))}
      </div>
      <div
        className="mt-2 grid grid-cols-4 gap-1"
        style={{
          fontSize: "var(--text-caption, 0.65rem)",
          color: "var(--color-foreground)",
          opacity: 0.65,
          letterSpacing: "0.08em",
        }}
      >
        {entries.map((e) => (
          <div
            key={e.key}
            className="flex flex-col items-start gap-0.5"
          >
            <span className="sm:hidden">{SUIT_SHORT[e.key]}</span>
            <span className="hidden sm:inline capitalize">{e.key}</span>
            <span className="tabular-nums" style={{ opacity: 0.8 }}>
              {Math.round(e.value)}%
            </span>
          </div>
        ))}
      </div>
    </InsightCard>
  );
}