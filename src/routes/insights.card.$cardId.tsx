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
import { getAuthHeaders } from "@/lib/server-fn-auth";
import { useActiveDeckImage } from "@/lib/active-deck";
import { getCardImagePath, getCardName } from "@/lib/tarot";
import { DEFAULT_FILTERS, type TimeRange } from "@/lib/insights.types";
import { GlobalFilterBar } from "@/components/filters/GlobalFilterBar";
import {
  EMPTY_GLOBAL_FILTERS,
  type GlobalFilters,
} from "@/lib/filters.types";
import { useScrollCollapse } from "@/lib/use-scroll-collapse";
import type { MoonPhaseName } from "@/lib/moon";
import { AdaptiveCardImage } from "@/components/card/AdaptiveCardImage";
import { CardImage } from "@/components/card/CardImage";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { DrawCalendar } from "@/components/insights/DrawCalendar";
import { useTimezone } from "@/lib/use-timezone";
import { ReadingDetailModal } from "@/components/reading/ReadingDetailModal";
import { ReadingRow } from "@/components/ui/reading-row";
import { EmptyNote } from "@/components/ui/empty-note";
import { getCardMeaning } from "@/lib/tarot-meanings";
import { useTokenNotice } from "@/components/ui/TokenNotice";

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
  availableSpreadTypes?: string[];
  availableMoonPhases?: string[];
};

function CardTraceRoute() {
  const { cardId } = Route.useParams();
  const cid = Number(cardId);
  const navigate = useNavigate();
  const fn = useServerFn(getStalkerCardDetail);
  const [data, setData] = useState<Detail | null>(null);
  const resolveImage = useActiveDeckImage();
  const { user } = useAuth();
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

  // Q74 — reversal stat visibility (track_reversals OR allow_reversed_cards).
  const [showReversalStat, setShowReversalStat] = useState(false);
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    void (async () => {
      const { data: prefs } = await supabase
        .from("user_preferences")
        .select("track_reversals, allow_reversed_cards")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      const row = prefs as
        | { track_reversals?: boolean | null; allow_reversed_cards?: boolean | null }
        | null;
      setShowReversalStat(
        Boolean(row?.track_reversals) || Boolean(row?.allow_reversed_cards),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

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
  ]);

  const close = () => navigate({ to: "/insights" });
  const url = resolveImage(cid, "display") ?? getCardImagePath(cid);
  const cardName = data?.cardName ?? getCardName(cid);
  const meaning = getCardMeaning(cid);
  const appearances = data?.appearances ?? [];
  const count = data?.totalCount ?? 0;
  const reversedCount = data?.reversedCount ?? 0;

  // Q75 — sticky compact title collapse on scroll.
  const scrollRef = useRef<HTMLElement | null>(null);
  const collapseProgress = useScrollCollapse(scrollRef, 80);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: "var(--background)" }}
    >
      {/* Q75 — sticky glass header with compact-on-scroll card name. */}
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
              opacity: 0.9 * collapseProgress,
              transition: "opacity 150ms ease-out",
              margin: 0,
              lineHeight: 1,
              pointerEvents: collapseProgress > 0.5 ? "auto" : "none",
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

      <main ref={scrollRef} className="flex-1 overflow-y-auto px-5 pb-12 pt-4">
        {/* Q75 — large non-sticky title that scrolls away. */}
        <div
          className="mx-auto mb-4 text-center"
          style={{ maxWidth: 1280, lineHeight: 1.15 }}
        >
          <div
            style={{
              fontSize: "var(--text-caption)",
              opacity: 0.55,
              fontStyle: "italic",
              fontFamily: "var(--font-serif)",
            }}
          >
            Card Trace
          </div>
          <h1
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-heading-lg)",
              color: "var(--color-foreground)",
              opacity: 0.9,
              margin: 0,
            }}
          >
            {cardName}
          </h1>
        </div>
        {/* Q75 — wide constrained content area. */}
        <div className="mx-auto" style={{ maxWidth: 1280 }}>
        <div className="mx-auto flex max-w-md flex-col items-center gap-5">
          {/* 3a — Hero */}
          <div
            ref={heroRef}
            style={{ width: "min(85vw, 250px)" }}
            className="md:!w-[300px]"
          >
            <AdaptiveCardImage src={url} alt={cardName} />
          </div>
          <div style={{ textAlign: "center" }}>
            {meaning && (
              <div
                style={{
                  fontSize: "var(--text-caption)",
                  color: "var(--foreground-muted)",
                  opacity: 0.85,
                }}
              >
                {majorOrSuitLabel(cid)} · {meaning.element}
              </div>
            )}
          </div>

          {/* 3b — Meaning */}
          {meaning && <MeaningSection meaning={meaning} />}

          {/* 3c — Stats strip */}
          {data && count > 0 && (
            <StatsStrip
              count={count}
              reversedCount={reversedCount}
              showReversalStat={showReversalStat}
            />
          )}

          {/* 3f — Metadata row */}
          {meaning && <MetadataRow meaning={meaning} />}
        </div>

        {/* 3e — Co-occurrence — Q74: span the wider content area. */}
        {data && data.totalCount >= 3 && data.coOccurrences.length > 0 && (
          <div className="mx-auto my-6" style={{ maxWidth: 960 }}>
            <CoOccurrenceStrip
              entries={data.coOccurrences}
              onPick={(targetId) =>
                navigate({
                  to: "/insights/card/$cardId",
                  params: { cardId: String(targetId) },
                })
              }
            />
          </div>
        )}

        {/* 3g — Calendar — wider container */}
        {data && count > 0 && (
          <div className="mx-auto my-6" style={{ maxWidth: 960 }}>
            <ExpandableCalendar appearances={appearances} />
          </div>
        )}

        {/* 3h + 3i — Readings list and AI reflection */}
        <div className="mx-auto flex max-w-md flex-col gap-4">
          {data && data.totalCount === 0 && (
            <EmptyNote text="This card hasn't appeared in your readings yet." />
          )}

          {data && count > 0 && (
            <ReadingsList
              appearances={appearances}
              onOpen={setOpenReadingId}
            />
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

function majorOrSuitLabel(cid: number): string {
  if (cid <= 21) return "Major Arcana";
  if (cid <= 35) return "Wands";
  if (cid <= 49) return "Cups";
  if (cid <= 63) return "Swords";
  return "Pentacles";
}

/* ============================================================
 * 3b — Meaning chips + collapsible accordion
 * ============================================================ */
function MeaningSection({
  meaning,
}: {
  meaning: NonNullable<ReturnType<typeof getCardMeaning>>;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="flex w-full flex-col items-center gap-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: "var(--gold)",
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-caption)",
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
        aria-expanded={expanded}
      >
        {expanded ? "Hide meaning" : "Show meaning"}
        <ChevronDown
          size={14}
          style={{
            transform: expanded ? "rotate(180deg)" : "none",
            transition: "transform 200ms",
          }}
        />
      </button>
      {expanded && (
        <div
          style={{
            width: "100%",
            maxWidth: 480,
            display: "grid",
            gap: 12,
            background: "var(--surface-card)",
            padding: 14,
            borderRadius: 12,
          }}
        >
          <div>
            <MeaningHeading>Upright</MeaningHeading>
            <p style={meaningPara}>{meaning.uprightKeywords.join(", ")}.</p>
            <p style={{ ...meaningPara, marginTop: 8 }}>{meaning.uprightMeaning}</p>
          </div>
          <div
            style={{
              borderTop:
                "1px solid color-mix(in oklab, var(--color-foreground) 8%, transparent)",
            }}
          />
          <div>
            <MeaningHeading>Reversed</MeaningHeading>
            <p style={meaningPara}>{meaning.reversedKeywords.join(", ")}.</p>
            <p style={{ ...meaningPara, marginTop: 8 }}>{meaning.reversedMeaning}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function MeaningHeading({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: "var(--font-serif)",
        fontStyle: "italic",
        fontSize: "var(--text-caption)",
        textTransform: "uppercase",
        letterSpacing: "0.15em",
        color: "var(--gold)",
        opacity: 0.8,
        marginBottom: 6,
        textAlign: "center",
      }}
    >
      {children}
    </div>
  );
}

const meaningPara: React.CSSProperties = {
  fontFamily: "var(--font-serif)",
  fontStyle: "italic",
  fontSize: "var(--text-body)",
  lineHeight: 1.6,
  margin: 0,
  textAlign: "center",
};

/* ============================================================
 * 3c — Stats strip
 * ============================================================ */
function StatsStrip({
  count,
  reversedCount,
  showReversalStat,
}: {
  count: number;
  reversedCount: number;
  showReversalStat: boolean;
}) {
  const reversalRate =
    count === 0 ? 0 : Math.round((reversedCount / count) * 100);
  if (count === 0) return null;
  const showReversal = showReversalStat && reversalRate > 0;
  return (
    <div
      className="w-full flex flex-col items-center"
      style={{ padding: "16px 8px", gap: 4 }}
    >
      <div
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "3rem",
          color: "var(--gold)",
          lineHeight: 1,
        }}
      >
        {count}
      </div>
      <div
        style={{
          fontSize: "var(--text-caption)",
          opacity: 0.7,
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
        }}
      >
        appearances
      </div>
      {showReversal && (
        <div
          style={{
            marginTop: 4,
            fontSize: "var(--text-caption)",
            opacity: 0.6,
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            color: "var(--foreground-muted)",
          }}
        >
          {reversalRate}% reversed
        </div>
      )}
    </div>
  );
}

/* ============================================================
 * 3e — Co-occurrence
 * ============================================================ */
function CoOccurrenceStrip({
  entries,
  onPick,
}: {
  entries: Array<{ cardId: number; count: number }>;
  onPick: (cardId: number) => void;
}) {
  // Q75 — on desktop, center the strip when ≤6 cards fit; otherwise
  // fall back to horizontal scroll. Mobile always scrolls.
  const fewEnough = entries.length <= 6;
  return (
    <div className="w-full">
      <h2
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-body)",
          margin: "0 0 8px",
          textAlign: "center",
        }}
      >
        Often appears with
      </h2>
      <div
        className={
          fewEnough
            ? "flex gap-3 overflow-x-auto md:justify-center md:overflow-visible"
            : "flex gap-3 overflow-x-auto"
        }
        style={{ paddingBottom: 6 }}
      >
        {entries.map((e) => (
          <button
            key={e.cardId}
            type="button"
            onClick={() => onPick(e.cardId)}
            style={{
              flex: "0 0 auto",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: 0,
              textAlign: "center",
            }}
            aria-label={`${getCardName(e.cardId)} — ${e.count} co-occurrences`}
          >
            {/* Q75 — larger thumbnails: 110px tall mobile (≈68px wide),
                160px tall desktop (≈100px wide). */}
            <div className="md:hidden">
              <CardImage cardId={e.cardId} size="custom" widthPx={68} />
            </div>
            <div className="hidden md:block">
              <CardImage cardId={e.cardId} size="custom" widthPx={100} />
            </div>
            <div
              style={{
                marginTop: 4,
                fontSize: "var(--text-caption)",
                fontStyle: "italic",
                color: "var(--foreground-muted)",
                fontFamily: "var(--font-serif)",
              }}
            >
              ×{e.count}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
 * 3f — Metadata row
 * ============================================================ */
function MetadataRow({
  meaning,
}: {
  meaning: NonNullable<ReturnType<typeof getCardMeaning>>;
}) {
  const items: string[] = [];
  items.push(`${meaning.element}`);
  if (meaning.zodiac) items.push(meaning.zodiac);
  if (meaning.planet) items.push(meaning.planet);
  if (meaning.numerology !== null) items.push(`№ ${meaning.numerology}`);
  const leansLabel =
    meaning.yesNo === "yes"
      ? "Leans Yes"
      : meaning.yesNo === "no"
        ? "Leans No"
        : "Leans Neutral";
  items.push(leansLabel);
  return (
    <div
      style={{
        fontSize: "var(--text-caption)",
        color: "var(--foreground-muted)",
        fontFamily: "var(--font-serif)",
        fontStyle: "italic",
        textAlign: "center",
      }}
    >
      {items.join(" · ")}
    </div>
  );
}

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
        <EmptyNote text="No readings in this time window." />
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