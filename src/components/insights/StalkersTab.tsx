/**
 * FL — Stalkers tab skeleton with hardcoded demo data.
 * Visually complete; no real cooccurrence math yet.
 */
import { useEffect, useMemo, useState } from "react";
import { SlidersHorizontal, Sparkles, X } from "lucide-react";
import { CardImage } from "@/components/card/CardImage";
import type { TimeRange } from "@/lib/insights.types";

type Mode = "singles" | "twins" | "triplets" | "reversed";
type Cooccurrence = "reading" | "day";

// FL-7 — Demo data.
const DEMO_SINGLES = [
  { cardId: 16, name: "The Tower", count: 12, prose: "The Tower has appeared 12 times in the last 30 days. A pattern of disruption — each time something solid you'd built has needed to come down. The card asks: what's still standing that shouldn't be?" },
  { cardId: 13, name: "Death", count: 8, prose: "Death keeps showing up because something is ending whether you'd choose it or not. Not literal. Recurring this often suggests you're holding onto something past its time." },
  { cardId: 0, name: "The Fool", count: 7, prose: "Beginnings won't leave you alone. The Fool keeps appearing because the path keeps offering you new starts." },
  { cardId: 1, name: "The Magician", count: 6, prose: "The Magician asks: are you using everything you have? Six appearances in 30 days suggests untapped capacity nearby." },
  { cardId: 17, name: "The Star", count: 5, prose: "Hope keeps surfacing. Even when the readings are heavy, the Star arrives. Trust this." },
];

const DEMO_TWINS = [
  { id: "twin-1", cardA: 16, cardB: 13, names: ["Tower", "Death"], count: 4, prose: "The Tower and Death have appeared together in 4 readings. This is a pair speaking the same message: structures ending, transformation forced rather than chosen." },
  { id: "twin-2", cardA: 17, cardB: 0, names: ["Star", "Fool"], count: 3, prose: "Hope (Star) and beginning (Fool) keep appearing together. Every time you've thought 'this is over,' they remind you it's the start of something else." },
  { id: "twin-3", cardA: 1, cardB: 17, names: ["Magician", "Star"], count: 2, prose: "Capacity (Magician) and hope (Star). What you can do, paired with the faith that doing matters. They appear together when you're underestimating yourself." },
];

const DEMO_TRIPLETS = [
  { id: "trip-1", cardIds: [16, 13, 0], names: ["Tower", "Death", "Fool"], count: 2, prose: "The full arc: collapse, ending, beginning. This triplet has appeared in 2 readings and represents the most common pattern of transformation — something falls, something dies, something starts." },
];

const DEMO_REVERSED = [
  { cardId: 16, name: "Tower (reversed)", count: 5, prose: "The Tower reversed keeps appearing. Avoidance of necessary collapse. The structure that needs to fall is being propped up." },
  { cardId: 19, name: "Sun (reversed)", count: 3, prose: "Joy delayed or blocked. The Sun reversed three times in 30 days suggests something holding back natural happiness." },
];

const DEMO_TAGS = ["work", "love", "family", "creativity", "shadow", "healing"];
const DRAW_TYPES = ["Single", "Three Card", "Celtic Cross", "Yes/No"];

const TIME_RANGE_LABELS: Record<TimeRange, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "365d": "Last 365 days",
  all: "All time",
};

function Chip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "text-xs rounded-full border px-2.5 py-1 transition-colors " +
        (active
          ? "border-[var(--gold)] bg-[color-mix(in_oklch,var(--gold)_10%,transparent)] text-[var(--gold)]"
          : "border-border/50 text-muted-foreground hover:border-[var(--gold)]/50")
      }
    >
      {label} · {count}
    </button>
  );
}

function chipClass(active: boolean): string {
  return (
    "text-xs rounded-full border px-2.5 py-1 transition-colors " +
    (active
      ? "border-[var(--gold)] bg-[color-mix(in_oklch,var(--gold)_10%,transparent)] text-[var(--gold)]"
      : "border-border/50 text-muted-foreground")
  );
}

export function StalkersTab({ timeRange }: { timeRange: TimeRange }) {
  const [mode, setMode] = useState<Mode>("singles");
  const [cooccurrence, setCooccurrence] = useState<Cooccurrence>("reading");
  const [selectedKey, setSelectedKey] = useState<string | number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [activeDrawTypes, setActiveDrawTypes] = useState<Set<string>>(new Set());

  const twinCount = DEMO_TWINS.length;
  const tripletCount = DEMO_TRIPLETS.length;
  const reversedCount = DEMO_REVERSED.length;

  // Default-select first item when mode changes.
  useEffect(() => {
    if (mode === "singles") setSelectedKey(DEMO_SINGLES[0]?.cardId ?? null);
    else if (mode === "twins") setSelectedKey(DEMO_TWINS[0]?.id ?? null);
    else if (mode === "triplets") setSelectedKey(DEMO_TRIPLETS[0]?.id ?? null);
    else if (mode === "reversed") setSelectedKey(DEMO_REVERSED[0]?.cardId ?? null);
  }, [mode]);

  const slots = useMemo(() => {
    const filled =
      mode === "singles"
        ? DEMO_SINGLES.length
        : mode === "twins"
        ? DEMO_TWINS.length
        : mode === "triplets"
        ? DEMO_TRIPLETS.length
        : DEMO_REVERSED.length;
    return Math.max(0, 5 - filled);
  }, [mode]);

  const toggleTag = (t: string) => {
    setActiveTags((s) => {
      const next = new Set(s);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };
  const toggleDrawType = (d: string) => {
    setActiveDrawTypes((s) => {
      const next = new Set(s);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  };
  const clearFilters = () => {
    setActiveTags(new Set());
    setActiveDrawTypes(new Set());
  };

  const selectedSingle = DEMO_SINGLES.find((s) => s.cardId === selectedKey);
  const selectedTwin = DEMO_TWINS.find((t) => t.id === selectedKey);
  const selectedTriplet = DEMO_TRIPLETS.find((t) => t.id === selectedKey);
  const selectedReversed = DEMO_REVERSED.find((r) => r.cardId === selectedKey);

  return (
    <div className="px-4 pb-12">
      {/* FL-2 — Header + chips */}
      <header className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-lg font-serif italic">Stalker Cards</h2>
        <div className="flex items-center gap-2">
          {twinCount > 0 ? (
            <Chip label="Twins" count={twinCount} active={mode === "twins"} onClick={() => setMode(mode === "twins" ? "singles" : "twins")} />
          ) : null}
          {tripletCount > 0 ? (
            <Chip label="Triplets" count={tripletCount} active={mode === "triplets"} onClick={() => setMode(mode === "triplets" ? "singles" : "triplets")} />
          ) : null}
          {reversedCount > 0 ? (
            <Chip label="Reversed" count={reversedCount} active={mode === "reversed"} onClick={() => setMode(mode === "reversed" ? "singles" : "reversed")} />
          ) : null}
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="More filters"
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground"
          >
            <SlidersHorizontal className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* FL-9 — Time range label */}
      <div className="text-xs text-muted-foreground mb-3">{TIME_RANGE_LABELS[timeRange]}</div>

      {/* FL-3 — Cooccurrence toggle */}
      {(mode === "twins" || mode === "triplets") ? (
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs text-muted-foreground">Co-occurring in:</span>
          <button
            onClick={() => setCooccurrence("reading")}
            className={
              "text-xs rounded-full px-2 py-0.5 " +
              (cooccurrence === "reading"
                ? "bg-[color-mix(in_oklch,var(--gold)_15%,transparent)] text-[var(--gold)]"
                : "text-muted-foreground")
            }
          >
            Same reading
          </button>
          <button
            onClick={() => setCooccurrence("day")}
            className={
              "text-xs rounded-full px-2 py-0.5 " +
              (cooccurrence === "day"
                ? "bg-[color-mix(in_oklch,var(--gold)_15%,transparent)] text-[var(--gold)]"
                : "text-muted-foreground")
            }
          >
            Same day
          </button>
        </div>
      ) : null}

      {/* FL-4 — 5-slot fixed-size top row */}
      <div className="grid grid-cols-5 gap-2 mb-6">
        {mode === "singles" &&
          DEMO_SINGLES.map((s) => (
            <div key={s.cardId} className="flex flex-col items-center gap-1">
              <button
                type="button"
                onClick={() => setSelectedKey(s.cardId)}
                className={
                  "aspect-[2/3] w-full overflow-hidden rounded-md " +
                  (selectedKey === s.cardId ? "ring-2 ring-[var(--gold)]" : "")
                }
              >
                <CardImage cardId={s.cardId} size="small" />
              </button>
              <span className="text-xs text-muted-foreground tabular-nums">{s.count}</span>
            </div>
          ))}

        {mode === "twins" &&
          DEMO_TWINS.map((t) => (
            <div key={t.id} className="flex flex-col items-center gap-1">
              <button
                type="button"
                onClick={() => setSelectedKey(t.id)}
                className={
                  "aspect-[2/3] w-full relative rounded-md " +
                  (selectedKey === t.id ? "ring-2 ring-[var(--gold)]" : "")
                }
              >
                <div className="absolute inset-0 -translate-x-1 -translate-y-1">
                  <CardImage cardId={t.cardA} size="small" />
                </div>
                <div className="absolute inset-0 translate-x-1 translate-y-1">
                  <CardImage cardId={t.cardB} size="small" />
                </div>
              </button>
              <span className="text-xs text-muted-foreground tabular-nums">{t.count}</span>
            </div>
          ))}

        {mode === "triplets" &&
          DEMO_TRIPLETS.map((t) => (
            <div key={t.id} className="flex flex-col items-center gap-1">
              <button
                type="button"
                onClick={() => setSelectedKey(t.id)}
                className={
                  "aspect-[2/3] w-full relative rounded-md " +
                  (selectedKey === t.id ? "ring-2 ring-[var(--gold)]" : "")
                }
              >
                <div className="absolute inset-0 -translate-x-1.5 -translate-y-1.5">
                  <CardImage cardId={t.cardIds[0]} size="small" />
                </div>
                <div className="absolute inset-0">
                  <CardImage cardId={t.cardIds[1]} size="small" />
                </div>
                <div className="absolute inset-0 translate-x-1.5 translate-y-1.5">
                  <CardImage cardId={t.cardIds[2]} size="small" />
                </div>
              </button>
              <span className="text-xs text-muted-foreground tabular-nums">{t.count}</span>
            </div>
          ))}

        {mode === "reversed" &&
          DEMO_REVERSED.map((r) => (
            <div key={r.cardId} className="flex flex-col items-center gap-1">
              <button
                type="button"
                onClick={() => setSelectedKey(r.cardId)}
                className={
                  "aspect-[2/3] w-full overflow-hidden rounded-md " +
                  (selectedKey === r.cardId ? "ring-2 ring-[var(--gold)]" : "")
                }
              >
                <CardImage cardId={r.cardId} size="small" reversed />
              </button>
              <span className="text-xs text-muted-foreground tabular-nums">{r.count}</span>
            </div>
          ))}

        {Array.from({ length: slots }).map((_, i) => (
          <div key={`empty-${i}`} className="flex flex-col items-center gap-1">
            <div className="aspect-[2/3] w-full rounded-md border border-dashed border-border/40 opacity-30" />
            <span className="text-xs text-muted-foreground tabular-nums opacity-30">—</span>
          </div>
        ))}
      </div>

      {/* FL-5 — Detail panel */}
      {mode === "singles" && selectedSingle ? (
        <div className="flex flex-col md:flex-row gap-4">
          <div className="w-full md:w-1/3 max-w-[12rem] mx-auto md:mx-0">
            <div className="aspect-[2/3] w-full rounded-lg overflow-hidden">
              <CardImage cardId={selectedSingle.cardId} size="medium" />
            </div>
          </div>
          <div className="flex-1">
            <h3 className="text-base font-serif italic mb-2">{selectedSingle.name}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{selectedSingle.prose}</p>
          </div>
        </div>
      ) : null}

      {mode === "twins" && selectedTwin ? (
        <div className="flex flex-col gap-4">
          <div className="flex justify-center gap-3">
            {[selectedTwin.cardA, selectedTwin.cardB].map((cid) => (
              <div key={cid} className="w-24 aspect-[2/3] rounded-lg overflow-hidden">
                <CardImage cardId={cid} size="small" />
              </div>
            ))}
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">{selectedTwin.prose}</p>
        </div>
      ) : null}

      {mode === "triplets" && selectedTriplet ? (
        <div className="flex flex-col gap-4">
          <div className="flex justify-center gap-3">
            {selectedTriplet.cardIds.map((cid) => (
              <div key={cid} className="w-24 aspect-[2/3] rounded-lg overflow-hidden">
                <CardImage cardId={cid} size="small" />
              </div>
            ))}
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">{selectedTriplet.prose}</p>
        </div>
      ) : null}

      {mode === "reversed" && selectedReversed ? (
        <div className="flex flex-col md:flex-row gap-4">
          <div className="w-full md:w-1/3 max-w-[12rem] mx-auto md:mx-0">
            <div className="aspect-[2/3] w-full rounded-lg overflow-hidden">
              <CardImage cardId={selectedReversed.cardId} size="medium" reversed />
            </div>
          </div>
          <div className="flex-1">
            <h3 className="text-base font-serif italic mb-2">{selectedReversed.name}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{selectedReversed.prose}</p>
          </div>
        </div>
      ) : null}

      {/* FL-8 — Empty state (defensive; demo always has data) */}
      {((mode === "singles" && DEMO_SINGLES.length === 0) ||
        (mode === "twins" && DEMO_TWINS.length === 0) ||
        (mode === "triplets" && DEMO_TRIPLETS.length === 0) ||
        (mode === "reversed" && DEMO_REVERSED.length === 0)) && (
        <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
          <Sparkles className="h-8 w-8 mb-2 opacity-40" />
          <p className="text-sm font-serif italic">No {mode} stalkers in this time range yet.</p>
          <p className="text-xs mt-1 opacity-70">Try a wider time range or keep drawing.</p>
        </div>
      )}

      {/* FL-6 — Filter drawer */}
      {drawerOpen ? (
        <>
          <button
            type="button"
            aria-label="Close filters"
            onClick={() => setDrawerOpen(false)}
            className="fixed inset-0 z-40 bg-black/40"
          />
          <aside className="fixed right-0 top-0 z-50 flex h-dvh w-80 max-w-[85vw] flex-col overflow-y-auto border-l border-border bg-background shadow-2xl">
            <header className="flex items-center justify-between p-4 border-b border-border/40">
              <h3 className="font-serif italic text-base">Filters</h3>
              <button onClick={() => setDrawerOpen(false)} aria-label="Close" className="p-1 text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="flex-1 p-4 space-y-6">
              <section>
                <h4 className="text-sm font-medium mb-2">Tags</h4>
                <div className="flex flex-wrap gap-2">
                  {DEMO_TAGS.map((t) => (
                    <button key={t} type="button" onClick={() => toggleTag(t)} className={chipClass(activeTags.has(t))}>
                      {t}
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <h4 className="text-sm font-medium mb-2">Draw Type</h4>
                <div className="flex flex-wrap gap-2">
                  {DRAW_TYPES.map((dt) => (
                    <button key={dt} type="button" onClick={() => toggleDrawType(dt)} className={chipClass(activeDrawTypes.has(dt))}>
                      {dt}
                    </button>
                  ))}
                </div>
              </section>
            </div>

            <footer className="p-4 border-t border-border/40 flex gap-2">
              <button
                type="button"
                onClick={clearFilters}
                className="flex-1 text-sm rounded-md border border-border/50 py-2"
              >
                Clear filters
              </button>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="flex-1 text-sm rounded-md bg-[color-mix(in_oklch,var(--gold)_15%,transparent)] text-[var(--gold)] py-2"
              >
                Apply
              </button>
            </footer>
          </aside>
        </>
      ) : null}
    </div>
  );
}