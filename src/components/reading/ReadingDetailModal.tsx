/**
 * Read-only reading detail modal opened from any reading row.
 * Used by Stalkers occurrence list, Stories pattern preview rows,
 * and pattern detail timeline. Deep-linking to Journal is offered
 * at the bottom for full editing.
 */
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getReadingsByIds } from "@/lib/insights.functions";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import { CardImage } from "@/components/card/CardImage";
import { Modal } from "@/components/ui/modal";
import { LoadingText } from "@/components/ui/loading-text";
import { formatDateTime } from "@/lib/dates";
import { SPREAD_META, isValidSpreadMode, type SpreadMode } from "@/lib/spreads";
import { JournalPromptsReadOnly } from "@/components/tarot/JournalPrompts";
import { resolvePromptsForFirstCard } from "@/lib/journal-prompts/resolve";

export function ReadingDetailModal({
  readingId,
  onClose,
}: {
  readingId: string;
  onClose: () => void;
}) {
  const fetchReadings = useServerFn(getReadingsByIds);
  const [reading, setReading] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetchReadings({ data: { readingIds: [readingId] }, headers });
        if (cancelled) return;
        setReading(res.readings?.[0] ?? null);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[reading-detail] fetch failed", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [readingId, fetchReadings]);

  const subtitle =
    reading && reading.created_at
      ? `${formatDateTime(reading.created_at)} · ${reading.spread_type ?? "Reading"}`
      : undefined;

  return (
    <Modal open onClose={onClose} title="Reading" subtitle={subtitle} size="md">
        {loading ? (
          <div className="px-6 pb-12">
            <LoadingText>Loading reading…</LoadingText>
          </div>
        ) : !reading ? (
          <div className="px-6 pb-12 text-sm italic text-muted-foreground">
            Reading not found.
          </div>
        ) : (
          <article className="px-6 pb-12">
            {reading.question ? (
              <header className="mb-4">
                <h2
                  className="mt-2 font-serif italic text-center"
                  style={{ fontSize: "var(--text-heading-md, 1.25rem)", color: "var(--gold)" }}
                >
                  “{reading.question}”
                </h2>
              </header>
            ) : null}

            {(() => {
              const positions: readonly string[] = isValidSpreadMode(reading.spread_type)
                ? (SPREAD_META[reading.spread_type as SpreadMode].positions ?? [])
                : [];
              return (
                <div className="flex flex-wrap justify-center gap-3">
                  {(reading.card_ids ?? []).map((cid: number, idx: number) => {
                    const reversed = !!(reading.card_orientations ?? [])[idx];
                    const label = positions[idx];
                    return (
                      <div key={`${cid}-${idx}`} style={{ width: 96 }} className="flex flex-col items-center">
                        <CardImage
                          cardId={cid}
                          reversed={reversed}
                          size="custom"
                          widthPx={96}
                        />
                        {label && (
                          <span className="mt-1 text-center text-[10px] uppercase tracking-wider text-muted-foreground">
                            {label}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {reading.note ? (
              <section
                className="mt-6 rounded-lg p-3"
                style={{ background: "color-mix(in oklab, var(--gold) 6%, transparent)" }}
              >
                <h3 className="mb-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  Notes
                </h3>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{reading.note}</p>
              </section>
            ) : null}

            {(() => {
              const firstCardId = reading.card_ids?.[0];
              const prompts = resolvePromptsForFirstCard(firstCardId, null);
              if (!prompts || prompts.length === 0) return null;
              return (
                <section className="mt-6">
                  <h3 className="text-[11px] uppercase tracking-widest italic text-muted-foreground">
                    Reflection Prompts
                  </h3>
                  <JournalPromptsReadOnly prompts={prompts} className="mt-2" />
                </section>
              );
            })()}

            {Array.isArray(reading.tags) && reading.tags.length > 0 ? (
              <section className="mt-4 flex flex-wrap gap-1.5">
                {reading.tags.map((t: string) => (
                  <span
                    key={t}
                    className="rounded-full px-2 py-0.5 text-xs"
                    style={{
                      background: "color-mix(in oklch, var(--gold) 15%, transparent)",
                    }}
                  >
                    {t}
                  </span>
                ))}
              </section>
            ) : null}

            <footer
              className="mt-8 border-t pt-4 text-center"
              style={{ borderColor: "color-mix(in oklab, var(--gold) 15%, transparent)" }}
            >
              <a
                href={`/journal?openId=${reading.id}`}
                className="text-xs uppercase tracking-[0.18em] underline-offset-2 hover:underline"
                style={{ color: "var(--gold)" }}
              >
                Open in Journal →
              </a>
            </footer>
          </article>
        )}
    </Modal>
  );
}