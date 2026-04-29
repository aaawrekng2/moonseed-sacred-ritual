/**
 * Collapsing color chip row for the Share Builder.
 *
 * Resting state: shows ONLY the currently selected chip.
 * Tap to expand → all chips render in a single horizontal row.
 * Pick one → collapses back to just the selected chip.
 *
 * Color affects the accent/glow only; layout is fixed per level.
 */
import { useEffect, useRef, useState } from "react";
import { SHARE_COLORS, type ShareColorId } from "./share-types";

export function ColorChipSelector({
  value,
  onChange,
}: {
  value: ShareColorId;
  onChange: (next: ShareColorId) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Click-outside closes the expanded row.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDoc);
    return () => window.removeEventListener("mousedown", onDoc);
  }, [open]);

  const selected = SHARE_COLORS.find((c) => c.id === value) ?? SHARE_COLORS[0];
  const chips = open ? SHARE_COLORS : [selected];

  return (
    <div
      ref={ref}
      className="flex items-center gap-2"
      style={{ minHeight: 32 }}
    >
      {chips.map((c) => {
        const isSelected = c.id === value;
        return (
          <button
            key={c.id}
            type="button"
            aria-label={`${c.label}${isSelected ? " (selected)" : ""}`}
            aria-pressed={isSelected}
            onClick={() => {
              if (!open) {
                setOpen(true);
                return;
              }
              onChange(c.id);
              setOpen(false);
            }}
            style={{
              width: 24,
              height: 24,
              borderRadius: 999,
              padding: 0,
              background: c.accent,
              border: isSelected
                ? "2px solid var(--color-foreground)"
                : "1px solid var(--border-default)",
              boxShadow: isSelected ? `0 0 12px ${c.glow}` : "none",
              cursor: "pointer",
              transition: "transform 120ms ease, box-shadow 120ms ease",
            }}
          />
        );
      })}
    </div>
  );
}
