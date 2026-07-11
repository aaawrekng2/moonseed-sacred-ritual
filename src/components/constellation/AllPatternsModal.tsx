/**
 * v3.34 — All-patterns modal.
 *
 * Lists every detected pattern across all cards in one place. Sort is two-tier:
 * UNREAD first (strongest-first within), then READ (strongest-first within), so a
 * freshly detected pattern always surfaces to the top and settles into its
 * strength position once opened. Each row shows the card, the lens, a Balanced
 * strength bar, and the on-target count; tapping a row isolates that pattern.
 *
 * Read/unread is driven by the shared seen_patterns set (pattern ids the seeker
 * has opened). This component is presentational — the page owns the seen set and
 * the drill-down.
 */
import { createPortal } from "react-dom";
import type { PatternResult, LensKey } from "@/lib/pattern-detect";

const LENS_LABEL: Record<LensKey | "asterism" | "stalker", string> = {
  moon: "Moon phase",
  day: "Day of month",
  numerology: "Numerology",
  weekday: "Weekday",
  asterism: "Together",
  stalker: "Stalker",
};

/** Balanced bar fill 0..1 from lift — log-scaled so big lifts don't blow out. */
function strengthFill(lift: number): number {
  return Math.max(0.08, Math.min(1, Math.log(lift) / Math.log(12)));
}

/** Row title. Asterisms show the co-occurring group; everything else the card. */
function primaryLabel(p: PatternResult, cardName: (id: number) => string): string {
  if (p.lens === "asterism" && p.groupCardIds && p.groupCardIds.length)
    return p.groupCardIds.map(cardName).join(" + ");
  if (p.cardId != null) return cardName(p.cardId);
  return p.bucketLabel;
}

/** Row caption — the signal, phrased per pattern kind. */
function captionLine(p: PatternResult): string {
  if (p.lens === "asterism")
    return `Together · ${p.exactHits} pulls · ${p.lift.toFixed(1)}× chance`;
  if (p.lens === "stalker")
    return `Stalker · ${p.exactHits} of ${p.draws} readings`;
  return `${LENS_LABEL[p.lens]} · ${p.bucketLabel} · ${p.exactHits} of ${p.draws}`;
}

export function AllPatternsModal({
  patterns,
  seenIds,
  cardName,
  onSelect,
  onClose,
}: {
  patterns: PatternResult[];
  seenIds: Set<string>;
  cardName: (cardId: number) => string;
  onSelect: (pattern: PatternResult) => void;
  onClose: () => void;
}) {
  // patterns arrive strongest-first (sorted by pValue). Two-tier: unseen, then seen.
  const unseen = patterns.filter((p) => !seenIds.has(p.patternId));
  const seen = patterns.filter((p) => seenIds.has(p.patternId));
  const ordered = [...unseen, ...seen];

  const body = (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: "var(--z-modal, 100)" as unknown as number,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "8vh 16px 16px",
        overflowY: "auto",
      }}
      className="modal-scrim"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 460,
          background: "var(--surface-card)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-lg, 16px)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 18px 12px",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontStyle: "italic",
              fontSize: "var(--text-heading-md)",
              color: "var(--color-foreground)",
            }}
          >
            Patterns
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "var(--color-foreground)",
              opacity: 0.7,
              padding: 4,
              fontSize: 18,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {ordered.length === 0 ? (
          <div
            style={{
              padding: "28px 18px",
              textAlign: "center",
              fontStyle: "italic",
              color: "var(--color-foreground-muted)",
              fontSize: "var(--text-body-sm)",
            }}
          >
            No patterns yet — they emerge as your history grows.
          </div>
        ) : (
          <div style={{ maxHeight: "64vh", overflowY: "auto" }}>
            {ordered.map((p) => {
              const isUnseen = !seenIds.has(p.patternId);
              const fill = strengthFill(p.lift);
              return (
                <button
                  key={p.patternId}
                  type="button"
                  onClick={() => onSelect(p)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 18px",
                    background: "transparent",
                    border: "none",
                    borderBottom: "1px solid var(--border-subtle)",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      flexShrink: 0,
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: "var(--pattern-highlight)",
                      opacity: isUnseen ? 1 : 0.3,
                    }}
                  />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        display: "block",
                        fontFamily: "var(--font-display)",
                        fontStyle: "italic",
                        fontSize: "var(--text-body)",
                        color: "var(--color-foreground)",
                        opacity: isUnseen ? 1 : 0.55,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {primaryLabel(p, cardName)}
                    </span>
                    <span
                      style={{
                        display: "block",
                        fontSize: "var(--text-caption)",
                        color: "var(--color-foreground-muted)",
                      }}
                    >
                      {captionLine(p)}
                    </span>
                  </span>
                  <span
                    aria-label={`Strength ${Math.round(fill * 100)}%`}
                    style={{
                      flexShrink: 0,
                      width: 56,
                      height: 6,
                      borderRadius: 3,
                      background: "var(--border-default)",
                      overflow: "hidden",
                    }}
                  >
                    <span
                      style={{
                        display: "block",
                        width: `${Math.round(fill * 100)}%`,
                        height: "100%",
                        background: "var(--pattern-highlight)",
                        opacity: isUnseen ? 1 : 0.55,
                      }}
                    />
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(body, document.body);
}
