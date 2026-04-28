/**
 * Phase 8 — Mist invitation.
 *
 * A purely-CSS atmospheric mist that sits beneath the standard reading
 * + enrichment panel. Tapping anywhere inside it begins the Deep
 * Reading flow. Visual intensity (0-4) communicates how much pattern
 * data has accumulated. No images, no canvas, no libraries.
 */
import { type MistIntensity } from "@/lib/deep-reading";

type MistProps = {
  level: MistIntensity;
  whisper: string;
  onTap: () => void;
  /** Disable the tap target while a deep reading is loading or already open. */
  disabled?: boolean;
  /** ARIA label for accessibility. */
  ariaLabel?: string;
};

export function DeepReadingMist({
  level,
  whisper,
  onTap,
  disabled,
  ariaLabel,
}: MistProps) {
  return (
    <button
      type="button"
      className="deep-mist"
      data-level={level}
      data-disabled={disabled ? "true" : undefined}
      onClick={() => {
        if (!disabled) onTap();
      }}
      aria-label={ariaLabel ?? "Open Deep Reading"}
      disabled={disabled}
    >
      {/* Two layered mist plates drift at different speeds so the
          motion never quite repeats. The third plate is the gold-thread
          pass — only visible at level 3+. */}
      <span className="deep-mist__plate deep-mist__plate--a" aria-hidden />
      <span className="deep-mist__plate deep-mist__plate--b" aria-hidden />
      {level >= 3 && (
        <span className="deep-mist__threads" aria-hidden />
      )}
      <span className="deep-mist__text">{whisper}</span>
    </button>
  );
}