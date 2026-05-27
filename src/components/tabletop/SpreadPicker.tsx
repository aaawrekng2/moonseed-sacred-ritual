/**
 * EJ69 — SpreadPicker.
 *
 * Dropdown rendered beneath the slot rail on the Tabletop. Lets the
 * seeker change spread types mid-draw without navigating away from
 * the table. Options: None (clears position labels but keeps slot
 * count), 1 card, 3 cards, Celtic Cross, Custom.
 *
 * Confirmation guard: when switching to a spread with fewer slots
 * AND the seeker has any picks placed, fire a confirmation dialog
 * before committing the change. Picks beyond the new slot count
 * would be lost.
 */
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { SpreadMode } from "@/lib/spreads";
import { SPREAD_META } from "@/lib/spreads";
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
  /** Current spread mode. "none" if labels are cleared. */
  current: SpreadMode;
  /** True when the seeker has placed at least one card; gates the confirm. */
  hasPicks: boolean;
  /** Custom-count value (for label display only). */
  customCount?: number;
  /** Called when the seeker chooses a new spread. Parent handles navigation. */
  onChange: (next: SpreadPickerSelection) => void;
};

const OPTIONS: { value: SpreadPickerSelection; label: string; count: number | null }[] = [
  { value: "none", label: "No spread", count: null },
  { value: "daily", label: "1 card", count: 1 },
  { value: "three", label: "3 cards", count: 3 },
  { value: "celtic", label: "Celtic Cross", count: 10 },
  { value: "custom", label: "Custom…", count: null },
];

export function SpreadPicker({
  current,
  hasPicks,
  customCount,
  onChange,
}: SpreadPickerProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<SpreadPickerSelection | null>(null);

  const currentLabel = (() => {
    if (current === "custom") {
      return customCount ? `Custom · ${customCount} cards` : "Custom";
    }
    return SPREAD_META[current]?.label ?? "Spread";
  })();

  // Count of the currently-displayed spread; "none" treated as
  // current's count since slot count doesn't change for "none".
  const currentCount = current === "custom"
    ? (customCount ?? 3)
    : (SPREAD_META[current]?.count ?? 1);

  const handlePick = (next: SpreadPickerSelection) => {
    setOpen(false);
    if (next === current) return;
    if (next === "none") {
      // No slot-count change; labels-only update is non-destructive.
      onChange(next);
      return;
    }
    // Determine whether this switch shrinks the slot count and would
    // lose existing picks. Custom is unknown at decision time; assume
    // no shrink so the parent's count UI handles it.
    const nextCount =
      next === "custom"
        ? currentCount
        : (SPREAD_META[next as SpreadMode]?.count ?? 1);
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
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={open}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              background: "transparent",
              border: "1px solid var(--border-subtle)",
              borderRadius: 999,
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-caption)",
              color: "var(--color-foreground)",
              opacity: 0.75,
              cursor: "pointer",
              touchAction: "manipulation",
            }}
          >
            {currentLabel}
            <ChevronDown size={12} aria-hidden />
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
                  minWidth: 180,
                  zIndex: 50,
                  background: "var(--surface-elevated)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 8,
                  boxShadow: "0 12px 28px rgba(0,0,0,0.45)",
                  padding: 4,
                  listStyle: "none",
                  margin: 0,
                }}
              >
                {OPTIONS.map((opt) => {
                  const isActive = opt.value === current;
                  return (
                    <li key={opt.value}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        onClick={() => handlePick(opt.value)}
                        style={{
                          width: "100%",
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
                        {opt.label}
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
