/**
 * Phase 17 — list of readings that contain the hero (and optionally the
 * selected companion). Lives in the right column of /constellation.
 */
import { format } from "date-fns";
import { getCardName } from "@/lib/tarot";
import type { CardConstellation } from "@/lib/quicklog.functions";
import type { ManualPick } from "@/components/tabletop/ManualEntryBuilder";

type Props = {
  heroPick: ManualPick | null;
  companionFilter: number | null;
  matches: CardConstellation["matches"];
};

export function MatchingReadingsPanel({
  heroPick,
  companionFilter,
  matches,
}: Props) {
  if (!heroPick) return null;
  const filtered =
    companionFilter === null
      ? matches
      : matches.filter((r) => r.cardIds.includes(companionFilter));

  const title =
    companionFilter !== null
      ? `When ${getCardName(heroPick.cardIndex)} + ${getCardName(companionFilter)} Met Before`
      : `Recent Readings with ${getCardName(heroPick.cardIndex)}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <p
        style={{
          fontSize: 10,
          letterSpacing: "0.3em",
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          color: "var(--accent, var(--gold))",
          opacity: 0.85,
          margin: 0,
          textTransform: "uppercase",
        }}
      >
        {title}
      </p>
      {filtered.length === 0 ? (
        <p
          style={{
            fontSize: 11,
            color: "var(--color-foreground-muted, var(--color-foreground))",
            fontStyle: "italic",
            margin: 0,
            opacity: 0.7,
          }}
        >
          —
        </p>
      ) : (
        filtered.map((r) => <ReadingRow key={r.id} reading={r} />)
      )}
    </div>
  );
}

function ReadingRow({
  reading,
}: {
  reading: CardConstellation["matches"][number];
}) {
  const date = format(new Date(reading.createdAt), "MMM d, yyyy");
  const cardsLabel = reading.cardIds
    .slice(0, 6)
    .map((id) => getCardName(id))
    .join(" · ");
  const more = reading.cardIds.length - 6;
  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 8,
        border: "1px solid var(--border-subtle)",
        background: "var(--surface-card)",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <span
          style={{
            fontSize: 10,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            fontFamily: "var(--font-serif)",
            color: "var(--color-foreground-muted, var(--color-foreground))",
            opacity: 0.7,
          }}
        >
          {date}
        </span>
      </div>
      {reading.question && reading.question.trim() && (
        <p
          style={{
            margin: 0,
            fontSize: 13,
            fontStyle: "italic",
            fontFamily: "var(--font-serif)",
            color: "var(--color-foreground)",
          }}
        >
          “{reading.question.trim()}”
        </p>
      )}
      <p
        style={{
          margin: 0,
          fontSize: 11,
          color: "var(--color-foreground-muted, var(--color-foreground))",
          opacity: 0.85,
        }}
      >
        {cardsLabel}
        {more > 0 ? ` · +${more} more` : ""}
      </p>
    </div>
  );
}