/**
 * EJ5 — Gear icon placed next to every ⓘ on the /constellation
 * surface. Clicking opens a small menu of hide options:
 *
 *   - 15 minutes
 *   - 1 day
 *   - 1 week
 *   - Hide until enabled  ← turns the master toggle off
 *
 * The menu always appears regardless of whether tips are currently
 * shown or hidden — the seeker can re-up a snooze at any time.
 */
import { useEffect, useRef, useState } from "react";
import { Settings } from "lucide-react";
import {
  useConstellationHoverTips,
  SNOOZE_DURATIONS,
} from "@/lib/use-constellation-hover-tips";

export function HoverTipsGear() {
  const { snoozeFor, disableUntilEnabled } = useConstellationHoverTips();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent) => {
      if (
        wrapRef.current &&
        ev.target instanceof Node &&
        !wrapRef.current.contains(ev.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const item: React.CSSProperties = {
    display: "block",
    width: "100%",
    padding: "6px 10px",
    background: "transparent",
    border: "none",
    textAlign: "left",
    fontFamily: "var(--font-serif)",
    fontSize: "var(--text-body-sm)",
    color: "var(--color-foreground)",
    cursor: "pointer",
    borderRadius: 4,
  };

  return (
    <span
      ref={wrapRef}
      style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-label="Hover-tip options"
        aria-expanded={open}
        style={{
          padding: 2,
          border: "none",
          background: "transparent",
          cursor: "pointer",
          color: "var(--color-foreground-muted, var(--color-foreground))",
          display: "inline-flex",
          alignItems: "center",
          opacity: 0.7,
        }}
      >
        <Settings size={13} strokeWidth={1.5} />
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            zIndex: "var(--z-popover, 50)" as unknown as number,
            minWidth: 180,
            padding: 4,
            background: "var(--surface-card)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 6,
            boxShadow: "0 4px 18px rgba(0,0,0,0.35)",
          }}
        >
          <div
            style={{
              padding: "6px 10px 4px",
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-caption, 11px)",
              color: "var(--color-foreground-muted, var(--color-foreground))",
              opacity: 0.7,
              borderBottom: "1px solid var(--border-subtle)",
              marginBottom: 4,
            }}
          >
            Hide hover tips for…
          </div>
          <button
            type="button"
            role="menuitem"
            style={item}
            onClick={() => {
              snoozeFor(SNOOZE_DURATIONS.fifteenMinutes);
              setOpen(false);
            }}
          >
            Hide for 15 minutes
          </button>
          <button
            type="button"
            role="menuitem"
            style={item}
            onClick={() => {
              snoozeFor(SNOOZE_DURATIONS.oneDay);
              setOpen(false);
            }}
          >
            Hide for 1 day
          </button>
          <button
            type="button"
            role="menuitem"
            style={item}
            onClick={() => {
              snoozeFor(SNOOZE_DURATIONS.oneWeek);
              setOpen(false);
            }}
          >
            Hide for 1 week
          </button>
          <button
            type="button"
            role="menuitem"
            style={item}
            onClick={() => {
              disableUntilEnabled();
              setOpen(false);
            }}
          >
            Hide until enabled
          </button>
        </div>
      )}
    </span>
  );
}
