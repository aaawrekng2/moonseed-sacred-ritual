/**
 * Q30 — Stories page Stage 2 UI sections.
 *
 * Hero, action row, stats ribbon, the arc, remarkable moments, and
 * the constellation — all consume the AI orchestration output written
 * by `generateStoryOrchestration` onto the `patterns` row.
 */
import type { CSSProperties } from "react";
import { CardImage } from "@/components/card/CardImage";
import { getCardName } from "@/lib/tarot";
import { formatDateLong } from "@/lib/dates";

export const sectionHeadingStyle = (): CSSProperties => ({
  fontFamily: "var(--font-serif)",
  fontStyle: "italic",
  fontSize: "var(--text-heading-md, 22px)",
  color: "var(--color-foreground)",
  opacity: 0.6,
  marginBottom: "var(--space-4, 16px)",
  marginTop: 0,
});

export const actionButtonStyle = (): CSSProperties => ({
  background: "none",
  border: "none",
  padding: 0,
  cursor: "pointer",
  fontFamily: "var(--font-serif)",
  fontStyle: "italic",
  fontSize: "var(--text-body-sm)",
  color: "var(--accent, var(--gold))",
  opacity: 0.55,
  transition: "opacity 200ms ease-out",
});

export function StoryHero({
  storyName,
  storyDescription,
  fallbackName,
  metaLine,
}: {
  storyName: string | null | undefined;
  storyDescription: string | null | undefined;
  fallbackName: string;
  metaLine: string;
}) {
  return (
    <header style={{ padding: "var(--space-6, 24px) 0 var(--space-4, 16px) 0" }}>
      <p
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: "var(--text-caption)",
          letterSpacing: "0.15em",
          color: "var(--accent, var(--gold))",
          opacity: 0.6,
          textTransform: "uppercase",
          margin: 0,
        }}
      >
        {metaLine}
      </p>
      <h1
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-display, 48px)",
          color: "var(--accent, var(--gold))",
          margin: "var(--space-3, 12px) 0 var(--space-4, 16px) 0",
          lineHeight: 1.1,
        }}
      >
        {storyName?.trim() || fallbackName || "untitled story"}
      </h1>
      {storyDescription && (
        <p
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body-lg, 18px)",
            color: "var(--color-foreground)",
            opacity: 0.85,
            lineHeight: 1.5,
            margin: 0,
            maxWidth: "640px",
          }}
        >
          {storyDescription}
        </p>
      )}
    </header>
  );
}

export function StoryActions({
  onRename,
  onAddNote,
  onRetire,
  retired,
  hasNote,
  noteOpen,
}: {
  onRename: () => void;
  onAddNote: () => void;
  onRetire: () => void;
  retired: boolean;
  hasNote: boolean;
  noteOpen: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-5, 20px)",
        marginTop: "var(--space-4, 16px)",
        marginBottom: "var(--space-6, 24px)",
        flexWrap: "wrap",
      }}
    >
      <button type="button" onClick={onRename} style={actionButtonStyle()}>
        rename
      </button>
      <button type="button" onClick={onAddNote} style={actionButtonStyle()}>
        {noteOpen ? "close note" : hasNote ? "edit note" : "add a note"}
      </button>
      <button
        type="button"
        onClick={onRetire}
        disabled={retired}
        style={{ ...actionButtonStyle(), opacity: retired ? 0.25 : 0.55 }}
      >
        {retired ? "retired" : "retire"}
      </button>
    </div>
  );
}

export function StatsRibbon({
  readingCount,
  recurringCardCount,
  reversalCount,
  dominantMoonPhase,
}: {
  readingCount: number;
  recurringCardCount: number;
  reversalCount: number;
  dominantMoonPhase: string;
}) {
  const stats: Array<{ value: string | number; label: string }> = [
    { value: readingCount, label: "READINGS" },
    { value: recurringCardCount, label: "CARDS RECURRING" },
    { value: reversalCount, label: "REVERSALS" },
    { value: dominantMoonPhase || "—", label: "DOMINANT MOON" },
  ];
  return (
    <section
      style={{
        display: "flex",
        gap: "var(--space-8, 48px)",
        paddingTop: "var(--space-5, 20px)",
        paddingBottom: "var(--space-5, 20px)",
        borderTop: "0.5px solid var(--border-subtle, rgba(255,255,255,0.08))",
        borderBottom: "0.5px solid var(--border-subtle, rgba(255,255,255,0.08))",
        marginBottom: "var(--space-8, 48px)",
        flexWrap: "wrap",
      }}
    >
      {stats.map((stat) => (
        <div key={stat.label}>
          <p
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-heading-lg, 28px)",
              color: "var(--accent, var(--gold))",
              margin: 0,
              lineHeight: 1,
            }}
          >
            {stat.value}
          </p>
          <p
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "var(--text-caption)",
              letterSpacing: "0.12em",
              color: "var(--color-foreground)",
              opacity: 0.4,
              margin: "4px 0 0 0",
            }}
          >
            {stat.label}
          </p>
        </div>
      ))}
    </section>
  );
}

export function TheArc({
  readings,
  onOpenReading,
}: {
  readings: Array<{ id: string; created_at: string; card_ids: number[] }>;
  onOpenReading: (id: string) => void;
}) {
  if (!readings || readings.length === 0) return null;
  const sorted = [...readings].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const total = sorted.length;
  return (
    <section style={{ marginBottom: "var(--space-8, 48px)" }}>
      <h2 style={sectionHeadingStyle()}>the arc</h2>
      <div style={{ position: "relative", height: 120, paddingTop: 60 }}>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 60,
            borderTop: "0.5px solid var(--border-subtle, rgba(255,255,255,0.12))",
          }}
        />
        {sorted.map((r, idx) => {
          const x = total === 1 ? "50%" : `${(idx / (total - 1)) * 100}%`;
          const cardCount = r.card_ids?.length ?? 0;
          const radius = cardCount >= 5 ? 7 : cardCount >= 3 ? 5 : 4;
          const opacity = cardCount >= 5 ? 1 : 0.7;
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => onOpenReading(r.id)}
              aria-label={`reading on ${formatDateLong(r.created_at)}`}
              style={{
                position: "absolute",
                left: x,
                top: 60,
                transform: "translate(-50%, -50%)",
                width: radius * 2,
                height: radius * 2,
                borderRadius: "50%",
                background: "var(--accent, var(--gold))",
                opacity,
                border: "none",
                cursor: "pointer",
                padding: 0,
              }}
            />
          );
        })}
        <span
          style={{
            position: "absolute",
            top: 90,
            left: 0,
            fontFamily: "var(--font-sans)",
            fontSize: "var(--text-caption)",
            letterSpacing: "0.12em",
            opacity: 0.4,
            color: "var(--color-foreground)",
          }}
        >
          {formatDateLong(sorted[0]?.created_at).toUpperCase()}
        </span>
        <span
          style={{
            position: "absolute",
            top: 90,
            right: 0,
            fontFamily: "var(--font-sans)",
            fontSize: "var(--text-caption)",
            letterSpacing: "0.12em",
            opacity: 0.4,
            color: "var(--color-foreground)",
          }}
        >
          {formatDateLong(sorted.at(-1)!.created_at).toUpperCase()}
        </span>
      </div>
    </section>
  );
}

export function RemarkableMoments({
  moments,
  onOpenReading,
  isGenerating,
}: {
  moments: Array<{ date: string; caption: string; reading_ids?: string[] }>;
  onOpenReading: (id: string) => void;
  isGenerating: boolean;
}) {
  const list = moments ?? [];
  if (list.length === 0 && !isGenerating) return null;
  return (
    <section style={{ marginBottom: "var(--space-8, 48px)" }}>
      <h2 style={sectionHeadingStyle()}>remarkable moments</h2>
      {list.length === 0 ? (
        <p
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            opacity: 0.5,
            margin: 0,
          }}
        >
          Listening for what stood out…
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "var(--space-4, 16px)" }}>
          {list.map((m, i) => {
            const targetId = m.reading_ids?.[0];
            return (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => targetId && onOpenReading(targetId)}
                  disabled={!targetId}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    background: "none",
                    border: "none",
                    padding: "var(--space-3, 12px) 0",
                    borderBottom: "0.5px solid var(--border-subtle, rgba(255,255,255,0.08))",
                    cursor: targetId ? "pointer" : "default",
                  }}
                >
                  <p
                    style={{
                      fontFamily: "var(--font-sans)",
                      fontSize: "var(--text-caption)",
                      letterSpacing: "0.15em",
                      color: "var(--accent, var(--gold))",
                      opacity: 0.6,
                      margin: 0,
                      textTransform: "uppercase",
                    }}
                  >
                    {formatDateLong(m.date).toUpperCase()}
                  </p>
                  <p
                    style={{
                      fontFamily: "var(--font-serif)",
                      fontStyle: "italic",
                      fontSize: "var(--text-body)",
                      color: "var(--color-foreground)",
                      lineHeight: 1.5,
                      margin: "8px 0 0 0",
                    }}
                  >
                    {m.caption}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function StoryConstellation({
  readings,
}: {
  readings: Array<{ id: string; card_ids: number[] }>;
}) {
  if (!readings || readings.length === 0) return null;
  // Recurring cards = appear 2+ times.
  const counts = new Map<number, number>();
  for (const r of readings) for (const id of r.card_ids ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
  const recurring = Array.from(counts.entries())
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 9)
    .map(([id]) => id);
  if (recurring.length < 2) return null;

  // Pair counts for cards drawn together.
  const pairCounts = new Map<string, number>();
  for (const r of readings) {
    const ids = (r.card_ids ?? []).filter((id) => recurring.includes(id));
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = [ids[i], ids[j]].sort((a, b) => a - b).join("-");
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }

  const size = 320;
  const radius = 110;
  const cx = size / 2;
  const cy = size / 2;
  const positions = recurring.map((cardId, i) => {
    const angle = (i / recurring.length) * Math.PI * 2 - Math.PI / 2;
    return { cardId, x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
  });

  return (
    <section style={{ marginBottom: "var(--space-8, 48px)" }}>
      <h2 style={sectionHeadingStyle()}>the constellation</h2>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {positions.flatMap((a, i) =>
            positions.slice(i + 1).map((b) => {
              const key = [a.cardId, b.cardId].sort((x, y) => x - y).join("-");
              const count = pairCounts.get(key) ?? 0;
              if (count === 0) return null;
              return (
                <line
                  key={`${a.cardId}-${b.cardId}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="var(--accent, var(--gold))"
                  strokeWidth={Math.min(0.5 + count * 0.7, 3)}
                  opacity={Math.min(0.3 + count * 0.15, 0.75)}
                />
              );
            }),
          )}
          {positions.map((p) => (
            <g key={p.cardId} transform={`translate(${p.x}, ${p.y})`}>
              <foreignObject x="-22" y="-32" width="44" height="64">
                <div
                  title={getCardName(p.cardId)}
                  style={{
                    width: 44,
                    height: 64,
                    borderRadius: 4,
                    overflow: "hidden",
                    boxShadow: "0 0 12px rgba(212,175,90,0.35)",
                  }}
                >
                  <CardImage cardId={p.cardId} size="thumbnail" />
                </div>
              </foreignObject>
            </g>
          ))}
        </svg>
      </div>
    </section>
  );
}