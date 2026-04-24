import { useRestingOpacity } from "@/lib/use-resting-opacity";
import { cn } from "@/lib/utils";

const SPREADS = [
  { id: "single", label: "Single", glyph: "✦" },
  { id: "three", label: "Three", glyph: "✦✦✦" },
  { id: "celtic", label: "Celtic", glyph: "⊕" },
  { id: "yes-no", label: "Yes / No", glyph: "◈" },
] as const;

export function SpreadIconsRow() {
  const { opacity } = useRestingOpacity();
  const restingAlpha = opacity / 100;

  return (
    <div className="flex w-full items-end justify-around gap-2 px-4">
      {SPREADS.map((s) => (
        <button
          key={s.id}
          style={{ opacity: restingAlpha }}
          className={cn(
            "group flex flex-col items-center gap-1.5 rounded-lg px-3 py-2 transition-all",
            "text-muted-foreground hover:!opacity-100 hover:text-gold focus:!opacity-100 focus:text-gold focus:outline-none",
          )}
        >
          <span className="font-display text-base leading-none tracking-[0.2em]">
            {s.glyph}
          </span>
          <span className="font-display text-[11px] italic tracking-wide">
            {s.label}
          </span>
        </button>
      ))}
    </div>
  );
}