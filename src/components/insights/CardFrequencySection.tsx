import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { getCardFrequency } from "@/lib/insights.functions";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import {
  getCardName,
  cardSuit,
  cardType,
  cardNumerologyReduced,
} from "@/lib/tarot";
import { CardImage } from "@/components/card/CardImage";
import { CardCellWithBadge } from "./CardCellWithBadge";
import { ChevronRight } from "lucide-react";
import { useElementWidth } from "@/lib/use-element-width";
import type {
  InsightsFilters,
  CardSortBy,
  CardGroupBy,
} from "@/lib/insights.types";
import { SectionHeader, SkeletonRow } from "./StalkerCardsSection";
import { EmptyNote } from "@/components/ui/empty-note";

type Mode = "bar" | "grid" | "deck";

type Entry = {
  cardId: number;
  count: number;
  reversedCount: number;
  lastSeen: string | null;
};

export function makeCardComparator(sortBy: CardSortBy) {
  return (a: Entry, b: Entry) => {
    switch (sortBy) {
      case "frequency":
        return b.count - a.count || a.cardId - b.cardId;
      case "recent": {
        const ra = a.lastSeen ?? "";
        const rb = b.lastSeen ?? "";
        return rb.localeCompare(ra);
      }
      case "suit_order":
        return a.cardId - b.cardId;
      case "card_number": {
        // Majors first by index; within each suit, by rank (1..14).
        const ra = a.cardId <= 21 ? a.cardId : ((a.cardId - 22) % 14) + 1;
        const rb = b.cardId <= 21 ? b.cardId : ((b.cardId - 22) % 14) + 1;
        return ra - rb || a.cardId - b.cardId;
      }
      case "reversed_pct": {
        const pa = a.count > 0 ? a.reversedCount / a.count : 0;
        const pb = b.count > 0 ? b.reversedCount / b.count : 0;
        return pb - pa || b.count - a.count;
      }
      case "alpha":
        return getCardName(a.cardId).localeCompare(getCardName(b.cardId));
      default:
        return 0;
    }
  };
}

function groupKey(cardId: number, groupBy: CardGroupBy): string {
  switch (groupBy) {
    case "suit":
      return cardSuit(cardId);
    case "number": {
      const n = cardNumerologyReduced(cardId);
      return n === null ? "Courts" : String(n);
    }
    case "type":
      return cardType(cardId);
    case "none":
    default:
      return "all";
  }
}

const SUIT_ORDER = ["Majors", "Wands", "Cups", "Swords", "Pentacles"];
const TYPE_ORDER = ["Major", "Court", "Pip"];

function compareGroupKeys(groupBy: CardGroupBy, a: string, b: string): number {
  if (groupBy === "suit") {
    return SUIT_ORDER.indexOf(a) - SUIT_ORDER.indexOf(b);
  }
  if (groupBy === "type") {
    return TYPE_ORDER.indexOf(a) - TYPE_ORDER.indexOf(b);
  }
  if (groupBy === "number") {
    if (a === "Courts") return 1;
    if (b === "Courts") return -1;
    return Number(a) - Number(b);
  }
  return 0;
}

export function CardFrequencySection({ filters }: { filters: InsightsFilters }) {
  const fn = useServerFn(getCardFrequency);
  const [data, setData] = useState<{
    cards: Entry[];
    totalDraws: number;
    totalReadings: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  // Q60 Fix 5 — Grid is the default mode.
  const [mode, setMode] = useState<Mode>("grid");
  const [showAll, setShowAll] = useState(false);

  const sortBy: CardSortBy = filters.cardSortBy ?? "frequency";
  const groupBy: CardGroupBy = filters.cardGroupBy ?? "none";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        const r = await fn({ data: filters, headers });
        if (!cancelled) {
          setData(r);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filters, fn]);

  const sorted = useMemo(
    () => (data?.cards ?? []).slice().sort(makeCardComparator(sortBy)),
    [data, sortBy],
  );
  const max = sorted[0]?.count ?? 0;

  const groups = useMemo(() => {
    if (groupBy === "none") return null;
    const map = new Map<string, Entry[]>();
    for (const e of sorted) {
      if (e.count === 0) continue;
      const k = groupKey(e.cardId, groupBy);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(e);
    }
    return Array.from(map.entries()).sort((a, b) =>
      compareGroupKeys(groupBy, a[0], b[0]),
    );
  }, [sorted, groupBy]);

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <SectionHeader title="Card Frequency" caption="How often each card has shown up." />
        <ModeToggle mode={mode} onChange={setMode} />
      </div>
      {loading && <SkeletonRow />}
      {!loading && data?.totalReadings === 0 && (
        <EmptyNote text="No cards yet in this time window." />
      )}
      {!loading && data && data.totalReadings > 0 && data.totalReadings < 5 && (
        <p
          style={{
            fontStyle: "italic",
            fontSize: "var(--text-caption, 0.7rem)",
            opacity: 0.7,
          }}
        >
          Frequencies will become richer as you read more.
        </p>
      )}
      {!loading && data && data.totalReadings > 0 && (
        <>
          {groups ? (
            <div className="flex flex-col gap-4">
              {groups.map(([key, entries]) => (
                <div key={key} className="space-y-2">
                  <div
                    style={{
                      fontFamily: "var(--font-serif)",
                      fontStyle: "italic",
                      fontSize: "var(--text-caption, 0.75rem)",
                      opacity: 0.7,
                    }}
                  >
                    {key} · {entries.length} card
                    {entries.length === 1 ? "" : "s"}
                  </div>
                  {mode === "bar" && <BarView entries={entries} max={max} />}
                  {mode === "grid" && <GridView entries={entries} />}
                  {mode === "deck" && <GridView entries={entries} />}
                </div>
              ))}
            </div>
          ) : (
            <>
          {mode === "bar" && (
            <BarView
              entries={(showAll ? sorted : sorted.slice(0, 30)).filter((e) => e.count > 0 || showAll)}
              max={max}
            />
          )}
          {mode === "grid" && <GridView entries={sorted} />}
          {mode === "deck" && <DeckView entries={sorted} />}
          {mode === "bar" && !showAll && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="w-full py-2 text-sm italic"
              style={{ color: "var(--gold)" }}
            >
              Show all 78
            </button>
          )}
            </>
          )}
        </>
      )}
    </section>
  );
}

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const items: Array<{ id: Mode; label: string }> = [
    // Q60 Fix 5 — Grid first, then Bar, then Deck.
    { id: "grid", label: "Grid" },
    { id: "bar", label: "Bar" },
    { id: "deck", label: "Deck" },
  ];
  return (
    <div className="flex gap-1 rounded-full p-0.5" style={{ background: "var(--surface-card)" }}>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          onClick={() => onChange(it.id)}
          className="rounded-full px-2 py-1 text-xs"
          style={{
            background:
              mode === it.id ? "color-mix(in oklch, var(--gold) 24%, transparent)" : "transparent",
            color: mode === it.id ? "var(--gold)" : "var(--color-foreground)",
            fontStyle: "italic",
            opacity: mode === it.id ? 1 : 0.7,
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

function BarRow({ cardId, count, max }: { cardId: number; count: number; max: number }) {
  const navigate = useNavigate();
  const w = max === 0 ? 0 : (count / max) * 100;
  return (
    <button
      type="button"
      onClick={() =>
        navigate({ to: "/insights/card/$cardId", params: { cardId: String(cardId) } })
      }
      className="flex w-full items-center gap-2 py-1.5 text-left"
    >
      {/* EY-7 — unified card render. */}
      <CardImage
        cardId={cardId}
        variant="face"
        size="custom"
        widthPx={28}
        ariaLabel={getCardName(cardId)}
        style={{ opacity: count === 0 ? 0.4 : 1 }}
      />
      <div className="flex-1">
        <div style={{ fontStyle: "italic", fontSize: "var(--text-body-sm)" }}>{getCardName(cardId)}</div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ background: "color-mix(in oklch, var(--gold) 8%, transparent)" }}>
          <div style={{ width: `${w}%`, height: "100%", background: "var(--gold)", opacity: 0.7 }} />
        </div>
      </div>
      <div style={{ minWidth: 24, textAlign: "right", fontStyle: "italic", fontSize: "var(--text-body-sm)", opacity: 0.8 }}>
        {count}
      </div>
      <ChevronRight className="h-4 w-4 opacity-50" />
    </button>
  );
}

function BarView({ entries, max }: { entries: Array<{ cardId: number; count: number }>; max: number }) {
  return (
    <div className="rounded-lg p-2" style={{ background: "var(--surface-card)" }}>
      {entries.map((e) => (
        <BarRow key={e.cardId} cardId={e.cardId} count={e.count} max={max} />
      ))}
    </div>
  );
}

function GridView({ entries }: { entries: Array<{ cardId: number; count: number }> }) {
  const navigate = useNavigate();
  const visible = entries.filter((e) => e.count > 0);
  const gridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
    gap: 16,
    justifyItems: "center",
  } as const;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ ...gridStyle, alignItems: "end" }}>
        {visible.map((e) => (
          <CardCellWithBadge
            key={e.cardId}
            cardId={e.cardId}
            count={e.count}
            onClick={() =>
              navigate({ to: "/insights/card/$cardId", params: { cardId: String(e.cardId) } })
            }
          />
        ))}
      </div>
      <div style={{ ...gridStyle, alignItems: "start", marginTop: 8 }}>
        {visible.map((e) => (
          <span
            key={e.cardId}
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-caption)",
              textAlign: "center",
              opacity: 0.85,
            }}
          >
            {getCardName(e.cardId)}
          </span>
        ))}
      </div>
    </div>
  );
}

function DeckView({ entries }: { entries: Array<{ cardId: number; count: number }> }) {
  const lookup = new Map(entries.map((e) => [e.cardId, e.count]));
  const majors = Array.from({ length: 22 }, (_, i) => i);
  const suits = [
    { name: "Wands", start: 22 },
    { name: "Cups", start: 36 },
    { name: "Swords", start: 50 },
    { name: "Pentacles", start: 64 },
  ];
  return (
    // Q60 Fix 6 — unified horizontal blocks. Majors = 2 rows of 11.
    // Each suit = 2 rows of 7. Same visual rhythm app-wide.
    <div className="space-y-4">
      <section>
        <div className="mb-1 text-[10px] uppercase tracking-widest opacity-60">Majors</div>
        <div className="grid grid-cols-11 gap-1">
          {majors.map((id) => (
            <DeckCell key={id} cardId={id} count={lookup.get(id) ?? 0} />
          ))}
        </div>
      </section>
      {suits.map((s) => (
        <section key={s.name}>
          <div className="mb-1 text-[10px] uppercase tracking-widest opacity-60">{s.name}</div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: 14 }, (_, i) => s.start + i).map((id) => (
              <DeckCell key={id} cardId={id} count={lookup.get(id) ?? 0} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function DeckCell({ cardId, count }: { cardId: number; count: number }) {
  const navigate = useNavigate();
  const { ref, width } = useElementWidth<HTMLButtonElement>();
  return (
    <button
      type="button"
      onClick={() =>
        navigate({ to: "/insights/card/$cardId", params: { cardId: String(cardId) } })
      }
      style={{
        position: "relative",
        background: "transparent",
        border: "none",
        padding: 0,
        cursor: "pointer",
        opacity: count === 0 ? 0.3 : 1,
        width: "100%",
      }}
      ref={ref as never}
    >
      {width > 0 && (
        <CardImage
          cardId={cardId}
          variant="face"
          size="custom"
          widthPx={Math.round(width)}
          ariaLabel={getCardName(cardId)}
          style={{ width: "100%", display: "block" }}
        />
      )}
      {count > 0 && <span className="moonseed-card-badge">{count}×</span>}
    </button>
  );
}