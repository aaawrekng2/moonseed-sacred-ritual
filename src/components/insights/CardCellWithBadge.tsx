/**
 * Q57 — Canonical card cell with optional count badge and optional name.
 * Used app-wide so future surfaces inherit the pattern.
 */
import { CardImage } from "@/components/card/CardImage";
import { useElementWidth } from "@/lib/use-element-width";

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
        {count !== undefined && (
          <span
            style={{
              position: "absolute",
              minWidth: "clamp(28px, 8vw, 36px)",
              height: "clamp(28px, 8vw, 36px)",
              bottom: "calc(clamp(28px, 8vw, 36px) / -2)",
              right: "calc(clamp(28px, 8vw, 36px) / -2)",
              background: "var(--gold)",
              color: "var(--background)",
              borderRadius: 999,
              border: "2px solid var(--background)",
              padding: "0 8px",
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "clamp(12px, 3.2vw, 14px)",
              fontWeight: 500,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              lineHeight: 1,
              whiteSpace: "nowrap",
            }}
          >
            {count}×
          </span>
        )}
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
