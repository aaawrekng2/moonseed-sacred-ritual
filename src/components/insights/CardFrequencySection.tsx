import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { getCardFrequency } from "@/lib/insights.functions";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { updateUserPreferences } from "@/lib/user-preferences-write";
import {
  getCardName,
  cardSuit,
  cardType,
} from "@/lib/tarot";
import { CardImage } from "@/components/card/CardImage";
import { CardCellWithBadge } from "./CardCellWithBadge";
import { CardCountBadge } from "@/components/ui/CardCountBadge";
import { ChevronRight, Scaling } from "lucide-react";
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
      // Q94 #7 — group by raw rank, NOT numerology reduction. Tens
      // belong with Tens, not with Aces.
      if (cardId <= 21) return "Majors";
      const posInSuit = (cardId - 22) % 14;
      if (posInSuit <= 9) {
        const rankNames = [
          "Aces", "Twos", "Threes", "Fours", "Fives",
          "Sixes", "Sevens", "Eights", "Nines", "Tens",
        ];
        return rankNames[posInSuit];
      }
      const courtNames = ["Pages", "Knights", "Queens", "Kings"];
      return courtNames[posInSuit - 10];
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
const RANK_ORDER = [
  "Majors",
  "Aces", "Twos", "Threes", "Fours", "Fives",
  "Sixes", "Sevens", "Eights", "Nines", "Tens",
  "Pages", "Knights", "Queens", "Kings",
];

function compareGroupKeys(groupBy: CardGroupBy, a: string, b: string): number {
  if (groupBy === "suit") {
    return SUIT_ORDER.indexOf(a) - SUIT_ORDER.indexOf(b);
  }
  if (groupBy === "type") {
    return TYPE_ORDER.indexOf(a) - TYPE_ORDER.indexOf(b);
  }
  if (groupBy === "number") {
    return RANK_ORDER.indexOf(a) - RANK_ORDER.indexOf(b);
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
  // Q99 #1 — independent per-view scales (50–250%), persisted to
  // user_preferences. Slider controls the active mode's scale.
  const { user } = useAuth();
  const [gridScale, setGridScale] = useState<number>(100);
  const [barScale, setBarScale] = useState<number>(100);
  const [deckScale, setDeckScale] = useState<number>(100);
  const loadedRef = useRef(false);
  const [sliderOpen, setSliderOpen] = useState(false);
  const sliderRef = useRef<HTMLDivElement | null>(null);

  // Load persisted scales once on mount.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("user_preferences")
        .select("card_scale_grid, card_scale_bar, card_scale_deck")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      const row = (data ?? {}) as {
        card_scale_grid?: number;
        card_scale_bar?: number;
        card_scale_deck?: number;
      };
      if (typeof row.card_scale_grid === "number") setGridScale(row.card_scale_grid);
      if (typeof row.card_scale_bar === "number") setBarScale(row.card_scale_bar);
      if (typeof row.card_scale_deck === "number") setDeckScale(row.card_scale_deck);
      loadedRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Debounced save on change.
  useEffect(() => {
    if (!user || !loadedRef.current) return;
    const t = setTimeout(() => {
      void updateUserPreferences(user.id, {
        card_scale_grid: gridScale,
        card_scale_bar: barScale,
        card_scale_deck: deckScale,
      } as never);
    }, 500);
    return () => clearTimeout(t);
  }, [user, gridScale, barScale, deckScale]);

  const activeScale = mode === "grid" ? gridScale : mode === "bar" ? barScale : deckScale;
  const setActiveScale = (n: number) => {
    if (mode === "grid") setGridScale(n);
    else if (mode === "bar") setBarScale(n);
    else setDeckScale(n);
  };

  useEffect(() => {
    if (!sliderOpen) return;
    function onDown(e: PointerEvent) {
      if (!sliderRef.current) return;
      if (!sliderRef.current.contains(e.target as Node)) setSliderOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [sliderOpen]);

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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSliderOpen((v) => !v)}
            aria-label="Adjust card size"
            style={{
              background: "none",
              border: "none",
              padding: 4,
              cursor: "pointer",
              color: sliderOpen ? "var(--accent, var(--gold))" : "var(--color-foreground)",
              opacity: sliderOpen ? 1 : 0.6,
              transition: "opacity 200ms ease-out",
            }}
          >
            <Scaling size={15} strokeWidth={1.5} />
          </button>
          <ModeToggle mode={mode} onChange={setMode} />
        </div>
      </div>
      {sliderOpen && (
        <div
          ref={sliderRef}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "6px 10px",
            borderRadius: 8,
            background: "var(--surface-card)",
            border: "1px solid color-mix(in oklch, var(--gold) 18%, transparent)",
            marginLeft: "auto",
            marginRight: 16,
            maxWidth: "calc(100% - 16px)",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-caption)",
              color: "var(--color-foreground)",
              opacity: 0.7,
              whiteSpace: "nowrap",
            }}
          >
            Card size · {activeScale}%
          </span>
          <input
            type="range"
            min={50}
            max={250}
            step={5}
            value={activeScale}
            onChange={(e) => setActiveScale(Number(e.target.value))}
            style={{ width: "100%", accentColor: "var(--accent, var(--gold))" }}
          />
        </div>
      )}
      {loading && <SkeletonRow />}
      {!loading && data?.totalReadings === 0 && (
        <EmptyNote text="No cards yet in this time window." />
      )}
      {!loading && data && data.totalReadings > 0 && data.totalReadings < 5 && (
        <p
          style={{
            fontStyle: "italic",
            fontSize: "var(--text-caption, 0.75rem)",
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
                  {mode === "bar" && <BarView entries={entries} max={max} cardScale={barScale} />}
                  {mode === "grid" && <GridView entries={entries} cardScale={gridScale} />}
                  {mode === "deck" && <DeckGrid entries={entries} cardScale={deckScale} />}
                </div>
              ))}
            </div>
          ) : (
            <>
          {mode === "bar" && (
            <BarView
              entries={(showAll ? sorted : sorted.slice(0, 30)).filter((e) => e.count > 0 || showAll)}
              max={max}
              cardScale={barScale}
            />
          )}
          {mode === "grid" && <GridView entries={sorted} cardScale={gridScale} />}
          {mode === "deck" && <DeckGrid entries={sorted} cardScale={deckScale} />}
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
      {/* Q62 Fix 9 — count moved BEFORE the bar; gold + larger so it
          reads as the primary scanning anchor. */}
      <div
        style={{
          minWidth: 28,
          textAlign: "right",
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-body)",
          color: "var(--gold)",
          fontWeight: 500,
        }}
      >
        {count}
      </div>
      <div className="flex-1">
        <div style={{ fontStyle: "italic", fontSize: "var(--text-body-sm)" }}>{getCardName(cardId)}</div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ background: "color-mix(in oklch, var(--gold) 8%, transparent)" }}>
          <div style={{ width: `${w}%`, height: "100%", background: "var(--gold)", opacity: 0.7 }} />
        </div>
      </div>
      <ChevronRight className="h-4 w-4 opacity-50" />
    </button>
  );
}

function BarView({ entries, max }: { entries: Array<{ cardId: number; count: number }>; max: number; cardScale?: number }) {
  // BarView renders bars (no card images), so cardScale has no visual
  // effect. Prop is accepted to keep the call signature uniform.
  return (
    <div className="rounded-lg p-2" style={{ background: "var(--surface-card)" }}>
      {entries.map((e) => (
        <BarRow key={e.cardId} cardId={e.cardId} count={e.count} max={max} />
      ))}
    </div>
  );
}

function GridView({ entries, cardScale = 100 }: { entries: Array<{ cardId: number; count: number }>; cardScale?: number }) {
  const navigate = useNavigate();
  const visible = entries.filter((e) => e.count > 0);
  const wide = typeof window !== "undefined" && window.innerWidth >= 640;
  const minPx = wide
    ? Math.round(120 * cardScale / 100)
    : Math.round(60 * cardScale / 100);
  return (
    // Q98 #2 — card size slider drives minmax base directly so the
    // user can tighten/loosen the grid live.
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fill, minmax(${minPx}px, 1fr))`,
        gap: 8,
        alignItems: "end",
      }}
    >
      {visible.map((e, index) => (
        <CardCellWithBadge
          key={e.cardId}
          cardId={e.cardId}
          count={e.count}
          eager={index < 10}
          onClick={() =>
            navigate({ to: "/insights/card/$cardId", params: { cardId: String(e.cardId) } })
          }
        />
      ))}
    </div>
  );
}

/**
 * Q92 #2 — Deck mode now renders a single flat compact grid per group.
 * Grouping (none / suit / type / number) is controlled by the Group
 * filter dropdown via the parent's grouping logic; this component just
 * lays out whatever entries it receives. Sort order is preserved.
 */
function DeckGrid({ entries, cardScale = 100 }: { entries: Array<{ cardId: number; count: number }>; cardScale?: number }) {
  const minPx = Math.round(56 * cardScale / 100);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fill, minmax(${minPx}px, 1fr))`,
        gap: 4,
      }}
    >
      {entries.map((e, index) => (
        <DeckCell key={e.cardId} cardId={e.cardId} count={e.count} eager={index < 10} />
      ))}
    </div>
  );
}

function DeckCell({ cardId, count, eager }: { cardId: number; count: number; eager?: boolean }) {
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
        containerType: "inline-size",
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
          eager={eager}
          style={{ width: "100%", display: "block" }}
        />
      )}
      {count > 0 && <CardCountBadge count={count} />}
    </button>
  );
}