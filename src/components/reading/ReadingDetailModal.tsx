/**
 * Read-only reading detail modal opened from any reading row.
 * Used by Stalkers occurrence list, Stories pattern preview rows,
 * and pattern detail timeline. Deep-linking to Journal is offered
 * at the bottom for full editing.
 */
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { getReadingsByIds } from "@/lib/insights.functions";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import { CardImage } from "@/components/card/CardImage";
import { Modal } from "@/components/ui/modal";
import { LoadingText } from "@/components/ui/loading-text";
import { formatDateTime } from "@/lib/dates";
import { SPREAD_META, isValidSpreadMode, type SpreadMode } from "@/lib/spreads";
import { resolvePromptsForFirstCard } from "@/lib/journal-prompts/resolve";
import { JournalBlock } from "@/components/journal/JournalBlock";
import { fetchUserDecks, type CustomDeck } from "@/lib/custom-decks";
import { useAuth } from "@/lib/auth";
import { swapReadingDeck, swapDeckAcrossReadings } from "@/lib/reconnect-deck.functions";

export function ReadingDetailModal({
  readingId,
  onClose,
}: {
  readingId: string;
  onClose: () => void;
}) {
  const fetchReadings = useServerFn(getReadingsByIds);
  // EJ45 — pre-existing `any` (reading shape from server fn isn't
  // strictly typed); kept untyped to avoid a parallel typing refactor
  // outside this patch's scope.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [reading, setReading] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // EJ45 — Switch-deck affordance state. Lets the seeker re-link the
  // tarot cards in this reading to a different deck they own. After a
  // successful per-entry swap, we look for OTHER readings linked to
  // the same previous deck and offer a follow-up "Apply to all N
  // others?" prompt so the global swap is discovered through the
  // problem rather than buried in settings.
  const { user } = useAuth();
  const [userDecks, setUserDecks] = useState<CustomDeck[]>([]);
  const [decksLoaded, setDecksLoaded] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [swapBusy, setSwapBusy] = useState(false);
  const swapOne = useServerFn(swapReadingDeck);
  const swapAcross = useServerFn(swapDeckAcrossReadings);

  useEffect(() => {
    if (!user) {
      setDecksLoaded(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const ds = await fetchUserDecks(user.id);
        if (!cancelled) setUserDecks(ds);
      } catch {
        if (!cancelled) setUserDecks([]);
      } finally {
        if (!cancelled) setDecksLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

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
        console.warn("[reading-detail] fetch failed", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [readingId, fetchReadings]);

  // EJ45 — derive the dominant current deck name (if any) for the
  // tarot slots in this reading. Used in the affordance label so the
  // seeker knows what they're swapping FROM.
  const currentDeckLabel = useMemo(() => {
    if (!reading) return null;
    const ids: number[] = reading.card_ids ?? [];
    const slotDecks: (string | null)[] =
      reading.card_deck_ids ?? Array.from({ length: ids.length }, () => reading.deck_id ?? null);
    const counts = new Map<string | null, number>();
    for (let i = 0; i < ids.length; i++) {
      if (ids[i] >= 1000) continue; // tarot-only for swap purposes
      const k = slotDecks[i] ?? null;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    let bestKey: string | null = null;
    let bestCount = 0;
    for (const [k, v] of counts) {
      if (v > bestCount) {
        bestKey = k;
        bestCount = v;
      }
    }
    if (bestKey === null) return "Default";
    const d = userDecks.find((x) => x.id === bestKey);
    return d?.name ?? "Linked deck";
  }, [reading, userDecks]);

  const handleSwitchDeck = async (toDeckId: string) => {
    if (!reading || swapBusy) return;
    const headers = await getAuthHeaders();
    setSwapBusy(true);
    try {
      // Step 1 — per-reading dry-run preview.
      const preview = await swapOne({
        data: { readingId: reading.id, toDeckId, mode: "tarotOnly", dryRun: true },
        headers,
      });
      if (!preview.ok) {
        toast.error("Couldn't switch deck for this reading");
        return;
      }
      if (preview.slotsSwapped === 0) {
        toast.success(`Already showing "${preview.toDeckName}".`);
        setSwitchOpen(false);
        return;
      }
      const confirmOne = window.confirm(
        `Switch ${preview.slotsSwapped} tarot card${preview.slotsSwapped === 1 ? "" : "s"} in this reading to "${preview.toDeckName}"?`,
      );
      if (!confirmOne) return;
      // Step 2 — real per-reading swap.
      const result = await swapOne({
        data: { readingId: reading.id, toDeckId, mode: "tarotOnly", dryRun: false },
        headers,
      });
      if (!result.ok) {
        toast.error("Switch failed");
        return;
      }
      // Refresh in-memory reading state.
      setReading({
        ...reading,
        card_deck_ids: (reading.card_ids ?? []).map((cid: number, i: number) => {
          if (cid >= 1000) return reading.card_deck_ids?.[i] ?? null;
          return toDeckId;
        }),
      });
      toast.success(
        `Switched ${result.slotsSwapped} card${result.slotsSwapped === 1 ? "" : "s"} to "${result.toDeckName}".`,
      );
      setSwitchOpen(false);
      // Step 3 — global follow-up. If there are OTHER readings with
      // the same previous deck linkage, offer a one-tap apply-all.
      const prevDeckId = result.previousDeckId ?? null;
      if (prevDeckId === toDeckId) return;
      const acrossPreview = await swapAcross({
        data: {
          fromDeckId: prevDeckId,
          toDeckId,
          mode: "safe",
          dryRun: true,
        },
        headers,
      });
      if (!acrossPreview.ok) return;
      if (acrossPreview.readingsUpdated === 0) return;
      const fromLabel =
        acrossPreview.fromDeckName ?? (prevDeckId === null ? "Default" : "the previous deck");
      const applyAll = window.confirm(
        `Found ${acrossPreview.readingsUpdated} other reading${acrossPreview.readingsUpdated === 1 ? "" : "s"} still linked to "${fromLabel}". Apply this swap to all of them too?`,
      );
      if (!applyAll) return;
      const globalRes = await swapAcross({
        data: {
          fromDeckId: prevDeckId,
          toDeckId,
          mode: "safe",
          dryRun: false,
        },
        headers,
      });
      if (!globalRes.ok) {
        toast.error("Bulk apply failed");
        return;
      }
      toast.success(
        `Updated ${globalRes.slotsSwapped} more slot${globalRes.slotsSwapped === 1 ? "" : "s"} across ${globalRes.readingsUpdated} reading${globalRes.readingsUpdated === 1 ? "" : "s"}.`,
      );
    } catch (e) {
      toast.error(`Switch failed: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setSwapBusy(false);
    }
  };

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
        <div className="px-6 pb-12 text-sm italic text-muted-foreground">Reading not found.</div>
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
                    <div
                      key={`${cid}-${idx}`}
                      style={{ width: 96 }}
                      className="flex flex-col items-center"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          void navigate({
                            to: "/insights/card/$cardId",
                            params: { cardId: String(cid) },
                          });
                        }}
                        style={{
                          background: "none",
                          border: "none",
                          padding: 0,
                          cursor: "pointer",
                          display: "block",
                          width: "100%",
                        }}
                        aria-label="View card trace"
                      >
                        <CardImage
                          cardId={cid}
                          reversed={reversed}
                          size="custom"
                          widthPx={96}
                          deckId={reading.card_deck_ids?.[idx] ?? reading.deck_id ?? null}
                        />
                      </button>
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

          {/* EJ45 — Switch deck affordance. Lets the seeker re-link
                the tarot cards in this reading to a different deck
                they own. Only shown when the user has at least one
                custom deck. Oracle slots (card_id 1000+) are
                untouched by this swap. */}
          {decksLoaded && userDecks.length > 0 ? (
            <section className="mt-3 flex flex-col items-center gap-2">
              {!switchOpen ? (
                <button
                  type="button"
                  onClick={() => setSwitchOpen(true)}
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontStyle: "italic",
                    fontSize: "var(--text-caption)",
                    color: "var(--color-foreground-muted)",
                    background: "none",
                    border: "none",
                    padding: "4px 8px",
                    cursor: "pointer",
                    opacity: 0.7,
                  }}
                >
                  Switch deck{currentDeckLabel ? ` (currently ${currentDeckLabel})` : ""}
                </button>
              ) : (
                <div
                  className="flex flex-col items-center gap-2 rounded-lg px-4 py-3"
                  style={{
                    background: "color-mix(in oklab, var(--gold) 6%, transparent)",
                    border: "1px solid color-mix(in oklab, var(--gold) 20%, transparent)",
                    maxWidth: 320,
                  }}
                >
                  <p
                    className="text-center"
                    style={{
                      fontFamily: "var(--font-serif)",
                      fontStyle: "italic",
                      fontSize: "var(--text-caption)",
                      color: "var(--color-foreground)",
                      opacity: 0.8,
                      margin: 0,
                    }}
                  >
                    Switch tarot images to:
                  </p>
                  <div className="flex flex-col items-stretch gap-1.5 w-full">
                    {userDecks.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        disabled={swapBusy}
                        onClick={() => void handleSwitchDeck(d.id)}
                        style={{
                          fontFamily: "var(--font-serif)",
                          fontStyle: "italic",
                          fontSize: "var(--text-body-sm)",
                          color: "var(--gold)",
                          background: "transparent",
                          border: "1px solid color-mix(in oklab, var(--gold) 25%, transparent)",
                          borderRadius: 999,
                          padding: "8px 14px",
                          cursor: swapBusy ? "default" : "pointer",
                          opacity: swapBusy ? 0.5 : 1,
                        }}
                      >
                        {d.name}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setSwitchOpen(false)}
                    style={{
                      fontFamily: "var(--font-serif)",
                      fontStyle: "italic",
                      fontSize: "var(--text-caption)",
                      color: "var(--color-foreground-muted)",
                      background: "none",
                      border: "none",
                      padding: "2px 6px",
                      cursor: "pointer",
                      opacity: 0.55,
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </section>
          ) : null}

          {/* EK55 — Past journal entries display via JournalBlock in
                read-only mode so they have the same visual layout as
                live entries on the post-flip page. Splits the stored
                note (which is `"${usedPrompt}\n\n${note}"` when a
                prompt was selected) into the two fields JournalBlock
                expects. When there's no `\n\n`, the whole string is
                the seeker's note and usedPrompt is null. */}
          {(() => {
            const firstCardId = reading.card_ids?.[0];
            const prompts = resolvePromptsForFirstCard(firstCardId, null) ?? [];
            const raw = (reading.note ?? "").trim();
            const splitIdx = raw.indexOf("\n\n");
            const parsedPrompt =
              splitIdx >= 0 ? raw.slice(0, splitIdx).trim() : null;
            const parsedNote =
              splitIdx >= 0 ? raw.slice(splitIdx + 2).trim() : raw;
            // Hide the JournalBlock entirely if there's nothing to
            // show: no note AND no available prompts.
            if (!parsedNote && prompts.length === 0) return null;
            return (
              <section className="mt-6">
                <JournalBlock
                  prompts={prompts}
                  note={parsedNote}
                  usedPrompt={parsedPrompt}
                  onChange={() => {}}
                  voiceMode="plain"
                  readOnly
                />
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
