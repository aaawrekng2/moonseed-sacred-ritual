import { InsightCard } from "./InsightCard";

/**
 * Q34 Fix 3 — "Elemental weather" ribbon.
 *
 * Five-category proportional ribbon (Major Arcana + four suits), with a
 * dominant-element callout and a wrapping legend row. Colors mix into
 * the active --accent so the chart always feels theme-native.
 */
type Key = "major" | "wands" | "cups" | "swords" | "pentacles";

const COLORS: Record<Key, string> = {
  major: "color-mix(in oklch, var(--accent) 90%, white)",
  wands: "color-mix(in oklch, var(--accent) 55%, oklch(0.62 0.20 35))",
  cups: "color-mix(in oklch, var(--accent) 40%, oklch(0.45 0.13 240))",
  swords: "color-mix(in oklch, var(--accent) 30%, oklch(0.78 0.02 250))",
  pentacles: "color-mix(in oklch, var(--accent) 35%, oklch(0.55 0.10 145))",
};

const LABELS: Record<Key, string> = {
  major: "Major Arcana",
  wands: "Wands",
  cups: "Cups",
  swords: "Swords",
  pentacles: "Pentacles",
};

const DOMINANT_CAPTION: Record<Key, string> = {
  major: "Archetypal forces are loud right now.",
  wands: "Fire and will are leading the way.",
  cups: "Emotion is the dominant frequency.",
  swords: "Thought and clarity are sharpening.",
  pentacles: "The body and the material call.",
};

const ORDER: Key[] = ["major", "wands", "cups", "swords", "pentacles"];

export function SuitBalanceChart({
  data,
  onTap,
}: {
  data: { major: number; wands: number; cups: number; swords: number; pentacles: number };
  onTap?: () => void;
}) {
  const entries = ORDER.map((k) => ({ key: k, value: data[k] }));
  const total = entries.reduce((s, e) => s + e.value, 0);
  const dominant = entries.slice().sort((a, b) => b.value - a.value)[0];
  const balanced =
    total === 0 ||
    entries.every((e) => Math.abs(e.value - total / 5) < total * 0.08);
  const caption =
    total === 0
      ? "No cards in this window yet."
      : balanced
        ? "The elements are in balance."
        : DOMINANT_CAPTION[dominant.key];

  return (
    <InsightCard title="Elemental weather" onTap={onTap}>
      <div
        className="flex w-full overflow-hidden"
        style={{ height: 12, borderRadius: "var(--radius-full, 9999px)" }}
      >
        {entries.map((e) => (
          <div
            key={e.key}
            style={{
              width: total === 0 ? "20%" : `${(e.value / total) * 100}%`,
              background: COLORS[e.key],
              opacity: total === 0 ? 0.25 : 1,
            }}
            title={`${LABELS[e.key]}: ${Math.round(e.value)}%`}
          />
        ))}
      </div>

      <div
        className="mt-3"
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-heading-md, 1.5rem)",
          color: "var(--color-foreground)",
          lineHeight: 1.1,
        }}
      >
        {total === 0 ? "—" : LABELS[dominant.key]}
      </div>

      <div
        className="mt-1"
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-body-sm)",
          color: "var(--color-foreground)",
          opacity: 0.6,
          lineHeight: 1.4,
        }}
      >
        {caption}
      </div>

      <div
        className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1"
        style={{
          fontSize: "var(--text-caption, 0.7rem)",
          color: "var(--color-foreground)",
          opacity: 0.6,
        }}
      >
        {entries
          .filter((e) => e.value > 0)
          .map((e) => (
            <span key={e.key} className="inline-flex items-center gap-1.5">
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "9999px",
                  background: COLORS[e.key],
                  display: "inline-block",
                }}
              />
              <span>{LABELS[e.key]}</span>
              <span className="tabular-nums" style={{ opacity: 0.7 }}>
                {Math.round(e.value)}%
              </span>
            </span>
          ))}
      </div>
    </InsightCard>
  );
}