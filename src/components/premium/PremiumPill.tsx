import { cn } from "@/lib/utils";

/**
 * "🔒 Premium" outlined pill.
 *
 * In Moonseed premium is always unlocked, so this is rarely shown — but it
 * is exported for source-bundle parity and used as a visual tag in spots
 * where the spec calls for a "locked state" placeholder. Pair with a tap
 * target that opens {@link PremiumModal} when needed.
 */
export function PremiumPill({
  className,
  size = "sm",
}: {
  className?: string;
  size?: "sm" | "xs";
}) {
  return (
    <span
      aria-label="Premium feature"
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border border-gold/60 bg-transparent text-gold",
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-1.5 py-0.5 text-[10px]",
        className,
      )}
    >
      <span aria-hidden className="leading-none">
        🔒
      </span>
      <span className="font-normal leading-none">Premium</span>
    </span>
  );
}