/**
 * v3.16 — the /lunations lens toggle, extracted so it can live on the same row
 * as the "Type or paste card names…" input instead of at the top of the strip.
 * Cycles: moon phase -> day of month -> numerology -> day of week.
 */
import { CalendarDays, Hash, Moon, Sparkles } from "lucide-react";

type Lens = "moon" | "day" | "numerology" | "weekday";

const NEXT: Record<Lens, Lens> = {
  moon: "day",
  day: "numerology",
  numerology: "weekday",
  weekday: "moon",
};

export function LunationLensToggle({
  lens,
  onLensChange,
}: {
  lens: Lens;
  onLensChange: (lens: Lens) => void;
}) {
  const label =
    lens === "moon"
      ? "By moon phase"
      : lens === "day"
        ? "By day of month"
        : lens === "numerology"
          ? "By numerology"
          : "By day of week";
  return (
    <button
      type="button"
      onClick={() => onLensChange(NEXT[lens])}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        background: "var(--surface-card)",
        border: "1px solid var(--accent, var(--gold))",
        borderRadius: 8,
        color: "var(--color-foreground)",
        cursor: "pointer",
        padding: "8px 12px",
        fontFamily: "var(--font-serif)",
        fontStyle: "italic",
        fontSize: 13,
        flexShrink: 0,
        whiteSpace: "nowrap",
      }}
    >
      {lens === "moon" ? (
        <Moon size={15} strokeWidth={1.5} aria-hidden="true" />
      ) : lens === "day" ? (
        <Hash size={15} strokeWidth={1.5} aria-hidden="true" />
      ) : lens === "numerology" ? (
        <Sparkles size={15} strokeWidth={1.5} aria-hidden="true" />
      ) : (
        <CalendarDays size={15} strokeWidth={1.5} aria-hidden="true" />
      )}
      {label}
    </button>
  );
}
