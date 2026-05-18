/**
 * Q95 #9 — "What the guide will see" — shared, controllable preview.
 *
 * Replaces the older read-only `WhatGuideWillSee` disclosures that
 * lived (duplicated) in ReadingScreen.tsx and ReadingParts.tsx. Also
 * mounts inside GuideSelector so the seeker can dial in context
 * before drawing.
 *
 * Controls:
 *   - History window dropdown: 7 / 30 / 90 / 365 days.
 *   - Memory-layer radio (cumulative, highest layer included):
 *       Tags only · + Card frequencies · + Threads · + Patterns.
 *   - Right-side tag-filter flyout drawer (subset of user_tags).
 *
 * The preview text is built locally from the in-memory selections,
 * so changes are instant. Reading + tag fetches reuse the same
 * RLS-protected supabase pattern as the Journal route — no new
 * server fn, no duplication of auth/filter logic. The token
 * estimator is char/4 (Anthropic's published rule-of-thumb).
 */
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Filter, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { FACETS, LENSES, getGuideById } from "@/lib/guides";
import { SPREAD_META, type SpreadMode } from "@/lib/spreads";
import { getCardName } from "@/lib/tarot";
import { getCurrentMoonPhase } from "@/lib/moon";

export type Pick = {
  id: number;
  cardIndex: number;
  isReversed?: boolean;
  deckId?: string | null;
};

export type GuideContextPreviewProps = {
  /** Optional — when omitted (e.g. inside GuideSelector before a draw)
   *  the spread/card/moon rows are skipped and the preview focuses on
   *  voice + memory layers only. */
  spread?: SpreadMode;
  picks?: Pick[];
  positionLabels?: string[];
  guideName?: string;
  guideId?: string | null;
  lensId?: string | null;
  facetIds?: readonly string[];
  question?: string;
};

type WindowDays = 7 | 30 | 90 | 365;
const WINDOWS: { value: WindowDays; label: string }[] = [
  { value: 7, label: "Last 7 days" },
  { value: 30, label: "Last 30 days" },
  { value: 90, label: "Last 90 days" },
  { value: 365, label: "Last 365 days" },
];

/** Cumulative memory layers — each row includes everything above it. */
type LayerId = "tags" | "cards" | "threads" | "patterns";
const LAYERS: { id: LayerId; label: string; desc: string }[] = [
  { id: "tags", label: "Tags only", desc: "Just the words you've attached." },
  { id: "cards", label: "+ Card frequencies", desc: "Which cards recur in the window." },
  { id: "threads", label: "+ Threads", desc: "Detected symbolic threads." },
  { id: "patterns", label: "+ Patterns", desc: "Long-arc story patterns." },
];

type TagRow = { id: string; name: string; usage_count: number };
type ReadingLite = {
  id: string;
  created_at: string;
  tags: string[] | null;
  card_ids: number[] | null;
  pattern_id: string | null;
};

export function GuideContextPreview(props: GuideContextPreviewProps) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [windowDays, setWindowDays] = useState<WindowDays>(30);
  const [layer, setLayer] = useState<LayerId>("threads");
  const [tagFilter, setTagFilter] = useState<Set<string>>(new Set());
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const [windowMenuOpen, setWindowMenuOpen] = useState(false);

  const [tags, setTags] = useState<TagRow[]>([]);
  const [readings, setReadings] = useState<ReadingLite[]>([]);
  const [loading, setLoading] = useState(false);

  // Tags load once per user (small list).
  useEffect(() => {
    if (!user || !open) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("user_tags")
        .select("id,name,usage_count")
        .eq("user_id", user.id)
        .order("usage_count", { ascending: false })
        .limit(100);
      if (!cancelled) setTags((data ?? []) as TagRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, open]);

  // Readings re-fetch when window or tag filter changes — same pattern
  // as the Journal route uses, scoped to the chosen window.
  useEffect(() => {
    if (!user || !open) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const since = new Date(
        Date.now() - windowDays * 24 * 60 * 60 * 1000,
      ).toISOString();
      let query = supabase
        .from("readings")
        .select("id,created_at,tags,card_ids,pattern_id")
        .eq("user_id", user.id)
        .is("archived_at", null)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(500);
      if (tagFilter.size > 0) {
        query = query.overlaps("tags", Array.from(tagFilter));
      }
      const { data } = await query;
      if (!cancelled) {
        setReadings((data ?? []) as ReadingLite[]);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, open, windowDays, tagFilter]);

  const guide = getGuideById(props.guideId);
  const guideDisplayName = props.guideName ?? guide.name;
  const lensName =
    LENSES.find((l) => l.id === props.lensId)?.name ?? "Deeper Threads";
  const facetNames = FACETS.filter((f) =>
    (props.facetIds ?? []).includes(f.id),
  ).map((f) => f.name);

  // Derived memory summary.
  const summary = useMemo(() => {
    const out: string[] = [];
    if (readings.length === 0) {
      return { lines: [], totalChars: 0 };
    }
    const layerIdx = LAYERS.findIndex((l) => l.id === layer);
    // Tags (always included).
    const tagCounts = new Map<string, number>();
    for (const r of readings)
      for (const t of r.tags ?? []) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    const topTags = [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12);
    if (topTags.length)
      out.push(
        `Recent tags: ${topTags.map(([t, n]) => `${t}×${n}`).join(", ")}.`,
      );
    // + Card frequencies
    if (layerIdx >= 1) {
      const cardCounts = new Map<number, number>();
      for (const r of readings)
        for (const c of r.card_ids ?? [])
          cardCounts.set(c, (cardCounts.get(c) ?? 0) + 1);
      const topCards = [...cardCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8);
      if (topCards.length)
        out.push(
          `Card frequencies: ${topCards
            .map(([c, n]) => `${getCardName(c)}×${n}`)
            .join(", ")}.`,
        );
    }
    // + Threads (count + briefest signal)
    if (layerIdx >= 2) {
      out.push(
        `Active symbolic threads detected across ${readings.length} readings.`,
      );
    }
    // + Patterns
    if (layerIdx >= 3) {
      const patternCount = new Set(
        readings.map((r) => r.pattern_id).filter(Boolean),
      ).size;
      out.push(
        patternCount > 0
          ? `${patternCount} long-arc patterns referenced.`
          : "No long-arc patterns active in this window.",
      );
    }
    const totalChars = out.reduce((s, l) => s + l.length, 0);
    return { lines: out, totalChars };
  }, [readings, layer]);

  // Preamble — voice + lens + facets + (optional) cards/spread/moon.
  const preambleLines = useMemo(() => {
    const out: string[] = [];
    out.push(`Voice: ${guideDisplayName} · Lens: ${lensName}`);
    if (facetNames.length) out.push(`Facets: ${facetNames.join(", ")}`);
    if (props.question?.trim()) out.push(`Question: "${props.question.trim()}"`);
    if (props.spread && props.picks && props.picks.length) {
      const meta = SPREAD_META[props.spread];
      out.push(`Spread: ${meta.label}`);
      const cardLines = props.picks
        .map((p, i) => {
          const pos = props.positionLabels?.[i] ?? `Card ${i + 1}`;
          return `${pos}: ${getCardName(p.cardIndex)}${p.isReversed ? " (reversed)" : ""}`;
        })
        .join("; ");
      out.push(`Cards: ${cardLines}`);
      out.push(`Moon: ${getCurrentMoonPhase().phase}`);
    }
    return out;
  }, [
    guideDisplayName,
    lensName,
    facetNames,
    props.question,
    props.spread,
    props.picks,
    props.positionLabels,
  ]);

  const totalChars =
    preambleLines.reduce((s, l) => s + l.length, 0) + summary.totalChars;
  const tokenEstimate = Math.max(1, Math.round(totalChars / 4));

  return (
    <div className="w-full max-w-md">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mx-auto flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-gold transition-colors hover:bg-gold/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
        style={{ opacity: "var(--ro-plus-10)" }}
      >
        <ChevronRight
          className="h-3 w-3 transition-transform"
          strokeWidth={1.5}
          style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
        />
        <span>What the guide will see</span>
      </button>
      {open && (
        <div
          className="mx-auto mt-2 rounded-lg border border-gold/30 bg-gold/[0.04] px-3 py-3"
          style={{ position: "relative" }}
        >
          {/* Controls row */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {/* Window dropdown */}
            <div style={{ position: "relative" }}>
              <button
                type="button"
                onClick={() => setWindowMenuOpen((v) => !v)}
                className="inline-flex items-center gap-1 rounded-full border border-gold/30 px-2.5 py-1 text-[11px] text-gold hover:bg-gold/10"
              >
                {WINDOWS.find((w) => w.value === windowDays)?.label}
                <ChevronDown className="h-3 w-3" strokeWidth={1.5} />
              </button>
              {windowMenuOpen && (
                <div
                  role="listbox"
                  className="absolute left-0 top-full z-50 mt-1 w-[160px] rounded-lg border border-gold/30 bg-cosmos p-1 shadow-2xl"
                >
                  {WINDOWS.map((w) => (
                    <button
                      key={w.value}
                      type="button"
                      onClick={() => {
                        setWindowDays(w.value);
                        setWindowMenuOpen(false);
                      }}
                      className={
                        "block w-full rounded px-2 py-1.5 text-left text-[11px] " +
                        (windowDays === w.value
                          ? "bg-gold/15 text-gold"
                          : "text-foreground/80 hover:bg-gold/10")
                      }
                    >
                      {w.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Tag filter trigger */}
            <button
              type="button"
              onClick={() => setFlyoutOpen(true)}
              className="inline-flex items-center gap-1 rounded-full border border-gold/30 px-2.5 py-1 text-[11px] text-gold hover:bg-gold/10"
            >
              <Filter className="h-3 w-3" strokeWidth={1.5} />
              {tagFilter.size > 0 ? `${tagFilter.size} tag filter` : "Filter tags"}
            </button>
            <span className="ml-auto text-[10px] text-muted-foreground">
              ~{tokenEstimate} tokens
            </span>
          </div>

          {/* Layer radios */}
          <div className="mb-3 flex flex-col gap-1">
            {LAYERS.map((l) => (
              <label
                key={l.id}
                className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 text-[12px] hover:bg-gold/5"
              >
                <input
                  type="radio"
                  name="memory-layer"
                  checked={layer === l.id}
                  onChange={() => setLayer(l.id)}
                  className="mt-1 accent-[var(--gold)]"
                />
                <span className="flex-1">
                  <span
                    className="block text-foreground/90"
                    style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}
                  >
                    {l.label}
                  </span>
                  <span className="block text-[10px] text-muted-foreground">
                    {l.desc}
                  </span>
                </span>
              </label>
            ))}
          </div>

          {/* Live preview */}
          <div
            className="rounded border border-gold/20 bg-cosmos/40 p-2"
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-body-sm)",
              lineHeight: 1.6,
              color: "color-mix(in oklab, var(--foreground) 80%, transparent)",
              whiteSpace: "pre-wrap",
            }}
          >
            {[...preambleLines, "", ...summary.lines].join("\n").trim() ||
              (loading ? "Loading context…" : "No memory in this window.")}
          </div>

          {/* Tag flyout drawer */}
          {flyoutOpen && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 60,
                background: "color-mix(in oklab, var(--cosmos) 60%, transparent)",
              }}
              onClick={() => setFlyoutOpen(false)}
            >
              <aside
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: "absolute",
                  top: 0,
                  right: 0,
                  bottom: 0,
                  width: "min(320px, 88vw)",
                  background: "var(--cosmos)",
                  borderLeft: "1px solid color-mix(in oklab, var(--gold) 30%, transparent)",
                  padding: 16,
                  overflowY: "auto",
                  boxShadow: "-8px 0 32px rgba(0,0,0,0.4)",
                }}
              >
                <div className="mb-3 flex items-center justify-between">
                  <h3
                    className="text-sm italic text-gold"
                    style={{ fontFamily: "var(--font-serif)" }}
                  >
                    Filter by tag
                  </h3>
                  <button
                    type="button"
                    onClick={() => setFlyoutOpen(false)}
                    className="rounded-full p-1 text-gold/70 hover:bg-gold/10 hover:text-gold"
                  >
                    <X className="h-4 w-4" strokeWidth={1.5} />
                  </button>
                </div>
                {tagFilter.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setTagFilter(new Set())}
                    className="mb-2 text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                  >
                    Clear all
                  </button>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {tags.length === 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      No tags yet.
                    </p>
                  )}
                  {tags.map((t) => {
                    const active = tagFilter.has(t.name);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() =>
                          setTagFilter((prev) => {
                            const next = new Set(prev);
                            if (next.has(t.name)) next.delete(t.name);
                            else next.add(t.name);
                            return next;
                          })
                        }
                        className={
                          "rounded-full border px-2.5 py-1 text-[11px] transition " +
                          (active
                            ? "border-gold bg-gold/15 text-gold"
                            : "border-border/40 text-foreground/70 hover:border-gold/40")
                        }
                      >
                        {t.name}
                        <span className="ml-1 text-[9px] text-muted-foreground">
                          {t.usage_count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </aside>
            </div>
          )}
        </div>
      )}
    </div>
  );
}