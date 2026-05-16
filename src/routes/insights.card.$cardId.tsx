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
  Filter,
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
import { DEFAULT_FILTERS } from "@/lib/insights.types";
import { AdaptiveCardImage } from "@/components/card/AdaptiveCardImage";
import { CardImage } from "@/components/card/CardImage";
import { useAuth } from "@/lib/auth";
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

type TrendWindow = "30d" | "90d" | "180d" | "all";

function CardTraceRoute() {
  const { cardId } = Route.useParams();
  const cid = Number(cardId);
  const navigate = useNavigate();
  const fn = useServerFn(getStalkerCardDetail);
  const [data, setData] = useState<Detail | null>(null);
  const resolveImage = useActiveDeckImage();
  useAuth();
  const [openReadingId, setOpenReadingId] = useState<string | null>(null);

  const heroRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    heroRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
  }, [cid]);

  useEffect(() => {
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        const r = await fn({ data: { ...DEFAULT_FILTERS, cardId: cid }, headers });
        setData(r as Detail);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[card-trace] failed", e);
      }
    })();
  }, [cid, fn]);

  const close = () => navigate({ to: "/insights" });
  const url = resolveImage(cid, "display") ?? getCardImagePath(cid);
  const cardName = data?.cardName ?? getCardName(cid);
  const meaning = getCardMeaning(cid);

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
          {data && <StatsStrip data={data} />}

          {/* 3d — Trend line */}
          {data && data.totalCount > 0 && (
            <CardTrendChart appearances={data.appearances} />
          )}

          {/* 3e — Co-occurrence */}
          {data && data.totalCount >= 3 && data.coOccurrences.length > 0 && (
            <CoOccurrenceStrip
              entries={data.coOccurrences}
              onPick={(targetId) =>
                navigate({
                  to: "/insights/card/$cardId",
                  params: { cardId: String(targetId) },
                })
              }
            />
          )}

          {/* 3f — Metadata row */}
          {meaning && <MetadataRow meaning={meaning} />}
        </div>

        {/* 3g — Calendar — wider container */}
        {data && data.totalCount > 0 && (
          <div className="mx-auto my-6" style={{ maxWidth: 960 }}>
            <ExpandableCalendar appearances={data.appearances} />
          </div>
        )}

        {/* 3h + 3i — Readings list and AI reflection */}
        <div className="mx-auto flex max-w-md flex-col gap-4">
          {data && data.totalCount === 0 && (
            <EmptyNote text="This card hasn't appeared in your readings yet." />
          )}

          {data && data.totalCount > 0 && (
            <ReadingsList
              appearances={data.appearances}
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
      <div className="flex w-full flex-wrap justify-center gap-2">
        {meaning.uprightKeywords.map((k) => (
          <KeywordChip key={`u-${k}`} text={k} variant="upright" />
        ))}
      </div>
      <div className="flex w-full flex-wrap justify-center gap-2">
        {meaning.reversedKeywords.map((k) => (
          <KeywordChip key={`r-${k}`} text={k} variant="reversed" />
        ))}
      </div>
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
          <p style={meaningPara}>{meaning.uprightMeaning}</p>
          <div
            style={{
              borderTop:
                "1px solid color-mix(in oklab, var(--color-foreground) 8%, transparent)",
            }}
          />
          <div>
            <div
              style={{
                fontSize: "var(--text-caption)",
                opacity: 0.6,
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                marginBottom: 4,
              }}
            >
              Reversed
            </div>
            <p style={meaningPara}>{meaning.reversedMeaning}</p>
          </div>
        </div>
      )}
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

function KeywordChip({
  text,
  variant,
}: {
  text: string;
  variant: "upright" | "reversed";
}) {
  const isUpright = variant === "upright";
  return (
    <span
      style={{
        fontFamily: "var(--font-serif)",
        fontStyle: "italic",
        fontSize: "var(--text-caption)",
        padding: "4px 10px",
        borderRadius: 999,
        background: isUpright
          ? "color-mix(in oklch, var(--gold) 18%, transparent)"
          : "color-mix(in oklch, var(--color-foreground) 8%, transparent)",
        color: isUpright ? "var(--gold)" : "var(--foreground-muted)",
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

/* ============================================================
 * 3c — Stats strip
 * ============================================================ */
function StatsStrip({ data }: { data: Detail }) {
  const reversalRate =
    data.totalCount === 0
      ? 0
      : Math.round((data.reversedCount / data.totalCount) * 100);
  if (data.totalCount === 0) return null;
  return (
    <div
      className="grid w-full"
      style={{
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 12,
        padding: "16px 8px",
      }}
    >
      <Stat value={String(data.totalCount)} label="appearances" />
      <Stat
        value={data.firstSeen ? formatDateShort(data.firstSeen) : "—"}
        label="first drawn"
      />
      <Stat value={`${reversalRate}%`} label="reversed" />
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "1.6rem",
          color: "var(--gold)",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: "var(--text-caption)",
          opacity: 0.7,
          marginTop: 4,
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
        }}
      >
        {label}
      </div>
    </div>
  );
}

/* ============================================================
 * 3d — Trend chart with time-window pills
 * ============================================================ */
function CardTrendChart({ appearances }: { appearances: Appearance[] }) {
  const [win, setWin] = useState<TrendWindow>("90d");
  const data = useMemo(() => weeklyBuckets(appearances, win), [appearances, win]);
  return (
    <div className="w-full">
      <div className="mb-2 flex justify-center gap-2">
        {(["30d", "90d", "180d", "all"] as TrendWindow[]).map((w) => (
          <PillButton key={w} active={win === w} onClick={() => setWin(w)}>
            {w === "all" ? "All" : w}
          </PillButton>
        ))}
      </div>
      <div style={{ width: "100%", height: 140 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
            <Line
              type="monotone"
              dataKey="count"
              stroke="var(--gold)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function PillButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "4px 12px",
        borderRadius: 999,
        border: "1px solid",
        borderColor: active
          ? "var(--gold)"
          : "color-mix(in oklab, var(--color-foreground) 14%, transparent)",
        background: active
          ? "color-mix(in oklch, var(--gold) 18%, transparent)"
          : "transparent",
        color: active ? "var(--gold)" : "var(--color-foreground)",
        fontFamily: "var(--font-serif)",
        fontStyle: "italic",
        fontSize: "var(--text-caption)",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function weeklyBuckets(appearances: Appearance[], win: TrendWindow) {
  const now = Date.now();
  const days = win === "30d" ? 30 : win === "90d" ? 90 : win === "180d" ? 180 : null;
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
            <CardImage cardId={e.cardId} size="custom" widthPx={60} />
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
 * 3h — Readings list with filters
 * ============================================================ */
type SpreadFilter = "all" | "single" | "three" | "celtic" | "yesno" | "custom";
type OrientationFilter = "all" | "upright" | "reversed";

function ReadingsList({
  appearances,
  onOpen,
}: {
  appearances: Appearance[];
  onOpen: (readingId: string) => void;
}) {
  const [spread, setSpread] = useState<SpreadFilter>("all");
  const [orient, setOrient] = useState<OrientationFilter>("all");

  const filtered = useMemo(
    () =>
      appearances.filter((a) => {
        if (orient === "upright" && a.isReversed) return false;
        if (orient === "reversed" && !a.isReversed) return false;
        if (spread === "all") return true;
        return matchesSpread(a.spreadType, spread);
      }),
    [appearances, spread, orient],
  );

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
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["all", "All"],
            ["single", "Single"],
            ["three", "3-Card"],
            ["celtic", "Celtic"],
            ["yesno", "Yes/No"],
            ["custom", "Custom"],
          ] as Array<[SpreadFilter, string]>
        ).map(([k, label]) => (
          <PillButton key={k} active={spread === k} onClick={() => setSpread(k)}>
            {label}
          </PillButton>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["all", "Both"],
            ["upright", "Upright"],
            ["reversed", "Reversed"],
          ] as Array<[OrientationFilter, string]>
        ).map(([k, label]) => (
          <PillButton key={k} active={orient === k} onClick={() => setOrient(k)}>
            {label}
          </PillButton>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyNote text="No readings match these filters." />
      ) : (
        <div className="flex flex-col">
          {filtered.map((a) => (
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

function matchesSpread(
  spreadType: string | null,
  filter: SpreadFilter,
): boolean {
  const s = (spreadType ?? "").toLowerCase();
  switch (filter) {
    case "single":
      return s.includes("single") || s === "1" || s.includes("daily");
    case "three":
      return s.includes("three") || s.includes("3");
    case "celtic":
      return s.includes("celtic");
    case "yesno":
      return s.includes("yes") || s.includes("no");
    case "custom":
      return s.includes("custom") || s === "" || s === null;
    default:
      return true;
  }
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