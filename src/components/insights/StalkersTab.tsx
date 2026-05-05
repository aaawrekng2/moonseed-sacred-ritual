/**
 * FP — Stalkers tab wired to real server functions.
 * Replaces the FL/FM/FN/FO demo data with live results from
 * getStalkerCards / getStalkerTwins / getStalkerTriplets /
 * getReversedStalkers. Mode/cooccurrence/filter changes refetch.
 */
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { CardImage } from "@/components/card/CardImage";
import {
  getStalkerCards,
  getStalkerTwins,
  getStalkerTriplets,
  getReversedStalkers,
} from "@/lib/insights.functions";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import { StalkerCalendar } from "./StalkerCalendar";
import { StalkerOccurrenceList } from "./StalkerOccurrenceList";
import { StalkerReadingModal } from "./StalkerReadingModal";
import type {
  InsightsFilters,
  TimeRange,
  StalkerCardsResult,
  StalkerTwinsResult,
  StalkerTripletsResult,
  ReversedStalkersResult,
  StalkerCard,
  StalkerTwin,
  StalkerTriplet,
  ReversedStalker,
} from "@/lib/insights.types";

type Mode = "singles" | "twins" | "triplets" | "reversed";
type Cooccurrence = "reading" | "day";

const TIME_RANGE_LABELS: Record<TimeRange, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "365d": "Last 365 days",
  all: "All time",
};

function timeRangeLabel(tr: TimeRange): string {
  if (tr === "7d") return "the last 7 days";
  if (tr === "30d") return "the last 30 days";
  if (tr === "90d") return "the last 90 days";
  if (tr === "365d") return "the last year";
  return "all your readings";
}

// FP-5 — Template prose generators. Deterministic, no AI.
function singleProse(name: string, count: number, tr: TimeRange): string {
  const w = timeRangeLabel(tr);
  return `${name} has appeared ${count} times in ${w}. ` +
    `When a card returns this often, it's marking the texture of this season — ` +
    `not a coincidence, but a thread. What is ${name} asking you to notice?`;
}
function twinProse(a: string, b: string, count: number, tr: TimeRange, mode: Cooccurrence): string {
  const w = timeRangeLabel(tr);
  const together = mode === "day" ? "on the same day" : "in the same reading";
  return `${a} and ${b} have arrived together ${together} ${count} times in ${w}. ` +
    `A pair speaking the same message — two cards braiding into one story. ` +
    `Sit with what these two share between them.`;
}
function tripletProse(names: [string, string, string], count: number, tr: TimeRange, mode: Cooccurrence): string {
  const w = timeRangeLabel(tr);
  const together = mode === "day" ? "on the same day" : "in the same reading";
  return `${names[0]}, ${names[1]}, and ${names[2]} have all appeared ${together} ${count} times in ${w}. ` +
    `Three cards arriving together is rare. ` +
    `This is a full pattern emerging — the kind of message that doesn't repeat by accident.`;
}
function reversedProse(name: string, count: number, tr: TimeRange): string {
  const w = timeRangeLabel(tr);
  return `${name} has appeared reversed ${count} times in ${w}. ` +
    `The reversed orientation has its own voice — blocked, withheld, or shadow. ` +
    `What's the inverted side of ${name} asking you to look at?`;
}

// FN-4 — Inline SVG icons for chips.
function SingleCardIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="7" y="4" width="10" height="16" rx="1" />
    </svg>
  );
}
function TwinCardIcon() {
  return (
    <svg width="22" height="18" viewBox="0 0 28 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="4" y="4" width="10" height="16" rx="1" />
      <rect x="14" y="4" width="10" height="16" rx="1" />
    </svg>
  );
}
function TripletCardIcon() {
  return (
    <svg width="26" height="18" viewBox="0 0 32 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="4" width="9" height="16" rx="1" />
      <rect x="11.5" y="4" width="9" height="16" rx="1" />
      <rect x="21" y="4" width="9" height="16" rx="1" />
    </svg>
  );
}
function ReversedCardIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="7" y="4" width="10" height="16" rx="1" transform="rotate(180 12 12)" />
      <path d="M16 18 L12 22 L8 18" />
    </svg>
  );
}

function Chip({ icon, active, onClick, label }: {
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className="relative inline-flex items-center justify-center px-1.5 pb-1 pt-1 transition-colors"
      style={{
        color: active ? "var(--gold)" : "var(--color-foreground)",
        opacity: active ? 1 : 0.55,
        borderBottom: active ? "1px solid var(--gold)" : "1px solid transparent",
      }}
    >
      {icon}
    </button>
  );
}

function selClass(selectedKey: string | number | null, key: string | number): string {
  if (selectedKey === null) return "";
  return selectedKey === key ? "opacity-100" : "opacity-40";
}

export function StalkersTab({ filters }: { filters: InsightsFilters }) {
  const timeRange = filters.timeRange;
  const [mode, setMode] = useState<Mode>("singles");
  const [cooccurrence, setCooccurrence] = useState<Cooccurrence>("reading");
  const [selectedKey, setSelectedKey] = useState<string | number | null>(null);
  // FQ-5 — Selected occurrence opens a modal over the Stalkers tab; setting
  // null restores the underlying state untouched.
  const [openReadingId, setOpenReadingId] = useState<string | null>(null);

  // FP-4 — Real data via server functions. Match existing useServerFn + useEffect pattern.
  const singlesFn = useServerFn(getStalkerCards);
  const twinsFn = useServerFn(getStalkerTwins);
  const tripletsFn = useServerFn(getStalkerTriplets);
  const reversedFn = useServerFn(getReversedStalkers);

  const [singles, setSingles] = useState<StalkerCardsResult | null>(null);
  const [twins, setTwins] = useState<StalkerTwinsResult | null>(null);
  const [triplets, setTriplets] = useState<StalkerTripletsResult | null>(null);
  const [reversed, setReversed] = useState<ReversedStalkersResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        const [s, t, tr, rv] = await Promise.all([
          singlesFn({ data: filters, headers }).catch((e) => {
            console.warn("[stalkers] singles failed", e);
            return { stalkerCards: [], topCard: null, totalReadings: 0 } satisfies StalkerCardsResult;
          }),
          twinsFn({ data: { ...filters, cooccurrence }, headers }).catch((e) => {
            console.warn("[stalkers] twins failed", e);
            return { twins: [] } satisfies StalkerTwinsResult;
          }),
          tripletsFn({ data: { ...filters, cooccurrence }, headers }).catch((e) => {
            console.warn("[stalkers] triplets failed", e);
            return { triplets: [] } satisfies StalkerTripletsResult;
          }),
          reversedFn({ data: filters, headers }).catch((e) => {
            console.warn("[stalkers] reversed failed", e);
            return { reversedStalkers: [] } satisfies ReversedStalkersResult;
          }),
        ]);
        if (cancelled) return;
        setSingles(s);
        setTwins(t);
        setTriplets(tr);
        setReversed(rv);
        setLoading(false);
      } catch (e) {
        console.warn("[stalkers] load failed", e);
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filters, cooccurrence, singlesFn, twinsFn, tripletsFn, reversedFn]);

  const singlesList: StalkerCard[] = singles?.stalkerCards ?? [];
  const twinsList: StalkerTwin[] = twins?.twins ?? [];
  const tripletsList: StalkerTriplet[] = triplets?.triplets ?? [];
  const reversedList: ReversedStalker[] = reversed?.reversedStalkers ?? [];

  const twinCount = twinsList.length;
  const tripletCount = tripletsList.length;
  const reversedCount = reversedList.length;

  // Auto-select first item when mode changes or data arrives.
  useEffect(() => {
    if (mode === "singles") setSelectedKey(singlesList[0]?.cardId ?? null);
    else if (mode === "twins") setSelectedKey(twinsList[0] ? `${twinsList[0].cardA}-${twinsList[0].cardB}` : null);
    else if (mode === "triplets") setSelectedKey(tripletsList[0] ? tripletsList[0].cardIds.join("-") : null);
    else if (mode === "reversed") setSelectedKey(reversedList[0]?.cardId ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, singles, twins, triplets, reversed]);

  // FP-7 — If selected mode is no longer available (count went to 0), fall back to singles.
  useEffect(() => {
    if (mode === "twins" && twinCount === 0) setMode("singles");
    else if (mode === "triplets" && tripletCount === 0) setMode("singles");
    else if (mode === "reversed" && reversedCount === 0) setMode("singles");
  }, [mode, twinCount, tripletCount, reversedCount]);

  const filledCount =
    mode === "singles" ? singlesList.length
    : mode === "twins" ? twinsList.length
    : mode === "triplets" ? tripletsList.length
    : reversedList.length;
  const slots = Math.max(0, 5 - filledCount);

  const selectedSingle = singlesList.find((s) => s.cardId === selectedKey);
  const selectedTwin = twinsList.find((t) => `${t.cardA}-${t.cardB}` === selectedKey);
  const selectedTriplet = tripletsList.find((t) => t.cardIds.join("-") === selectedKey);
  const selectedReversed = reversedList.find((r) => r.cardId === selectedKey);

  return (
    <div className="px-4 pb-12">
      <header className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-lg font-serif italic">Stalkers</h2>
        <div className="flex items-center gap-2">
          <Chip icon={<SingleCardIcon />} label="Singles" active={mode === "singles"} onClick={() => setMode("singles")} />
          {twinCount > 0 ? (
            <Chip icon={<TwinCardIcon />} label="Twins" active={mode === "twins"} onClick={() => setMode("twins")} />
          ) : null}
          {tripletCount > 0 ? (
            <Chip icon={<TripletCardIcon />} label="Triplets" active={mode === "triplets"} onClick={() => setMode("triplets")} />
          ) : null}
          {reversedCount > 0 ? (
            <Chip icon={<ReversedCardIcon />} label="Reversed" active={mode === "reversed"} onClick={() => setMode("reversed")} />
          ) : null}
        </div>
      </header>

      <div className="text-xs text-muted-foreground mb-3">{TIME_RANGE_LABELS[timeRange]}</div>

      {(mode === "twins" || mode === "triplets") ? (
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs text-muted-foreground">Co-occurring in:</span>
          {/* FT-1 (2C) — match the mode-chip pattern: plain text, underline-on-active. */}
          {(["reading", "day"] as const).map((co) => {
            const active = cooccurrence === co;
            return (
              <button
                key={co}
                type="button"
                onClick={() => setCooccurrence(co)}
                aria-pressed={active}
                className="text-xs pb-0.5 transition-colors"
                style={{
                  color: active ? "var(--gold)" : "var(--color-foreground)",
                  opacity: active ? 1 : 0.55,
                  borderBottom: active ? "1px solid var(--gold)" : "1px solid transparent",
                }}
              >
                {co === "reading" ? "Same reading" : "Same day"}
              </button>
            );
          })}
        </div>
      ) : null}

      {loading && (
        <div className="text-xs text-muted-foreground italic mb-3">Loading stalkers…</div>
      )}

      <div className="mx-auto w-full max-w-3xl mb-8">
        <div className="grid grid-cols-5 gap-2 sm:gap-3 md:gap-4">
          {mode === "singles" &&
            singlesList.map((s) => (
              <div key={s.cardId} className="flex flex-col items-center gap-1">
                <button
                  type="button"
                  onClick={() => setSelectedKey(s.cardId)}
                  className={"w-full transition-opacity duration-200 " + selClass(selectedKey, s.cardId)}
                >
                  <CardImage cardId={s.cardId} size="custom" widthPx={9999} className="w-full" style={{ width: "100%", minHeight: 0 }} />
                </button>
                <span className="text-xs text-muted-foreground tabular-nums">{s.count}</span>
              </div>
            ))}

          {mode === "twins" &&
            twinsList.map((t) => {
              const key = `${t.cardA}-${t.cardB}`;
              return (
                <div key={key} className="flex flex-col items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setSelectedKey(key)}
                    className={"aspect-[2/3] w-full relative transition-opacity duration-200 " + selClass(selectedKey, key)}
                  >
                    <div className="absolute inset-0 -translate-x-1 -translate-y-1">
                      <CardImage cardId={t.cardA} size="custom" widthPx={9999} style={{ width: "100%", minHeight: 0 }} />
                    </div>
                    <div className="absolute inset-0 translate-x-1 translate-y-1">
                      <CardImage cardId={t.cardB} size="custom" widthPx={9999} style={{ width: "100%", minHeight: 0 }} />
                    </div>
                  </button>
                  <span className="text-xs text-muted-foreground tabular-nums">{t.count}</span>
                </div>
              );
            })}

          {mode === "triplets" &&
            tripletsList.map((t) => {
              const key = t.cardIds.join("-");
              return (
                <div key={key} className="flex flex-col items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setSelectedKey(key)}
                    className={"aspect-[2/3] w-full relative transition-opacity duration-200 " + selClass(selectedKey, key)}
                  >
                    <div className="absolute inset-0 -translate-x-1.5 -translate-y-1.5">
                      <CardImage cardId={t.cardIds[0]} size="custom" widthPx={9999} style={{ width: "100%", minHeight: 0 }} />
                    </div>
                    <div className="absolute inset-0">
                      <CardImage cardId={t.cardIds[1]} size="custom" widthPx={9999} style={{ width: "100%", minHeight: 0 }} />
                    </div>
                    <div className="absolute inset-0 translate-x-1.5 translate-y-1.5">
                      <CardImage cardId={t.cardIds[2]} size="custom" widthPx={9999} style={{ width: "100%", minHeight: 0 }} />
                    </div>
                  </button>
                  <span className="text-xs text-muted-foreground tabular-nums">{t.count}</span>
                </div>
              );
            })}

          {mode === "reversed" &&
            reversedList.map((r) => (
              <div key={r.cardId} className="flex flex-col items-center gap-1">
                <button
                  type="button"
                  onClick={() => setSelectedKey(r.cardId)}
                  className={"w-full transition-opacity duration-200 " + selClass(selectedKey, r.cardId)}
                >
                  <CardImage cardId={r.cardId} size="custom" widthPx={9999} reversed style={{ width: "100%", minHeight: 0 }} />
                </button>
                <span className="text-xs text-muted-foreground tabular-nums">{r.reversedCount}</span>
              </div>
            ))}

          {Array.from({ length: slots }).map((_, i) => (
            <div key={`empty-${i}`} className="flex flex-col items-center gap-1">
              <div className="aspect-[2/3] w-full rounded-md border border-dashed border-border/40 opacity-30" />
              <span className="text-xs text-muted-foreground tabular-nums opacity-30">—</span>
            </div>
          ))}
        </div>
      </div>

      {mode === "singles" && selectedSingle ? (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col md:flex-row items-start gap-6">
            <div className="w-1/2 md:w-2/5 max-w-md mx-auto md:mx-0">
              <CardImage cardId={selectedSingle.cardId} size="custom" widthPx={9999} style={{ width: "100%", minHeight: 0 }} />
            </div>
            <div className="flex-1">
              <h3 className="text-base font-serif italic mb-2">{selectedSingle.cardName}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {singleProse(selectedSingle.cardName, selectedSingle.count, timeRange)}
              </p>
            </div>
          </div>
          <StalkerCalendar appearances={selectedSingle.appearances} />
          <StalkerOccurrenceList
            appearances={selectedSingle.appearances}
            onOpenReading={setOpenReadingId}
          />
        </div>
      ) : null}

      {mode === "twins" && selectedTwin ? (
        <div className="flex flex-col gap-4">
          <div className="flex justify-center gap-3 sm:gap-4 md:gap-6 mt-2">
            {[selectedTwin.cardA, selectedTwin.cardB].map((cid) => (
              <div key={cid} className="flex-1 max-w-xs">
                <CardImage cardId={cid} size="custom" widthPx={9999} style={{ width: "100%", minHeight: 0 }} />
              </div>
            ))}
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {twinProse(selectedTwin.cardAName, selectedTwin.cardBName, selectedTwin.count, timeRange, cooccurrence)}
          </p>
          <StalkerCalendar appearances={selectedTwin.appearances} />
          <StalkerOccurrenceList
            appearances={selectedTwin.appearances}
            onOpenReading={setOpenReadingId}
          />
        </div>
      ) : null}

      {mode === "triplets" && selectedTriplet ? (
        <div className="flex flex-col gap-4">
          <div className="flex justify-center gap-3 sm:gap-4 md:gap-6 mt-2">
            {selectedTriplet.cardIds.map((cid) => (
              <div key={cid} className="flex-1 max-w-xs">
                <CardImage cardId={cid} size="custom" widthPx={9999} style={{ width: "100%", minHeight: 0 }} />
              </div>
            ))}
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {tripletProse(selectedTriplet.cardNames, selectedTriplet.count, timeRange, cooccurrence)}
          </p>
          <StalkerCalendar appearances={selectedTriplet.appearances} />
          <StalkerOccurrenceList
            appearances={selectedTriplet.appearances}
            onOpenReading={setOpenReadingId}
          />
        </div>
      ) : null}

      {mode === "reversed" && selectedReversed ? (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col md:flex-row items-start gap-6">
            <div className="w-1/2 md:w-2/5 max-w-md mx-auto md:mx-0">
              <CardImage cardId={selectedReversed.cardId} size="custom" widthPx={9999} reversed style={{ width: "100%", minHeight: 0 }} />
            </div>
            <div className="flex-1">
              <h3 className="text-base font-serif italic mb-2">{selectedReversed.cardName} (reversed)</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {reversedProse(selectedReversed.cardName, selectedReversed.reversedCount, timeRange)}
              </p>
            </div>
          </div>
          <StalkerCalendar appearances={selectedReversed.appearances} />
          <StalkerOccurrenceList
            appearances={selectedReversed.appearances}
            onOpenReading={setOpenReadingId}
          />
        </div>
      ) : null}

      {!loading && filledCount === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
          <Sparkles className="h-8 w-8 mb-2 opacity-40" />
          <p className="text-sm font-serif italic">No {mode} stalkers in this time range yet.</p>
          <p className="text-xs mt-1 opacity-70">Try a wider time range or different filters.</p>
        </div>
      )}

      {/* Filter drawer (matches Journal) */}
      {drawerOpen && (
        <>
          <div
            aria-hidden
            className="fixed inset-0 z-40 bg-transparent"
            style={{ pointerEvents: "none" }}
          />
          <button
            type="button"
            aria-label="Close filters"
            onClick={() => setDrawerOpen(false)}
            className="fixed top-0 z-40 h-dvh w-10 cursor-pointer bg-transparent"
            style={{ right: "var(--journal-drawer-w)" }}
          />
        </>
      )}
      <aside
        aria-hidden={!drawerOpen}
        className="journal-filter-drawer fixed right-0 top-0 z-50 flex h-dvh flex-col overflow-y-auto border-l shadow-2xl transition-transform duration-300 ease-out"
        style={{
          width: "var(--journal-drawer-w)",
          borderColor: "color-mix(in oklab, var(--gold) 18%, transparent)",
          background: "var(--surface-overlay)",
          paddingTop: "calc(env(safe-area-inset-top,0px) + 72px)",
          paddingBottom: "calc(env(safe-area-inset-bottom,0px) + 96px)",
          paddingLeft: 20,
          paddingRight: 20,
          transform: drawerOpen ? "translateX(0)" : "translateX(100%)",
          pointerEvents: drawerOpen ? "auto" : "none",
        }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2
            className="font-display text-[11px] uppercase tracking-[0.22em] text-gold"
            style={{ opacity: "var(--ro-plus-30)" }}
          >
            Filters
          </h2>
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close"
            className="rounded-full p-1 text-muted-foreground hover:text-gold focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
          >
            <XIcon size={16} strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex flex-col gap-5">
          <section>
            <h3
              className="font-display text-[14px] uppercase tracking-[0.18em] mb-2"
              style={{ color: "var(--accent)" }}
            >
              Tags
            </h3>
            <div className="flex flex-wrap gap-x-3 gap-y-2">
              {userTags.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  You have no tags yet. Tag readings to filter by tag here.
                </p>
              ) : (
                userTags.map((tag) => {
                  const active = activeTags.includes(tag.name);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => toggleTag(tag.name)}
                      className="font-display text-[13px] italic transition-colors text-foreground"
                      style={{
                        opacity: active ? 1 : 0.85,
                        borderBottom: active
                          ? "1px solid color-mix(in oklab, var(--gold) 70%, transparent)"
                          : "1px solid transparent",
                        paddingBottom: 2,
                      }}
                    >
                      {tag.name}
                      {active && <span className="ml-1 text-[10px]">×</span>}
                    </button>
                  );
                })
              )}
            </div>
          </section>

          <section>
            <h3
              className="font-display text-[14px] uppercase tracking-[0.18em] mb-2"
              style={{ color: "var(--accent)" }}
            >
              Draw type
            </h3>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {DRAW_TYPE_OPTIONS.map(({ key, label }) => {
                const active = activeDrawTypes.includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleDrawType(key)}
                    className="font-display text-[12px] italic transition-colors text-foreground"
                    style={{
                      opacity: active ? 1 : 0.85,
                      borderBottom: active
                        ? "1px solid color-mix(in oklab, var(--gold) 70%, transparent)"
                        : "1px solid transparent",
                      paddingBottom: 2,
                    }}
                  >
                    {label}
                    {active && <span className="ml-1 text-[10px]">×</span>}
                  </button>
                );
              })}
            </div>
          </section>

          {hasAnyFilter && (
            <button
              type="button"
              onClick={clearFilters}
              className="self-start font-display text-[12px] uppercase tracking-[0.15em] underline-offset-2 hover:underline"
              style={{ color: "var(--gold)", opacity: 1, fontWeight: 700 }}
            >
              CLEAR FILTERS
            </button>
          )}
        </div>
      </aside>

      {/* FQ-4/5 — Reading detail modal opens over the tab. */}
      {openReadingId && (
        <StalkerReadingModal
          readingId={openReadingId}
          onClose={() => setOpenReadingId(null)}
        />
      )}
    </div>
  );
}