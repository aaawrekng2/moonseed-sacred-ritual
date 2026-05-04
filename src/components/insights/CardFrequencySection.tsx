import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { getCardFrequency } from "@/lib/insights.functions";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import { useActiveDeckImage } from "@/lib/active-deck";
import { getCardImagePath, getCardName } from "@/lib/tarot";
import type { InsightsFilters } from "@/lib/insights.types";
import { SectionHeader, EmptyNote, SkeletonRow } from "./StalkerCardsSection";

type Mode = "bar" | "grid" | "deck";

export function CardFrequencySection({ filters }: { filters: InsightsFilters }) {
  const fn = useServerFn(getCardFrequency);
  const [data, setData] = useState<{ cards: Array<{ cardId: number; count: number }>; totalDraws: number; totalReadings: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>("bar");
  const [showAll, setShowAll] = useState(false);

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
    () => (data?.cards ?? []).slice().sort((a, b) => b.count - a.count),
    [data],
  );
  const max = sorted[0]?.count ?? 0;

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
    </section>
  );
}

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const items: Array<{ id: Mode; label: string }> = [
    { id: "bar", label: "Bar" },
    { id: "grid", label: "Grid" },
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
  const resolveImage = useActiveDeckImage();
  const url = resolveImage(cardId, "thumbnail") ?? getCardImagePath(cardId);
  const w = max === 0 ? 0 : (count / max) * 100;
  const tappable = count >= 3;
  return (
    <button
      type="button"
      disabled={!tappable}
      onClick={() =>
        tappable &&
        navigate({ to: "/insights/card/$cardId", params: { cardId: String(cardId) } })
      }
      className="flex w-full items-center gap-2 py-1.5 text-left"
    >
      <img
        src={url}
        alt={getCardName(cardId)}
        style={{ width: 28, height: 50, objectFit: "cover", borderRadius: 4, opacity: count === 0 ? 0.4 : 1 }}
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

function GridCell({ cardId, count }: { cardId: number; count: number }) {
  const navigate = useNavigate();
  const resolveImage = useActiveDeckImage();
  const url = resolveImage(cardId, "display") ?? getCardImagePath(cardId);
  return (
    <button
      type="button"
      onClick={() =>
        count >= 3 &&
        navigate({ to: "/insights/card/$cardId", params: { cardId: String(cardId) } })
      }
      className="relative"
      style={{ aspectRatio: "1 / 1.6", overflow: "hidden", borderRadius: 6, opacity: count === 0 ? 0.3 : 1 }}
    >
      <img src={url} alt={getCardName(cardId)} className="h-full w-full object-cover" />
      {count > 0 && (
        <span
          className="absolute right-1 top-1 inline-flex items-center justify-center rounded-full px-1.5 text-[10px]"
          style={{ background: "var(--gold)", color: "var(--cosmos, #0a0a14)", fontStyle: "italic", minWidth: 18 }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function GridView({ entries }: { entries: Array<{ cardId: number; count: number }> }) {
  return (
    <div className="grid grid-cols-3 gap-2 md:grid-cols-4 lg:grid-cols-5">
      {entries.map((e) => (
        <GridCell key={e.cardId} cardId={e.cardId} count={e.count} />
      ))}
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
    <div className="space-y-3">
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-widest opacity-60">Majors</div>
        <div className="grid grid-cols-11 gap-1">
          {majors.map((id) => (
            <GridCell key={id} cardId={id} count={lookup.get(id) ?? 0} />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {suits.map((s) => (
          <div key={s.name}>
            <div className="mb-1 text-[10px] uppercase tracking-widest opacity-60">{s.name}</div>
            <div className="grid grid-cols-2 gap-1">
              {Array.from({ length: 14 }, (_, i) => s.start + i).map((id) => (
                <GridCell key={id} cardId={id} count={lookup.get(id) ?? 0} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}