/**
 * PulledCard (v3.134)
 *
 * Shared badged card tile for the Overview. The count badge matches the
 * constellation gold pull badge (AtlasWeb EK104): a solid gold disc with dark
 * serif text, floating just outside the card's bottom-right corner. Used by the
 * hero card (StalkerMeterRow) and the most-pulled strip (MostPulledStrip).
 */
import { CardImage } from "@/components/card/CardImage";

export function CountBadge({
  count,
  big,
  title,
}: {
  count: number;
  big?: boolean;
  title?: string;
}) {
  const size = big ? 26 : 20;
  return (
    <div
      title={title}
      style={{
        position: "absolute",
        right: 0,
        bottom: 0,
        transform: "translate(50%, 50%)",
        zIndex: 5,
        width: size,
        height: size,
        borderRadius: 9999,
        background:
          "color-mix(in oklab, var(--gold, var(--accent)) 90%, var(--surface-card) 10%)",
        border:
          "1px solid color-mix(in oklab, var(--color-foreground) 14%, transparent)",
        boxShadow: "0 1px 3px rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--background)",
        fontFamily: "var(--font-serif)",
        fontStyle: "italic",
        fontSize: big ? 12 : 11,
        lineHeight: 1,
        cursor: "help",
      }}
    >
      {count}
    </div>
  );
}

export function PulledCard({
  cardId,
  cardName,
  count,
  widthPx,
  big,
  title,
  onClick,
  faded,
}: {
  cardId: number;
  cardName: string;
  count: number;
  widthPx: number;
  big?: boolean;
  title?: string;
  onClick?: () => void;
  faded?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        position: "relative",
        display: "block",
        flexShrink: 0,
        width: widthPx,
        minHeight: Math.round(widthPx * 1.5),
        padding: 0,
        border: "none",
        background: "none",
        cursor: "pointer",
        lineHeight: 0,
      }}
      aria-label={`${cardName}, drawn ${count} times — open card trace`}
    >
      <span style={{ display: "block", lineHeight: 0, opacity: faded ? 0.4 : 1 }}>
        <CardImage cardId={cardId} size="custom" widthPx={widthPx} />
      </span>
      <CountBadge count={count} big={big} title={title} />
    </button>
  );
}
