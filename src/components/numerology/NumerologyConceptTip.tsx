/**
 * EK70 — Numerology concept hover card.
 *
 * Wraps any labeled item on the numerology surface. On hover (or tap on
 * touch, or focus) it surfaces a four-part card:
 *   1. what the concept IS (plain language, from NUMEROLOGY_CONCEPTS)
 *   2. how it's derived (caption)
 *   3. the seeker's number for that item (accent badge)
 *   4. that number's meaning (reused from the existing meaning maps)
 *
 * One component, one copy table, the theme accent throughout — no
 * per-category colors (styling doc: accent for accents, theme owns it).
 *
 * The popover has pointer-events: none, so it can never block a click on
 * the item underneath — it's purely informational.
 */
import { useCallback, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  NUMBER_MEANINGS,
  NUMEROLOGY_CONCEPTS,
  type NumerologyConceptKey,
} from "@/lib/numerology-copy";

type Placement = "above" | "below";

export function NumerologyConceptTip({
  concept,
  value,
  meaning,
  block = false,
  children,
}: {
  /** Which concept this item represents — keys NUMEROLOGY_CONCEPTS. */
  concept: NumerologyConceptKey;
  /** The number shown in the badge (digit, master number, "13", a letter…). */
  value?: string | number | null;
  /**
   * The meaning string for `value`. When omitted and `value` is a number,
   * the card falls back to NUMBER_MEANINGS[value].full — correct for the
   * concepts that use the single-digit table (most of them). Concepts with
   * their own map (Personal Year, Pinnacle, Challenge, Period Cycle, Karmic)
   * pass `meaning` explicitly.
   */
  meaning?: string | null;
  /** When true the wrapper stretches to fill a grid cell (height: 100%). */
  block?: boolean;
  children: ReactNode;
}) {
  const info = NUMEROLOGY_CONCEPTS[concept];
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{
    left: number;
    top: number;
    placement: Placement;
  } | null>(null);

  const resolvedMeaning =
    meaning ??
    (typeof value === "number" ? (NUMBER_MEANINGS[value]?.full ?? null) : null);

  const open = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const W = 280;
    const left = Math.min(
      Math.max(8, r.left + r.width / 2 - W / 2),
      window.innerWidth - W - 8,
    );
    // Prefer above; flip below when there isn't room (never overlap-blocking
    // anyway since the popover ignores pointer events).
    const placement: Placement = r.top > 240 ? "above" : "below";
    const top = placement === "above" ? r.top : r.bottom;
    setPos({ left, top, placement });
  }, []);

  const close = useCallback(() => setPos(null), []);

  return (
    <div
      ref={ref}
      onMouseEnter={open}
      onMouseLeave={close}
      onFocus={open}
      onBlur={close}
      onClick={() => (pos ? close() : open())}
      style={{
        cursor: "help",
        ...(block
          ? { height: "100%", display: "flex", flexDirection: "column" }
          : { display: "inline-block" }),
      }}
    >
      {children}
      {pos &&
        info &&
        createPortal(
          <div
            role="tooltip"
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top,
              transform:
                pos.placement === "above"
                  ? "translateY(-100%) translateY(-10px)"
                  : "translateY(10px)",
              width: 280,
              zIndex: "var(--z-popover)",
              background: "var(--surface-card)",
              border:
                "1px solid var(--accent-faint, var(--border-subtle))",
              borderRadius: "var(--radius-lg, 12px)",
              boxShadow: "0 0 28px -16px var(--accent, var(--gold))",
              padding: "14px 16px",
              fontFamily: "var(--font-serif)",
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <div>
                <div
                  style={{
                    color: "var(--color-foreground)",
                    fontSize: "var(--text-heading-sm, 17px)",
                    fontStyle: "italic",
                    lineHeight: 1.1,
                  }}
                >
                  {info.title}
                </div>
                <div
                  style={{
                    color: "var(--color-foreground-muted)",
                    fontSize: "var(--text-caption, 12px)",
                    marginTop: 3,
                  }}
                >
                  {info.subtitle}
                </div>
              </div>
              {value != null && value !== "" && (
                <div
                  style={{
                    flex: "none",
                    minWidth: 34,
                    height: 34,
                    padding: "0 7px",
                    borderRadius: 9999,
                    background:
                      "var(--accent-faint, color-mix(in oklab, var(--accent, var(--gold)) 16%, transparent))",
                    border: "1px solid var(--accent, var(--gold))",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--accent, var(--gold))",
                    fontSize: 17,
                    fontStyle: "italic",
                  }}
                >
                  {value}
                </div>
              )}
            </div>

            <div
              style={{
                color: "var(--color-foreground)",
                fontSize: "var(--text-body-sm, 13.5px)",
                lineHeight: 1.55,
                marginTop: 12,
              }}
            >
              {info.whatIs}
            </div>

            <div
              style={{
                color: "var(--color-foreground-muted)",
                fontSize: "var(--text-caption, 11.5px)",
                fontStyle: "italic",
                marginTop: 10,
              }}
            >
              ↳ {info.derived}
            </div>

            {resolvedMeaning && (
              <>
                <div
                  style={{
                    borderTop: "1px solid var(--border-subtle)",
                    margin: "12px 0 10px",
                  }}
                />
                {value != null && value !== "" && (
                  <div
                    style={{
                      color: "var(--accent, var(--gold))",
                      fontSize: "var(--text-caption, 12px)",
                      fontStyle: "italic",
                      marginBottom: 3,
                    }}
                  >
                    Your {value}
                  </div>
                )}
                <div
                  style={{
                    color: "var(--color-foreground)",
                    fontSize: "var(--text-body-sm, 13px)",
                    lineHeight: 1.5,
                  }}
                >
                  {resolvedMeaning}
                </div>
              </>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
