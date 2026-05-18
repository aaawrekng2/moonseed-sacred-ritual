import { ChevronRight } from "lucide-react";
import { formatDateShort, formatTimeAgo } from "@/lib/dates";
import { SPREAD_META, isValidSpreadMode } from "@/lib/spreads";

type ReadingRowProps = {
  readingId: string;
  question: string | null | undefined;
  cardIds: number[];
  createdAt: string;
  /** Raw spread_type string from the reading row. When provided, renders on
   *  line 1 between the date and the relative time. */
  spreadType?: string | null;
  onOpen: (readingId: string) => void;
};

function spreadLabel(spreadType: string | null | undefined, cardCount: number): string | null {
  if (!spreadType) return null;
  if (isValidSpreadMode(spreadType)) {
    if (spreadType === "custom") return `Custom ${cardCount || 1}`;
    return SPREAD_META[spreadType].label;
  }
  // Unknown / legacy free-form value — show it as-is.
  return spreadType;
}

/**
 * Canonical compact reading row.
 * Q91 #3 — two-line layout:
 *   Line 1: {date} · {relative time} · {spread type}  ›
 *   Line 2: {question, italic} — omitted entirely when no question.
 * Consumed by Stalkers occurrence list, insights card-detail readings,
 * and any other surface that needs a compact reading link.
 */
export function ReadingRow({
  readingId,
  question,
  cardIds,
  createdAt,
  spreadType,
  onOpen,
}: ReadingRowProps) {
  const trimmed = question?.trim() ?? "";
  const hasQuestion = trimmed.length > 0;
  const spread = spreadLabel(spreadType, cardIds.length);

  return (
    <button
      type="button"
      onClick={() => onOpen(readingId)}
      className="flex w-full flex-col gap-1 px-2 py-3 text-left transition-colors hover:bg-foreground/5"
      style={{
        borderBottom:
          "1px solid color-mix(in oklab, var(--color-foreground) 8%, transparent)",
      }}
    >
      <div className="flex w-full items-center gap-2">
        <span
          style={{
            fontSize: "var(--text-body-sm)",
            color: "var(--color-foreground)",
            opacity: 0.7,
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontFamily: "var(--font-sans, inherit)",
          }}
        >
          {formatDateShort(createdAt)} · {formatTimeAgo(createdAt)}
          {spread ? ` · ${spread}` : ""}
        </span>
        <ChevronRight
          size={14}
          strokeWidth={1.5}
          style={{
            color: "var(--color-foreground)",
            opacity: 0.4,
            flexShrink: 0,
          }}
          aria-hidden
        />
      </div>
      {hasQuestion && (
        <span
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body)",
            color: "var(--color-foreground)",
            opacity: 1,
            display: "block",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {`\u201C${trimmed}\u201D`}
        </span>
      )}
    </button>
  );
}