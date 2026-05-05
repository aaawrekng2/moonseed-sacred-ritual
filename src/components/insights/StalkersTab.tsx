/**
 * FM — Stalkers tab visual polish on FL skeleton.
 * - Top row: wider container, larger cards (FM-1)
 * - Single detail: bigger, uncropped (FM-2)
 * - Twin/Triplet detail: bigger, uncropped (FM-3)
 * - Filter drawer matches Journal exactly (FM-4)
 * - Page title "Stalkers" (FM-5)
 * - Type chips drop count badges (FM-6)
 */
import { useEffect, useMemo, useState } from "react";
import { SlidersHorizontal, Sparkles, X as XIcon } from "lucide-react";
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

// FM-6 — Type chip without count badge.
function TypeChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
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
      {label}
    </button>
  );
}

export function StalkersTab({ timeRange }: { timeRange: TimeRange }) {
  const [mode, setMode] = useState<Mode>("singles");
  const [cooccurrence, setCooccurrence] = useState<Cooccurrence>("reading");
  const [selectedKey, setSelectedKey] = useState<string | number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [activeDrawTypes, setActiveDrawTypes] = useState<string[]>([]);

  const twinCount = DEMO_TWINS.length;
  const tripletCount = DEMO_TRIPLETS.length;
  const reversedCount = DEMO_REVERSED.length;

  useEffect(() => {
    if (mode === "singles") setSelectedKey(DEMO_SINGLES[0]?.cardId ?? null);
    else if (mode === "twins") setSelectedKey(DEMO_TWINS[0]?.id ?? null);
    else if (mode === "triplets") setSelectedKey(DEMO_TRIPLETS[0]?.id ?? null);
    else if (mode === "reversed") setSelectedKey(DEMO_REVERSED[0]?.cardId ?? null);
  }, [mode]);

  const slots = useMemo(() => {
    const filled =
      mode === "singles" ? DEMO_SINGLES.length
      : mode === "twins" ? DEMO_TWINS.length
      : mode === "triplets" ? DEMO_TRIPLETS.length
      : DEMO_REVERSED.length;
    return Math.max(0, 5 - filled);
  }, [mode]);

  const toggleTag = (t: string) =>
    setActiveTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  const toggleDrawType = (d: string) =>
    setActiveDrawTypes((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  const clearFilters = () => {
    setActiveTags([]);
    setActiveDrawTypes([]);
  };
  const hasAnyFilter = activeTags.length > 0 || activeDrawTypes.length > 0;

  const selectedSingle = DEMO_SINGLES.find((s) => s.cardId === selectedKey);
  const selectedTwin = DEMO_TWINS.find((t) => t.id === selectedKey);
  const selectedTriplet = DEMO_TRIPLETS.find((t) => t.id === selectedKey);
  const selectedReversed = DEMO_REVERSED.find((r) => r.cardId === selectedKey);

  return (
    <div className="px-4 pb-12">
      {/* FM-5 — Header */}
      <header className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-lg font-serif italic">Stalkers</h2>
        <div className="flex items-center gap-2">
          {twinCount > 0 ? (
            <TypeChip label="Twins" active={mode === "twins"} onClick={() => setMode(mode === "twins" ? "singles" : "twins")} />
          ) : null}
          {tripletCount > 0 ? (
            <TypeChip label="Triplets" active={mode === "triplets"} onClick={() => setMode(mode === "triplets" ? "singles" : "triplets")} />
          ) : null}
          {reversedCount > 0 ? (
            <TypeChip label="Reversed" active={mode === "reversed"} onClick={() => setMode(mode === "reversed" ? "singles" : "reversed")} />
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

      <div className="text-xs text-muted-foreground mb-3">{TIME_RANGE_LABELS[timeRange]}</div>

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

      {/* FM-1 — Wider container so cards scale up nicely. */}
      <div className="mx-auto w-full max-w-3xl mb-8">
        <div className="grid grid-cols-5 gap-2 sm:gap-3 md:gap-4">
          {mode === "singles" &&
            DEMO_SINGLES.map((s) => (
              <div key={s.cardId} className="flex flex-col items-center gap-1">
                <button
                  type="button"
                  onClick={() => setSelectedKey(s.cardId)}
                  className={
                    "w-full rounded-md " +
                    (selectedKey === s.cardId ? "ring-2 ring-[var(--gold)]" : "")
                  }
                >
                  <CardImage cardId={s.cardId} size="custom" widthPx={9999} className="w-full" style={{ width: "100%", minHeight: 0 }} />
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
                    <CardImage cardId={t.cardA} size="custom" widthPx={9999} style={{ width: "100%", minHeight: 0 }} />
                  </div>
                  <div className="absolute inset-0 translate-x-1 translate-y-1">
                    <CardImage cardId={t.cardB} size="custom" widthPx={9999} style={{ width: "100%", minHeight: 0 }} />
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
            ))}

          {mode === "reversed" &&
            DEMO_REVERSED.map((r) => (
              <div key={r.cardId} className="flex flex-col items-center gap-1">
                <button
                  type="button"
                  onClick={() => setSelectedKey(r.cardId)}
                  className={
                    "w-full rounded-md " +
                    (selectedKey === r.cardId ? "ring-2 ring-[var(--gold)]" : "")
                  }
                >
                  <CardImage cardId={r.cardId} size="custom" widthPx={9999} reversed style={{ width: "100%", minHeight: 0 }} />
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
      </div>

      {/* FM-2 — Single detail: larger, uncropped */}
      {mode === "singles" && selectedSingle ? (
        <div className="flex flex-col md:flex-row items-start gap-6">
          <div className="w-full md:w-2/5 max-w-md mx-auto md:mx-0">
            <CardImage cardId={selectedSingle.cardId} size="custom" widthPx={9999} style={{ width: "100%", minHeight: 0 }} />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-serif italic mb-2">{selectedSingle.name}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{selectedSingle.prose}</p>
          </div>
        </div>
      ) : null}

      {/* FM-3 — Twin detail: bigger */}
      {mode === "twins" && selectedTwin ? (
        <div className="flex flex-col gap-4">
          <div className="flex justify-center gap-3 sm:gap-4 md:gap-6 mt-2">
            {[selectedTwin.cardA, selectedTwin.cardB].map((cid) => (
              <div key={cid} className="flex-1 max-w-xs">
                <CardImage cardId={cid} size="custom" widthPx={9999} style={{ width: "100%", minHeight: 0 }} />
              </div>
            ))}
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">{selectedTwin.prose}</p>
        </div>
      ) : null}

      {/* FM-3 — Triplet detail: bigger */}
      {mode === "triplets" && selectedTriplet ? (
        <div className="flex flex-col gap-4">
          <div className="flex justify-center gap-3 sm:gap-4 md:gap-6 mt-2">
            {selectedTriplet.cardIds.map((cid) => (
              <div key={cid} className="flex-1 max-w-xs">
                <CardImage cardId={cid} size="custom" widthPx={9999} style={{ width: "100%", minHeight: 0 }} />
              </div>
            ))}
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">{selectedTriplet.prose}</p>
        </div>
      ) : null}

      {/* Reversed detail (matches single FM-2 sizing) */}
      {mode === "reversed" && selectedReversed ? (
        <div className="flex flex-col md:flex-row items-start gap-6">
          <div className="w-full md:w-2/5 max-w-md mx-auto md:mx-0">
            <CardImage cardId={selectedReversed.cardId} size="custom" widthPx={9999} reversed style={{ width: "100%", minHeight: 0 }} />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-serif italic mb-2">{selectedReversed.name}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{selectedReversed.prose}</p>
          </div>
        </div>
      ) : null}

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

      {/* FM-4 — Filter drawer matching Journal exactly */}
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
          background: "oklch(0.08 0.03 280)",
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
              {DEMO_TAGS.map((t) => {
                const active = activeTags.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleTag(t)}
                    className="font-display text-[13px] italic transition-colors text-foreground"
                    style={{
                      opacity: active ? 1 : 0.85,
                      borderBottom: active
                        ? "1px solid color-mix(in oklab, var(--gold) 70%, transparent)"
                        : "1px solid transparent",
                      paddingBottom: 2,
                    }}
                  >
                    {t}
                    {active && <span className="ml-1 text-[10px]">×</span>}
                  </button>
                );
              })}
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
              {DRAW_TYPES.map((d) => {
                const active = activeDrawTypes.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDrawType(d)}
                    className="font-display text-[12px] italic transition-colors text-foreground"
                    style={{
                      opacity: active ? 1 : 0.85,
                      borderBottom: active
                        ? "1px solid color-mix(in oklab, var(--gold) 70%, transparent)"
                        : "1px solid transparent",
                      paddingBottom: 2,
                    }}
                  >
                    {d}
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
              style={{ color: "#d4a843", opacity: 1, fontWeight: 700 }}
            >
              CLEAR FILTERS
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}
