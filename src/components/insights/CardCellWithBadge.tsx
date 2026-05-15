/**
 * Q57 — Canonical card cell with optional count badge and optional name.
 * Used app-wide so future surfaces inherit the pattern.
 */
import { CardImage } from "@/components/card/CardImage";
import { useElementWidth } from "@/lib/use-element-width";
import { CardCountBadge } from "@/components/ui/CardCountBadge";

export function CardCellWithBadge({
  cardId,
  count,
  name,
  onClick,
}: {
  cardId: number;
  count?: number;
  name?: string;
  onClick?: () => void;
}) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  return (
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
      <div ref={ref} style={{ position: "relative", width: "100%" }}>
        {width > 0 && (
          <CardImage cardId={cardId} size="custom" widthPx={Math.round(width)} />
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
}
