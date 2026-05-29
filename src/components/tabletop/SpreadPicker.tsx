/**
 * EK05 — SpreadPicker (standalone, leaf module).
 *
 * Inline chevron + portaled dropdown for selecting which spread is
 * active. Reused on both the draw table (Tabletop.tsx) and manual
 * entry (ManualEntryBuilder.tsx) so the seeker has a consistent
 * surface to switch spread type.
 *
 * Earlier the picker was inlined inside Tabletop.tsx (EJ72 note:
 * "Defined in this module so it shares Tabletop's chunk init
 * exactly") because an earlier extraction caused a chunk-init cycle.
 * The cycle was: Tabletop → SpreadPicker → spreads.ts → back into
 * something Tabletop already imported. Avoided here by keeping this
 * module as a leaf: it only imports from leaf utilities (lucide,
 * spreads, react, react-dom) — never from Tabletop or
 * ManualEntryBuilder.
 *
 * The dropdown portals to document.body via createPortal so it
 * escapes every ancestor stacking context AND every transformed
 * ancestor (controlsRow uses `transform: translateY(...)`, which
 * would otherwise anchor `position: fixed` to the transformed box
 * instead of the viewport).
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { SPREAD_META, getSpreadCount, type SpreadMode } from "@/lib/spreads";

export type SpreadPickerSelection = SpreadMode | "none";

export const SPREAD_PICKER_OPTIONS: { value: SpreadPickerSelection; label: string }[] = [
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
}: {
  current: SpreadMode;
  hasPicks: boolean;
  customCount?: number;
  onChange: (next: SpreadPickerSelection) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<SpreadPickerSelection | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [anchor, setAnchor] = useState<{ left: number; top: number; width: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const updateAnchor = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      setAnchor({
        left: r.left + r.width / 2,
        top: r.top,
        width: r.width,
      });
    };
    updateAnchor();
    window.addEventListener("scroll", updateAnchor, true);
    window.addEventListener("resize", updateAnchor);
    return () => {
      window.removeEventListener("scroll", updateAnchor, true);
      window.removeEventListener("resize", updateAnchor);
    };
  }, [open]);

  const currentCount =
    current === "custom" ? (customCount ?? 3) : getSpreadCount(current);

  const handlePick = (next: SpreadPickerSelection) => {
    setOpen(false);
    if (next === current) return;
    if (next === "none") {
      onChange(next);
      return;
    }
    if (hasPicks) {
      const nextCount =
        next === "custom" ? customCount ?? 3 : getSpreadCount(next as SpreadMode);
      if (nextCount < currentCount) {
        // Confirm — switching to a smaller spread would lose picks.
        setPending(next);
        return;
      }
    }
    onChange(next);
  };

  const confirmPick = () => {
    if (pending !== null) {
      onChange(pending);
      setPending(null);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Choose spread"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 22,
          height: 22,
          padding: 0,
          background: "transparent",
          border: "none",
          color: "var(--accent, var(--gold))",
          opacity: 0.7,
          cursor: "pointer",
          touchAction: "manipulation",
        }}
      >
        <ChevronDown size={16} aria-hidden />
      </button>
      {open &&
        anchor &&
        typeof document !== "undefined" &&
        createPortal(
          <>
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
                zIndex: 9998,
              }}
            />
            <ul
              role="listbox"
              style={{
                position: "fixed",
                left: anchor.left,
                top: anchor.top - 4,
                transform: "translate(-50%, -100%)",
                minWidth: 190,
                zIndex: 9999,
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
              {SPREAD_PICKER_OPTIONS.map((opt) => {
                const isActive = opt.value === current;
                const sub =
                  opt.value === "none" || opt.value === "custom"
                    ? null
                    : `${getSpreadCount(opt.value as SpreadMode)} ${
                        getSpreadCount(opt.value as SpreadMode) === 1 ? "card" : "cards"
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
                      {sub && <span style={{ opacity: 0.5, fontSize: 11 }}>{sub}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>,
          document.body,
        )}
      {pending !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="spread-picker-confirm-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9990,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            background: "rgba(0,0,0,0.55)",
          }}
          onClick={() => setPending(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: 340,
              width: "100%",
              background: "var(--surface-elevated)",
              border: "1px solid var(--border-default)",
              borderRadius: 12,
              padding: 18,
              boxShadow: "0 18px 48px rgba(0,0,0,0.55)",
              fontFamily: "var(--font-serif)",
              color: "var(--color-foreground)",
            }}
          >
            <h2
              id="spread-picker-confirm-title"
              style={{
                margin: 0,
                fontSize: "var(--text-heading-sm)",
                fontStyle: "italic",
                color: "var(--accent, var(--gold))",
              }}
            >
              Switch spread?
            </h2>
            <p
              style={{
                marginTop: 8,
                marginBottom: 14,
                fontSize: "var(--text-body-sm)",
                lineHeight: 1.45,
                opacity: 0.85,
              }}
            >
              Switching to{" "}
              <em>
                {SPREAD_PICKER_OPTIONS.find((o) => o.value === pending)?.label ?? "this spread"}
              </em>{" "}
              uses fewer slots than{" "}
              <em>{SPREAD_META[current]?.label ?? current}</em>. Some picks will be lost.
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setPending(null)}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: "1px solid var(--border-subtle)",
                  background: "transparent",
                  color: "var(--color-foreground)",
                  fontFamily: "var(--font-serif)",
                  fontSize: "var(--text-body-sm)",
                  cursor: "pointer",
                  touchAction: "manipulation",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmPick}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: "1px solid var(--accent, var(--gold))",
                  background:
                    "color-mix(in oklab, var(--accent, var(--gold)) 14%, transparent)",
                  color: "var(--color-foreground)",
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: "var(--text-body-sm)",
                  cursor: "pointer",
                  touchAction: "manipulation",
                }}
              >
                Switch
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
