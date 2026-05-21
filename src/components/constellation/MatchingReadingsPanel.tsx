/**
 * Phase 17 — list of readings that contain the hero (and optionally the
 * selected companion). Lives in the right column of /constellation.
 */
import { formatDateShort } from "@/lib/dates";
import { getCardName } from "@/lib/tarot";
import type { CardConstellation } from "@/lib/quicklog.functions";
import type { ManualPick } from "@/components/tabletop/ManualEntryBuilder";

type Props = {
  heroPick: ManualPick | null;
  /** Phase 24 — teal multi-select. Empty = no filter (show all). When
   * non-empty, filter to readings containing EVERY id in the set. Hero is
   * not implicitly included — the user must click it to participate. */
  tealSelectedIds: number[];
  matches: CardConstellation["matches"];
  /** Phase 19 Fix 10 — when an echo is active, these ids get breathing glow. */
  echoParticipatingIds?: number[] | null;
};

export function MatchingReadingsPanel({
  heroPick,
  tealSelectedIds,
  matches,
  echoParticipatingIds,
}: Props) {
  if (!heroPick) return null;
  const tealSet = new Set(tealSelectedIds);
  const filtered =
    tealSet.size === 0
      ? matches
      : matches.filter((r) => {
          const cardSet = new Set(r.cardIds);
          for (const id of tealSet) {
            if (!cardSet.has(id)) return false;
          }
          return true;
        });

  const title =
    tealSet.size === 0
      ? "Recent Readings"
      : tealSet.size === 1
        ? `Readings with ${getCardName(tealSelectedIds[0])}`
        : `Readings with ${tealSelectedIds.length} selected cards`;

  const echoSet = new Set(echoParticipatingIds ?? []);
  const hasEcho = echoSet.size > 0;

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
          position: "sticky",
          top: 0,
          background: "var(--background, transparent)",
          paddingBottom: 4,
          zIndex: 2,
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
        filtered.map((r) => {
          const breathing =
            hasEcho &&
            r.cardIds.filter((id) => echoSet.has(id)).length >= 3;
          return (
            <ReadingRow key={r.id} reading={r} breathing={breathing} />
          );
        })
      )}
    </div>
  );
}

function ReadingRow({
  reading,
  breathing = false,
}: {
  reading: CardConstellation["matches"][number];
  breathing?: boolean;
}) {
  // Phase 20 Fix 7 — single-line: short date + inline card list (or question).
  const date = formatDateShort(reading.createdAt);
  const cardsLabel = reading.cardIds.map((id) => getCardName(id)).join(" · ");
  const inlineText =
    reading.question && reading.question.trim()
      ? `“${reading.question.trim()}” — ${cardsLabel}`
      : cardsLabel;
  return (
    <div style={{ position: "relative" }}>
      {breathing && (
        <div
          aria-hidden
          className="tarotseed-constellation-breathe"
          style={{
            position: "absolute",
            top: -8,
            left: -10,
            right: -10,
            bottom: -8,
            background:
              "radial-gradient(ellipse at center, color-mix(in oklab, var(--accent, var(--gold)) 42%, transparent) 0%, color-mix(in oklab, var(--accent, var(--gold)) 22%, transparent) 55%, transparent 85%)",
            pointerEvents: "none",
            zIndex: 0,
            borderRadius: 12,
          }}
        />
      )}
      <div
      style={{
        position: "relative",
        zIndex: 1,
        padding: "8px 12px",
        borderRadius: 8,
        border: breathing
          ? "1px solid var(--accent, var(--gold))"
          : "1px solid var(--border-subtle)",
        background: "var(--surface-card)",
        display: "flex",
        flexDirection: "row",
        gap: 8,
        alignItems: "baseline",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
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
            flexShrink: 0,
          }}
        >
          {date}
        </span>
        <span
          style={{
            margin: 0,
            fontSize: 12,
            fontFamily: "var(--font-serif)",
            fontStyle: reading.question ? "italic" : "normal",
            color: "var(--color-foreground-muted, var(--color-foreground))",
            opacity: 0.9,
            overflow: "hidden",
            textOverflow: "ellipsis",
            minWidth: 0,
          }}
          title={inlineText}
        >
          {inlineText}
        </span>
      </div>
    </div>
  );
}