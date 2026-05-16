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
  SlidersHorizontal,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { getStalkerCardDetail, getStalkerReflection } from "@/lib/insights.functions";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import { useActiveDeckImage } from "@/lib/active-deck";
import { getCardImagePath, getCardName } from "@/lib/tarot";
import { DEFAULT_FILTERS, type TimeRange } from "@/lib/insights.types";
import { Dropdown } from "@/components/filters/Dropdown";
import { AdaptiveCardImage } from "@/components/card/AdaptiveCardImage";
import { CardImage } from "@/components/card/CardImage";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { formatDateShort } from "@/lib/dates";
import { DrawCalendar } from "@/components/insights/DrawCalendar";
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

  // Q74 — page-level time filter drives the server fetch. Defaults to
  // "all" so the appearance count matches the Insights Cards grid.
  const [trendWin, setTrendWin] = useState<TimeRange>("all");

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
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        const r = await fn({
          data: { ...DEFAULT_FILTERS, timeRange: trendWin, cardId: cid },
          headers,
        });
        setData(r as Detail);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[card-trace] failed", e);
      }
    })();
  }, [cid, fn, trendWin]);

  const close = () => navigate({ to: "/insights" });
  const url = resolveImage(cid, "display") ?? getCardImagePath(cid);
  const cardName = data?.cardName ?? getCardName(cid);
  const meaning = getCardMeaning(cid);
  const appearances = data?.appearances ?? [];
  const count = data?.totalCount ?? 0;
  const reversedCount = data?.reversedCount ?? 0;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: "var(--background)" }}
    >
      <header
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <button type="button" onClick={close} aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div style={{ textAlign: "center", lineHeight: 1.1 }}>
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
        <button type="button" onClick={close} aria-label="Close">
          <X className="h-5 w-5" />
        </button>
      </header>

      {/* Q74 — page-level time filter bar, styled to match the main
          Insights GlobalFilterBar (sliders icon + shared Dropdown). */}
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <span
          className="shrink-0 inline-flex items-center justify-center p-1"
          style={{ color: "var(--color-foreground)", opacity: 0.7 }}
          aria-hidden
        >
          <SlidersHorizontal className="h-4 w-4" />
        </span>
        <Dropdown
          value={trendWin}
          options={[
            { value: "30d", label: "Last 30 days" },
            { value: "90d", label: "Last 90 days" },
            { value: "365d", label: "Last 365 days" },
            { value: "all", label: "All time" },
          ]}
          onChange={(v) => setTrendWin(v as TimeRange)}
        />
      </div>

      <main className="flex-1 overflow-y-auto px-5 pb-12 pt-4">
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

          {/* 3d — Trend line */}
          {data && count > 0 && (
            <CardTrendChart appearances={appearances} win={trendWin} />
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
 * 3d — Trend chart with time-window pills
 * ============================================================ */
function CardTrendChart({
  appearances,
  win,
}: {
  appearances: Appearance[];
  win: TimeRange;
}) {
  const data = useMemo(() => weeklyBuckets(appearances, win), [appearances, win]);
  return (
    <div className="w-full">
      <div style={{ width: "100%", height: 140 }}>
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="cardTrendGold" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--gold)" stopOpacity={0.18} />
                <stop offset="100%" stopColor="var(--gold)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="2 4"
              stroke="color-mix(in oklab, var(--color-foreground) 12%, transparent)"
              vertical={false}
            />
            <XAxis
              dataKey="label"
              tick={{ fill: "var(--foreground-muted)", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              minTickGap={20}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fill: "var(--foreground-muted)", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={20}
            />
            <Tooltip
              contentStyle={{
                background: "var(--surface-elevated)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 6,
                fontSize: 12,
              }}
              labelStyle={{ color: "var(--foreground-muted)" }}
            />
            <Area
              type="monotone"
              dataKey="count"
              stroke="var(--gold)"
              strokeWidth={2}
              strokeOpacity={0.9}
              fill="url(#cardTrendGold)"
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function weeklyBuckets(appearances: Appearance[], win: TimeRange) {
  const now = Date.now();
  const days =
    win === "7d" ? 7
    : win === "30d" ? 30
    : win === "90d" ? 90
    : win === "365d" ? 365
    : null;
  const start =
    days !== null
      ? now - days * 86400000
      : appearances.length
        ? new Date(appearances[appearances.length - 1].date).getTime()
        : now - 90 * 86400000;
  // Bucket per ISO week (anchored to Monday).
  const weekKey = (ms: number) => {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    const day = (d.getDay() + 6) % 7; // Mon=0
    d.setDate(d.getDate() - day);
    return d.getTime();
  };
  const counts = new Map<number, number>();
  for (const a of appearances) {
    const ms = new Date(a.date).getTime();
    if (ms < start) continue;
    const k = weekKey(ms);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const out: Array<{ label: string; count: number }> = [];
  for (let k = weekKey(start); k <= now; k += 7 * 86400000) {
    const d = new Date(k);
    out.push({
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      count: counts.get(k) ?? 0,
    });
  }
  return out;
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
        className="flex gap-3 overflow-x-auto"
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
            {/* Q74 — taller thumbnails (~110px mobile / 140px desktop tall
                from ~0.62 aspect → widths of 68px and 87px). */}
            <div className="md:hidden">
              <CardImage cardId={e.cardId} size="custom" widthPx={68} />
            </div>
            <div className="hidden md:block">
              <CardImage cardId={e.cardId} size="custom" widthPx={87} />
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
  items.push(`Yes/No: ${meaning.yesNo}`);
  if (meaning.numerology !== null) items.push(`№ ${meaning.numerology}`);
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
  return (
    <div>
      <DrawCalendar
        appearances={appearances}
        monthsBack={full ? 12 : 2}
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
              question={
                a.question ??
                (a.spreadType
                  ? `${a.spreadType} · ${formatDateShort(a.date)}`
                  : formatDateShort(a.date))
              }
              cardIds={a.cardIds}
              createdAt={a.date}
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
}: {
  cardId: number;
  count: number;
  latestDate: string;
}) {
  const fn = useServerFn(getStalkerReflection);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(false);
  const { guard, notice } = useTokenNotice();

  const generate = () => {
    if (loading || text) return;
    setLoading(true);
    setErr(false);
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        const r = await fn({
          data: { cardId, count, latestDate, sampleQuestions: [] },
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
    );
  }

  return (
    <>
      <button
        type="button"
        disabled={loading}
        onClick={() => guard(generate)}
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