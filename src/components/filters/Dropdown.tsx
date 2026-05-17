/**
 * Q56 — Shared dropdown used by the Insights filter bar (time range)
 * and Cards-tab controls (Group By / Sort By). Italic serif trigger
 * with a portaled popover. Backwards-compatible shape — pass an empty
 * `prefix` for prefix-less dropdowns (e.g. time range).
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";

export type DropdownOption = { value: string; label: string };

export function Dropdown({
  prefix,
  value,
  options,
  onChange,
}: {
  prefix?: string;
  value: string;
  options: ReadonlyArray<DropdownOption>;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(
    null,
  );

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setCoords({ left: r.left, top: r.bottom + 4 });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      const el = t as HTMLElement;
      if (el.closest?.("[data-shared-dropdown-popover]")) return;
      setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const current = options.find((o) => o.value === value);
  const hasPrefix = prefix && prefix.length > 0;

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-xs"
        style={{
          color: "var(--color-foreground)",
          opacity: 0.85,
          fontStyle: "italic",
        }}
      >
        {hasPrefix && (
          <span style={{ opacity: 0.8 }}>{prefix}:&nbsp;</span>
        )}
        <span>{current?.label ?? value}</span>
        <ChevronDown
          className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && coords && typeof document !== "undefined" &&
        createPortal(
          <div
            data-shared-dropdown-popover
            className="fixed min-w-[10rem] overflow-hidden rounded-md border shadow-lg"
            style={{
              left: coords.left,
              top: coords.top,
              background: "var(--surface-elevated)",
              borderColor: "var(--border-subtle)",
              zIndex: "var(--z-drawer)",
            }}
          >
            {options.map((o) => {
              const active = o.value === value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className="block w-full px-3 py-1 text-left text-xs"
                  style={{
                    color: active ? "var(--gold)" : "var(--color-foreground)",
                    opacity: 1,
                    fontStyle: "italic",
                    borderBottom: active
                      ? "1px solid var(--gold)"
                      : "1px solid transparent",
                  }}
                >
                  {o.label}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}