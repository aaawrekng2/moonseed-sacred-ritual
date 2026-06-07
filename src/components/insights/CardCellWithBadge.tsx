/**
 * Q57 — Canonical card cell with optional count badge and optional name.
 * Used app-wide so future surfaces inherit the pattern.
 */
import { CardImage } from "@/components/card/CardImage";
import { useElementWidth } from "@/lib/use-element-width";
import { CardCountBadge } from "@/components/ui/CardCountBadge";
import { CardHoverTip } from "@/components/card/CardRichPopover";

export function CardCellWithBadge({
  cardId,
  count,
  name,
  onClick,
  eager,
  richHoverCardId,
}: {
  cardId: number;
  count?: number;
  name?: string;
  onClick?: () => void;
  /** Q94 #6 — opt the inner CardImage out of lazy loading. */
  eager?: boolean;
  /** EK60 — when set, wrap the cell in the rich card hover tip. Opt-in so
   *  only surfaces that want it (Insights → Cards) get it. */
  richHoverCardId?: number;
}) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const cell = (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      style={{
        background: "transparent",
        border: "none",
        padding: 0,
        cursor: onClick ? "pointer" : "default",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        width: "100%",
      }}
    >
      <div
        ref={ref}
        style={{ position: "relative", width: "100%", containerType: "inline-size" }}
      >
        {width > 0 && (
          <CardImage cardId={cardId} size="custom" widthPx={Math.round(width)} eager={eager} />
        )}
        {count !== undefined && <CardCountBadge count={count} />}
      </div>
      {name !== undefined && (
        <span
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-caption)",
            textAlign: "center",
            opacity: 0.85,
            marginTop: 8,
          }}
        >
          {name}
        </span>
      )}
    </button>
  );

  if (richHoverCardId !== undefined) {
    return <CardHoverTip cardId={richHoverCardId}>{cell}</CardHoverTip>;
  }
  return cell;
}
