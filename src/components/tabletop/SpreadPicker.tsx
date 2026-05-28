/**
 * EJ69/EJ70 — SpreadPicker.
 *
 * Chevron-only trigger rendered beneath the slot rail on the Tabletop.
 * Matches the Manual Entry SpreadDropdown behavior: no label text on
 * the trigger (just a chevron), the position names appear UNDER the
 * slot cards (via the slot rail's own label rendering), and the
 * dropdown lists every spread option.
 *
 * Options mirror the Manual Entry SPREADS list: No spread / Single /
 * Three Card / Celtic Cross / Yes-No / Horseshoe / Relationship /
 * Year Ahead / Cross of Decision / Custom.
 *
 * Behavior (EJ70):
 *  - Picking a named spread grows/sets the slot count. Picks are
 *    preserved where positions overlap (parent handles the navigation
 *    + pick preservation).
 *  - Growing never loses picks, so no confirm. Shrinking with picks
 *    placed fires a confirmation dialog first.
 *  - "No spread" keeps the current slot count and only clears the
 *    position labels (non-destructive).
 */
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { SpreadMode } from "@/lib/spreads";
import { SPREAD_META, getSpreadCount } from "@/lib/spreads";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type SpreadPickerSelection = SpreadMode | "none";

export type SpreadPickerProps = {
  /** Current spread mode. */
  current: SpreadMode;
  /** True when the seeker has placed at least one card; gates the confirm. */
  hasPicks: boolean;
  /** Custom-count value (for count math when current spread is custom). */
  customCount?: number;
  /** Called when the seeker chooses a new spread. Parent handles navigation. */
  onChange: (next: SpreadPickerSelection) => void;
};

// EJ70 — Mirror the Manual Entry SPREADS list order. "none" first,
// "custom" last; the named spreads in between.
const OPTIONS: { value: SpreadPickerSelection; label: string }[] = [
  { value: "none", label: "No spread" },
  { value: "single", label: "Single" },
  { value: "three", label: "Three Card" },
  { value: "celtic", label: "Celtic Cross" },
  { value: "yes_no", label: "Yes / No" },
  { value: "horseshoe", label: "Horseshoe" },
  { value: "relationship", label: "Relationship" },
  { value: "year_ahead", label: "Year Ahead" },
  { value: "cross_of_decision", label: "Cross of Decision" },
  { value: "custom", label: "Custom" },
];

export function SpreadPicker({
  current,
  hasPicks,
  customCount,
  onChange,
}: SpreadPickerProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<SpreadPickerSelection | null>(null);

  const currentCount =
    current === "custom" ? (customCount ?? 3) : getSpreadCount(current);

  const handlePick = (next: SpreadPickerSelection) => {
    setOpen(false);
    if (next === current) return;
    if (next === "none") {
      // No slot-count change; labels-only update is non-destructive.
      onChange(next);
      return;
    }
    const nextCount =
      next === "custom" ? currentCount : getSpreadCount(next as SpreadMode);
    const shrinking = nextCount < currentCount;
    if (hasPicks && shrinking) {
      setPending(next);
      return;
    }
    onChange(next);
  };

  const confirmPick = () => {
    if (pending) onChange(pending);
    setPending(null);
  };

  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          marginTop: 6,
          marginBottom: 4,
        }}
      >
        <div style={{ position: "relative" }}>
          {/* EJ70 — Chevron-only trigger. No label text (matches Manual
              Entry's SpreadDropdown). The position names render under
              the slot cards, not here. */}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label="Choose spread"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 28,
              height: 28,
              padding: 0,
              background: "transparent",
              border: "none",
              color: "var(--accent, var(--gold))",
              opacity: 0.7,
              cursor: "pointer",
              touchAction: "manipulation",
            }}
          >
            <ChevronDown size={18} aria-hidden />
          </button>
          {open && (
            <>
              {/* Click-outside scrim */}
              <button
                type="button"
                aria-label="Close spread picker"
                onClick={() => setOpen(false)}
                style={{
                  position: "fixed",
                  inset: 0,
                  background: "transparent",
                  border: "none",
                  cursor: "default",
                  zIndex: 49,
                }}
              />
              <ul
                role="listbox"
                style={{
                  position: "absolute",
                  bottom: "calc(100% + 4px)",
                  left: "50%",
                  transform: "translateX(-50%)",
                  minWidth: 190,
                  zIndex: 50,
                  background: "var(--surface-elevated)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 8,
                  boxShadow: "0 12px 28px rgba(0,0,0,0.45)",
                  padding: 4,
                  listStyle: "none",
                  margin: 0,
                  maxHeight: 320,
                  overflowY: "auto",
                }}
              >
                {OPTIONS.map((opt) => {
                  const isActive = opt.value === current;
                  const sub =
                    opt.value === "none"
                      ? null
                      : opt.value === "custom"
                        ? null
                        : `${getSpreadCount(opt.value as SpreadMode)} ${
                            getSpreadCount(opt.value as SpreadMode) === 1
                              ? "card"
                              : "cards"
                          }`;
                  return (
                    <li key={opt.value}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        onClick={() => handlePick(opt.value)}
                        style={{
                          width: "100%",
                          display: "flex",
                          alignItems: "baseline",
                          justifyContent: "space-between",
                          gap: 12,
                          padding: "8px 12px",
                          background: isActive
                            ? "color-mix(in oklab, var(--accent, var(--gold)) 12%, transparent)"
                            : "transparent",
                          border: "none",
                          borderRadius: 6,
                          fontFamily: "var(--font-serif)",
                          fontStyle: isActive ? "italic" : "normal",
                          fontSize: "var(--text-body-sm)",
                          color: "var(--color-foreground)",
                          textAlign: "left",
                          cursor: "pointer",
                          touchAction: "manipulation",
                        }}
                      >
                        <span>{opt.label}</span>
                        {sub && (
                          <span style={{ opacity: 0.5, fontSize: 11 }}>{sub}</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </div>

      <AlertDialog
        open={pending !== null}
        onOpenChange={(o) => !o && setPending(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change spread?</AlertDialogTitle>
            <AlertDialogDescription>
              Switching to a smaller spread will discard cards beyond the
              new slot count. This can&rsquo;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay</AlertDialogCancel>
            <AlertDialogAction onClick={confirmPick}>
              Change spread
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
