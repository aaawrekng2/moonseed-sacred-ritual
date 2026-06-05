/**
 * Q64 — Card Trace.
 *
 * Single-card history page. Hero, meaning (chips + collapsible),
 * stats strip, weekly trend chart with 30/90/180/All pills,
 * co-occurrence strip, elemental/astrological metadata,
 * expandable calendar, filterable readings list, and a
 * tap-to-generate premium AI reflection (TokenNotice-gated).
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  X,
  ChevronDown,
  Sparkles,
} from "lucide-react";
import { getStalkerCardDetail, getStalkerReflection } from "@/lib/insights.functions";
import {
  getCardPopoverData,
  getCardDrawCounts,
  type CardPopoverData,
} from "@/lib/quicklog.functions";
import { CardStatsPanel } from "@/components/card/CardStatsPanel";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import { useActiveDeckImage } from "@/lib/active-deck";
import { getCardImagePath, getCardName } from "@/lib/tarot";
import { DEFAULT_FILTERS, type TimeRange } from "@/lib/insights.types";
import { GlobalFilterBar } from "@/components/filters/GlobalFilterBar";
import {
  EMPTY_GLOBAL_FILTERS,
  type GlobalFilters,
} from "@/lib/filters.types";
// EJ69 — Removed: useScrollCollapse, no longer needed (slim sticky header
// has no large-to-compact title collapse).
import type { MoonPhaseName } from "@/lib/moon";
import { AdaptiveCardImage } from "@/components/card/AdaptiveCardImage";
// EJ69 — Removed CardImage import (only AdaptiveCardImage is rendered).
import { TagCloud } from "@/components/card/TagCloud";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { DrawCalendar } from "@/components/insights/DrawCalendar";
import { InsightsCardConstellation } from "@/components/insights/InsightsCardConstellation";
import { useTimezone } from "@/lib/use-timezone";
import { ReadingDetailModal } from "@/components/reading/ReadingDetailModal";
import { ReadingRow } from "@/components/ui/reading-row";
import { EmptyNote } from "@/components/ui/empty-note";
import { getCardMeaning } from "@/lib/tarot-meanings";
import { useTokenNotice } from "@/components/ui/TokenNotice";
import { formatDateShort } from "@/lib/dates";

export const Route = createFileRoute("/insights/card/$cardId")({
  component: CardTraceRoute,
  head: ({ params }) => ({
    meta: [
      {
        title: `${getCardName(Number(params.cardId))} — Card Trace — Tarot Seed`,
      },
    ],
  }),
});

/**
 * EJ64 — Thin route wrapper. The real component is CardTraceView,
 * exported so other surfaces (like SpreadLayout's flip-table tap)
 * can render the same view as a modal overlay.
 */
function CardTraceRoute() {
  const { cardId } = Route.useParams();
  const navigate = useNavigate();
  return (
    <CardTraceView
      cardId={Number(cardId)}
      onClose={() => navigate({ to: "/insights" })}
    />
  );
}

type Appearance = {
  readingId: string;
  date: string;
  spreadType: string | null;
  isReversed: boolean;
  question: string | null;
  cardIds: number[];
};

type Detail = {
  cardId: number;
  cardName: string;
  totalCount: number;
  reversedCount: number;
  firstSeen: string | null;
  lastSeen: string | null;
  appearances: Appearance[];
  coOccurrences: Array<{ cardId: number; count: number }>;
  tagCloud?: Array<{ tag: string; count: number }>;
  availableSpreadTypes?: string[];
  availableMoonPhases?: string[];
};

// EJ60 — Roman numerals for the major arcana (cardId 0..21). Used by
// the CardStatsPanel header. Non-majors get null and the panel
// suppresses the slot.
const ROMAN_NUMERALS = [
  "0", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X",
  "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX", "XXI",
];

// EJ60 — Build the header tag list (e.g. ["MAJOR", "CAPRICORN"]) for a
// card. Majors get arcana + zodiac. Minors get suit + element. Empty
// strings filtered out so the panel renders a clean " · "-joined list.
function buildCardTags(
  cardId: number,
  meaning: { element?: string; zodiac?: string | null; planet?: string | null } | null,
): string[] {
  if (!meaning) return [];
  const tags: string[] = [];
  if (cardId <= 21) {
    tags.push("Major");
  } else {
    // Minor arcana: cardId 22..77. Suit derived from blocks of 14.
    const suitIdx = Math.floor((cardId - 22) / 14);
    const suit = ["Wands", "Cups", "Swords", "Pentacles"][suitIdx];
    if (suit) tags.push(suit);
  }
  if (meaning.zodiac) tags.push(meaning.zodiac);
  if (meaning.element) tags.push(meaning.element);
  return tags.filter(Boolean);
}

/**
 * EJ64 — CardTraceView (exported). The main Card Trace render body.
 * Accepts cardId as a prop so the same view can be rendered:
 *   1. By the /insights/card/$cardId route (where the route wrapper
 *      provides cardId from params and onClose that navigates to
 *      /insights).
 *   2. As a portal-rendered modal on top of other surfaces (like
 *      SpreadLayout's flip-table — where onClose just dismisses the
 *      modal and the underlying flip-table state is preserved).
 *
 * Already `fixed inset-0 z-50` so it overlays whatever is beneath
 * without needing a separate wrapper.
 */
export function CardTraceView({
  cardId,
  onClose,
}: {
  cardId: number;
  onClose: () => void;
}) {
  const cid = cardId;
  const navigate = useNavigate();
  const fn = useServerFn(getStalkerCardDetail);
  const popoverFn = useServerFn(getCardPopoverData);
  const drawCountsFn = useServerFn(getCardDrawCounts);
  const [data, setData] = useState<Detail | null>(null);
  // EJ60 — Popover rich-data (12-month sparkline, moon phase, time of day,
  // day of week, companions, longest gap, avg spacing). Same shape and
  // server function used by the constellation hover popover, so the same
  // data appears in both surfaces. Rendered via <CardStatsPanel/>.
  const [popoverData, setPopoverData] = useState<CardPopoverData | null>(null);
  // EJ69 — Rank within the seeker's deck universe for the filter window.
  // Same data the constellation popover uses to render its "#N Rank of M"
  // tile. Fetched separately because the popover's drawCounts comes from
  // ConstellationPage's local state, which Card Trace standalone doesn't
  // have access to.
  const [cardRank, setCardRank] = useState<{ rank: number | null; universeSize: number }>({
    rank: null,
    universeSize: 0,
  });
  const resolveImage = useActiveDeckImage();
  const { user } = useAuth();
  const { effectiveTz } = useTimezone();
  const [openReadingId, setOpenReadingId] = useState<string | null>(null);

  // Q75 — full GlobalFilters state (time range + drawer sections).
  const [gFilters, setGFilters] = useState<GlobalFilters>({
    ...EMPTY_GLOBAL_FILTERS,
    timeRange: "all",
  });
  const trendWin = (gFilters.timeRange ?? "all") as TimeRange;

  // Q75 — user tags for the filter drawer.
  const [userTags, setUserTags] = useState<
    Array<{ id: string; name: string; usage_count: number }>
  >([]);
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    void (async () => {
      const { data: tags } = await supabase
        .from("user_tags")
        .select("id, name, usage_count")
        .eq("user_id", user.id)
        .order("usage_count", { ascending: false })
        .limit(50);
      if (!cancelled) {
        setUserTags(
          (tags ?? []) as Array<{
            id: string;
            name: string;
            usage_count: number;
          }>,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);
  // EJ69 — Removed Q74 reversal-stat fetch. CardStatsPanel handles
  // the Reversed tile via popoverData.reversedPct directly; the same
  // pattern the constellation popover uses (no per-user gating).

  const heroRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    heroRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
  }, [cid]);

  useEffect(() => {
    if (!user?.id) return;
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        const r = await fn({
          data: {
            ...DEFAULT_FILTERS,
            timeRange: trendWin,
            tagIds: gFilters.tags,
            spreadTypes: gFilters.spreadTypes,
            moonPhases: gFilters.moonPhases as MoonPhaseName[],
            deepOnly: gFilters.deepOnly,
            reversedOnly: gFilters.reversedOnly,
            tz: effectiveTz,
            cardId: cid,
          },
          headers,
        });
        setData(r as Detail);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[card-trace] failed", e);
      }
    })();
  }, [
    user?.id,
    cid,
    fn,
    trendWin,
    gFilters.tags,
    gFilters.spreadTypes,
    gFilters.moonPhases,
    gFilters.deepOnly,
    gFilters.reversedOnly,
    effectiveTz,
  ]);

  // EJ60 — Fetch the rich popover-stats data for this single card.
  // Same server function the constellation popover uses; we just pass
  // a single-card list and read out the one entry. Refetches whenever
  // filters change so the panel stays in sync with the page-level
  // filter bar.
  useEffect(() => {
    if (!user?.id || !Number.isFinite(cid)) return;
    let cancelled = false;
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        const map = await popoverFn({
          data: {
            cardIds: [cid],
            tz: effectiveTz,
            filters: {
              timeRange: trendWin,
              tagIds: gFilters.tags,
              spreadTypes: gFilters.spreadTypes,
              moonPhases: gFilters.moonPhases as MoonPhaseName[],
              deepOnly: gFilters.deepOnly,
              reversedOnly: gFilters.reversedOnly,
            },
          },
          headers,
        });
        if (!cancelled) {
          setPopoverData(map[cid] ?? null);
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[card-trace] popover data fetch failed", e);
        if (!cancelled) setPopoverData(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    user?.id,
    cid,
    popoverFn,
    trendWin,
    gFilters.tags,
    gFilters.spreadTypes,
    gFilters.moonPhases,
    gFilters.deepOnly,
    gFilters.reversedOnly,
    effectiveTz,
  ]);

  // EJ69 — Fetch rank + rank universe size for this card. Same server
  // function the constellation page uses to compute the popover's
  // "#N Rank of M" tile. Refetches whenever filters change so rank
  // stays consistent with the filter-window stats.
  useEffect(() => {
    if (!user?.id || !Number.isFinite(cid)) return;
    let cancelled = false;
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        const dc = await drawCountsFn({
          data: {
            cardIds: [cid],
            filters: {
              timeRange: trendWin,
              tagIds: gFilters.tags,
              spreadTypes: gFilters.spreadTypes,
              moonPhases: gFilters.moonPhases as MoonPhaseName[],
              deepOnly: gFilters.deepOnly,
              reversedOnly: gFilters.reversedOnly,
            },
          },
          headers,
        });
        if (!cancelled) {
          setCardRank({
            rank: dc.perCardRank?.[cid] ?? null,
            universeSize: dc.rankUniverseSize ?? 0,
          });
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[card-trace] draw-counts fetch failed", e);
        if (!cancelled) setCardRank({ rank: null, universeSize: 0 });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    user?.id,
    cid,
    drawCountsFn,
    trendWin,
    gFilters.tags,
    gFilters.spreadTypes,
    gFilters.moonPhases,
    gFilters.deepOnly,
    gFilters.reversedOnly,
  ]);

  // EJ64 — `close` now calls the onClose prop instead of hardcoding
  // a navigate to /insights. The route wrapper passes a navigate
  // callback; modal callers pass a dismiss callback that preserves
  // the underlying surface state (e.g. flip-table picks).
  const close = onClose;
  const url = resolveImage(cid, "display") ?? getCardImagePath(cid);
  const cardName = data?.cardName ?? getCardName(cid);
  const meaning = getCardMeaning(cid);
  const appearances = data?.appearances ?? [];
  // EJ69 — Popover-style count: derive from popoverData.monthCounts so
  // Card Trace gating matches the constellation popover surface exactly.
  // The previous `data.totalCount` gate hid the rich panel for cards with
  // sparse history; popover always renders its stat tiles (with 0s if
  // empty) so Card Trace should too.
  const countFromMonthsRich = popoverData?.monthCounts?.reduce(
    (acc, n) => acc + n,
    0,
  );
  const count =
    typeof countFromMonthsRich === "number"
      ? countFromMonthsRich
      : (data?.totalCount ?? 0);
  const totalCount = data?.totalCount ?? 0;
  // EJ69 — reversedCount removed; CardStatsPanel reads reversedPct from
  // popoverData directly.

  // EJ69 — scrollRef retained for the <main> overflow container; the
  // large-to-compact title fade was removed in EJ69 because the slim
  // sticky header always shows the name.
  const scrollRef = useRef<HTMLElement | null>(null);

  return (
    <div
      className="fixed inset-0 flex flex-col"
      style={{
        background: "var(--background)",
        // EJ70 — z above the Tabletop close button (z-50). When Card
        // Trace opens over the flip table, the Tabletop's own X button
        // (top-right, z-50) was showing through alongside Card Trace's
        // own X — two X's at the same corner. Card Trace's opaque
        // full-screen background at z-modal (100) covers it; only Card
        // Trace's X remains.
        zIndex: "var(--z-modal)" as unknown as number,
      }}
    >
      {/* EJ69 — Slim sticky header. Card name always visible (no
          fade-on-scroll, no large scroll-away duplicate below). Back
          arrow left, X close right. Filter bar follows. */}
      <div
        className="page-header-glass sticky top-0"
        style={{ zIndex: "var(--z-sticky-header)" }}
      >
        <header className="flex items-center justify-between px-4 py-2">
          <button type="button" onClick={close} aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1
            className="font-serif italic"
            style={{
              fontSize: "var(--text-heading-sm)",
              color: "var(--color-foreground)",
              opacity: 0.95,
              margin: 0,
              lineHeight: 1,
            }}
          >
            {cardName}
          </h1>
          <button type="button" onClick={close} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </header>
        <GlobalFilterBar
          filters={gFilters}
          onChange={setGFilters}
          sections={["tags", "spreadTypes", "moonPhases", "depth", "reversed"]}
          timeRange={{
            value: gFilters.timeRange ?? "all",
            options: [
              { value: "30d", label: "Last 30 days" },
              { value: "90d", label: "Last 90 days" },
              { value: "180d", label: "Last 180 days" },
              { value: "365d", label: "Last 365 days" },
              { value: "all", label: "All time" },
            ],
            onChange: (v) => setGFilters({ ...gFilters, timeRange: v }),
          }}
          userTags={userTags}
          availableSpreadTypes={data?.availableSpreadTypes}
          availableMoonPhases={data?.availableMoonPhases}
        />
      </div>

      <main ref={scrollRef} className="flex-1 overflow-y-auto px-5 pb-12 pt-6">
        {/* EK41 — Constellation embed at top. The hero is the
            card the seeker is currently viewing; companions are
            the top 7 cards that co-occur with it. Pink lines
            connect every co-occurred pair. Below the web sits the
            12-month (2 rows × 6) calendar with gold-fill on hero
            days. Filter controls (same-pull / same-day pill,
            calendar visibility) live behind the left-side
            hamburger that flies in from the edge. Clicking any
            constellation card toggles it into the teal set —
            with 2+ teal cards a teal badge appears + the calendar
            gains teal strokes on co-occurrence days + an
            asterism breathing fires when 3+ teal cards have met
            in past pulls. The hero is FIXED here (can't be
            swapped from inside the constellation); to explore a
            different card, the seeker navigates away to that
            card's Card Trace page. */}
        <div
          ref={heroRef}
          className="mx-auto"
          style={{ width: "100%", maxWidth: 540 }}
        >
          <InsightsCardConstellation
            heroCardId={cid}
            heroCardName={cardName}
            tz={effectiveTz}
            filters={gFilters}
          />
        </div>

        {/* EJ69 — Rich stats panel directly below the hero. Composition
            mirrors the constellation popover exactly: name + tags +
            tiles + moon/time/day rows + frequency bars + meaning
            (inline, no collapse) + companions + first/last seen +
            longest gap / avg spacing. Single source of truth. */}
        <div className="mx-auto mt-6 px-2" style={{ maxWidth: 480 }}>
          <CardStatsPanel
            cardName={cardName}
            count={count}
            rank={cardRank.rank}
            universeSize={cardRank.universeSize || null}
            data={popoverData}
            resolveCardName={(id) => getCardName(id)}
            roman={cid <= 21 ? ROMAN_NUMERALS[cid] : null}
            tags={buildCardTags(cid, meaning)}
            uprightMeaning={
              meaning
                ? {
                    keywords: meaning.uprightKeywords ?? [],
                    body: meaning.uprightMeaning ?? "",
                  }
                : null
            }
            reversedMeaning={
              meaning
                ? {
                    keywords: meaning.reversedKeywords ?? [],
                    body: meaning.reversedMeaning ?? "",
                  }
                : null
            }
            firstSeen={data?.firstSeen ? formatDateShort(data.firstSeen) : null}
            lastSeen={data?.lastSeen ? formatDateShort(data.lastSeen) : null}
          />
          {/* EJ70 — All-time tag word cloud, scoped to this card,
              independent of the filter bar. Sized by frequency.
              Sits below the companions section inside the same column. */}
          {data?.tagCloud && data.tagCloud.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <TagCloud entries={data.tagCloud} />
            </div>
          )}
        </div>

        {/* EK41 — ExpandableCalendar removed. The 12-month calendar
            now lives inside InsightsCardConstellation at the top of
            this page. Keeping it here would duplicate the same
            visualization on the same screen. */}
        <div className="mx-auto mt-8" style={{ maxWidth: 960 }} />

        <div className="mx-auto mt-2 flex max-w-md flex-col gap-4">
          {data && totalCount === 0 && (
            <EmptyNote text="This card hasn't appeared in your spreads yet — its trace starts here." />
          )}

          {data && count > 0 && (
            <ReadingsList appearances={appearances} onOpen={setOpenReadingId} />
          )}

          {data && (
            <PremiumDetailReflection
              cardId={cid}
              count={data.totalCount}
              latestDate={data.lastSeen ?? new Date().toISOString()}
              appearances={appearances}
            />
          )}
        </div>
      </main>

      {openReadingId && (
        <ReadingDetailModal
          readingId={openReadingId}
          onClose={() => setOpenReadingId(null)}
        />
      )}
    </div>
  );
}

// EJ69 — Dead helpers removed: majorOrSuitLabel, MeaningSection,
// MeaningHeading, StatsStrip, CoOccurrenceStrip, MetadataRow.
// All their content is now folded into CardStatsPanel.


/* ============================================================
 * 3g — Expandable calendar
 * ============================================================ */
function ExpandableCalendar({ appearances }: { appearances: Appearance[] }) {
  const [full, setFull] = useState(false);
  const { effectiveTz } = useTimezone();
  return (
    <div>
      <DrawCalendar
        appearances={appearances}
        monthsBack={full ? 12 : 2}
        tz={effectiveTz}
      />
      <div className="mt-2 flex justify-center">
        <button
          type="button"
          onClick={() => setFull((v) => !v)}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "var(--gold)",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-caption)",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
          }}
          aria-expanded={full}
        >
          {full ? "Show less" : "Show full year"}
          <ChevronDown
            size={14}
            style={{
              transform: full ? "rotate(180deg)" : "none",
              transition: "transform 200ms",
            }}
          />
        </button>
      </div>
    </div>
  );
}

/* ============================================================
 * 3h — Readings list (Q74: top filter bar is the only filter)
 * ============================================================ */
function ReadingsList({
  appearances,
  onOpen,
}: {
  appearances: Appearance[];
  onOpen: (readingId: string) => void;
}) {
  return (
    <div className="flex w-full flex-col gap-3">
      <h2
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-body)",
          margin: 0,
        }}
      >
        Your readings with this card
      </h2>
      {appearances.length === 0 ? (
        <EmptyNote text="No spreads in this time window." />
      ) : (
        <div className="flex flex-col">
          {appearances.map((a) => (
            <ReadingRow
              key={`${a.readingId}-${a.date}`}
              readingId={a.readingId}
              question={a.question ?? null}
              cardIds={a.cardIds}
              createdAt={a.date}
              spreadType={a.spreadType ?? null}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================
 * 3i — Premium AI reflection (tap to generate)
 * ============================================================ */
function PremiumDetailReflection({
  cardId,
  count,
  latestDate,
  appearances,
}: {
  cardId: number;
  count: number;
  latestDate: string;
  appearances: Appearance[];
}) {
  const fn = useServerFn(getStalkerReflection);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(false);
  const { guard, notice } = useTokenNotice();

  const generate = (forceRegenerate = false) => {
    if (loading || (text && !forceRegenerate)) return;
    setLoading(true);
    setErr(false);
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        const payload = buildReflectionPayload(cardId, appearances);
        const r = await fn({
          data: {
            cardId,
            count,
            latestDate,
            ...payload,
            forceRegenerate,
          },
          headers,
        });
        if (r.ok) setText(r.reflection);
        else setErr(true);
      } catch {
        setErr(true);
      } finally {
        setLoading(false);
      }
    })();
  };

  if (text) {
    return (
      <div className="flex flex-col gap-2">
        <div
          className="w-full p-4"
          style={{
            background: "color-mix(in oklch, var(--gold) 10%, transparent)",
            borderRadius: 14,
            color: "var(--gold)",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            lineHeight: 1.5,
            opacity: 0.95,
            whiteSpace: "pre-line",
          }}
        >
          {text}
        </div>
        <button
          type="button"
          onClick={() => {
            setText(null);
            guard(() => generate(true));
          }}
          disabled={loading}
          className="self-end text-xs italic"
          style={{
            background: "transparent",
            border: "none",
            color: "var(--gold)",
            opacity: loading ? 0.5 : 0.7,
            cursor: loading ? "wait" : "pointer",
            fontFamily: "var(--font-serif)",
          }}
        >
          Regenerate
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        disabled={loading}
        onClick={() => guard(() => generate(false))}
        className="flex w-full items-center justify-center gap-2 p-4"
        style={{
          background: "color-mix(in oklch, var(--gold) 12%, transparent)",
          borderRadius: 14,
          color: "var(--gold)",
          fontStyle: "italic",
          fontFamily: "var(--font-serif)",
          opacity: loading ? 0.6 : 1,
          cursor: loading ? "wait" : "pointer",
        }}
      >
        <Sparkles className="h-4 w-4" />
        {loading
          ? "Reflection generating…"
          : err
            ? "Try again"
            : "What does this card's pattern mean for you?"}
      </button>
      {notice}
    </>
  );
}

function buildReflectionPayload(cardId: number, appearances: Appearance[]) {
  const seen = new Set<string>();
  const sampleQuestions: string[] = [];
  for (const a of appearances) {
    const q = (a.question ?? "").trim();
    if (q.length > 3 && !seen.has(q)) {
      seen.add(q);
      sampleQuestions.push(q);
    }
    if (sampleQuestions.length >= 10) break;
  }

  const coOccCounts = new Map<number, number>();
  for (const a of appearances) {
    for (const cid of a.cardIds ?? []) {
      if (cid === cardId) continue;
      coOccCounts.set(cid, (coOccCounts.get(cid) ?? 0) + 1);
    }
  }
  const coOccurringCards = [...coOccCounts.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .map(([cid, c]) => ({ cardName: getCardName(cid), count: c }));

  const spreadCounts = new Map<string, number>();
  for (const a of appearances) {
    const s = a.spreadType ?? "single";
    spreadCounts.set(s, (spreadCounts.get(s) ?? 0) + 1);
  }
  const spreadTypes = [...spreadCounts.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([label, c]) => ({ label, count: c }));

  const reversedCount = appearances.filter((a) => a.isReversed).length;

  return { sampleQuestions, coOccurringCards, spreadTypes, reversedCount };
}
