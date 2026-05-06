import { ChevronRight } from "lucide-react";
import { firstCardName, formatRelativeTime } from "@/lib/utils";

type ReadingRowProps = {
  readingId: string;
  question: string | null | undefined;
  cardIds: number[];
  createdAt: string;
  onOpen: (readingId: string) => void;
};

/**
 * Canonical compact reading row — question italic on left,
 * relative time on right, right chevron, divider hairline below,
 * tappable button. When question is empty, falls back to first
 * card name (non-italic). Consumed by Stalkers occurrence list,
 * Stories pattern preview rows, and pattern detail timeline.
 * One source of truth: change this component, all three follow.
 */
export function ReadingRow({
  readingId,
  question,
  cardIds,
  createdAt,
  onOpen,
}: ReadingRowProps) {
  const hasQuestion = !!question?.trim();
  const label = hasQuestion
    ? `\u201C${question!.trim()}\u201D`
    : firstCardName(cardIds);

  return (
    <button
      type="button"
      onClick={() => onOpen(readingId)}
      className="flex w-full items-baseline justify-between gap-3 px-2 py-3 text-left transition-colors hover:bg-foreground/5"
      style={{
        borderBottom:
          "1px solid color-mix(in oklab, var(--color-foreground) 8%, transparent)",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: hasQuestion ? "italic" : "normal",
          fontSize: "var(--text-body-sm)",
          color: "var(--color-foreground)",
          opacity: 0.9,
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: "var(--text-caption, 12px)",
          color: "var(--color-foreground)",
          opacity: 0.55,
          whiteSpace: "nowrap",
          flexShrink: 0,
          fontFamily: "var(--font-sans, inherit)",
        }}
      >
        {formatRelativeTime(createdAt)}
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
    </button>
  );
}