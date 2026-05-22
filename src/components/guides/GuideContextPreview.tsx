/**
 * Q97 #2 — "What the guide will see" — past-readings filter preview.
 *
 * Controls which past readings are bundled with the current draw when
 * sent to the AI:
 *   - Row 1: History bar — days window + tag flyout trigger.
 *   - Row 2: Current question radio (only if a question is set).
 *   - Row 3: Include past readings radio.
 *   - Row 4: Include past questions radio (depends on Row 3).
 *   - Tag flyout drawer (AND filter on selected tags).
 *   - Live preview + token estimate.
 *
 * No new server fn — reuses the same RLS-protected supabase pattern
 * as the Journal route. Token estimate is char/4 (Anthropic's
 * rule-of-thumb), then rounded to nearest 10 for stability.
 */
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, SlidersHorizontal, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { SPREAD_META, type SpreadMode } from "@/lib/spreads";
import { getCardName } from "@/lib/tarot";
import { getCurrentMoonPhase } from "@/lib/moon";
import { formatDateLong } from "@/lib/dates";

export type Pick = {
  id: number;
  cardIndex: number;
  isReversed?: boolean;
  deckId?: string | null;
};

export type GuideContextPreviewProps = {
  spread?: SpreadMode;
  picks?: Pick[];
  positionLabels?: string[];
  guideName?: string;
  guideId?: string | null;
  lensId?: string | null;
  facetIds?: readonly string[];
  question?: string;
};

type WindowDays = 7 | 14 | 30 | 90 | 0; // 0 = All time
const WINDOWS: { value: WindowDays; label: string }[] = [
  { value: 7, label: "7 days" },
  { value: 14, label: "14 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 0, label: "All time" },
];

type TagRow = { id: string; name: string; usage_count: number };
type ReadingLite = {
  id: string;
  created_at: string;
  question: string | null;
  tags: string[] | null;
  card_ids: number[] | null;
  spread_type: string | null;
};

function fmtDate(iso: string): string {
  return formatDateLong(iso);
}

export function GuideContextPreview(props: GuideContextPreviewProps) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [windowDays, setWindowDays] = useState<WindowDays>(30);
  const [windowMenuOpen, setWindowMenuOpen] = useState(false);
  const [tagFilter, setTagFilter] = useState<Set<string>>(new Set());
  const [flyoutOpen, setFlyoutOpen] = useState(false);

  const [includeQuestion, setIncludeQuestion] = useState(true);
  const [includePastReadings, setIncludePastReadings] = useState(true);
  const [includePastQuestions, setIncludePastQuestions] = useState(false);

  const [tags, setTags] = useState<TagRow[]>([]);
  const [readings, setReadings] = useState<ReadingLite[]>([]);
  const [loading, setLoading] = useState(false);

  const hasQuestion = !!props.question?.trim();

  // Tags load once when panel opens.
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

  // Past readings re-fetch when window or tag filter changes.
  useEffect(() => {
    if (!user || !open) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      let query = supabase
        .from("readings")
        .select("id,created_at,question,tags,card_ids,spread_type")
        .eq("user_id", user.id)
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(200);
      if (windowDays > 0) {
        const since = new Date(
          Date.now() - windowDays * 24 * 60 * 60 * 1000,
        ).toISOString();
        query = query.gte("created_at", since);
      }
      if (tagFilter.size > 0) {
        // AND filter — reading must contain ALL selected tags.
        query = query.contains("tags", Array.from(tagFilter));
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

  // Build live preview text.
  const previewText = useMemo(() => {
    const lines: string[] = [];
    if (includeQuestion && hasQuestion) {
      lines.push(`Question: ${props.question!.trim()}`);
    }
    if (props.spread && props.picks && props.picks.length) {
      const meta = SPREAD_META[props.spread];
      const cardStr = props.picks
        .map((p, i) => {
          const pos = props.positionLabels?.[i] ?? `Card ${i + 1}`;
          return `${pos}: ${getCardName(p.cardIndex)}${p.isReversed ? " (reversed)" : ""}`;
        })
        .join(", ");
      lines.push(`Spread: ${meta.label} — Cards: ${cardStr}`);
      lines.push(`Moon: ${getCurrentMoonPhase().phase}`);
    }
    if (includePastReadings && readings.length > 0) {
      lines.push(`--- Past readings (${readings.length}) ---`);
      for (const r of readings) {
        const cards = (r.card_ids ?? [])
          .map((c) => getCardName(c))
          .join(", ");
        let line = `Date: ${fmtDate(r.created_at)} · Cards: ${cards}`;
        if (includePastQuestions && r.question?.trim()) {
          line += ` · Question: ${r.question.trim()}`;
        }
        lines.push(line);
      }
    }
    return lines.join("\n");
  }, [
    includeQuestion,
    includePastReadings,
    includePastQuestions,
    hasQuestion,
    props.question,
    props.spread,
    props.picks,
    props.positionLabels,
    readings,
  ]);

  const tokenEstimate = Math.round(previewText.length / 4 / 10) * 10;
  const matchedCount = readings.length;

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
          {/* Row 1 — History bar */}
          <div className="mb-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setFlyoutOpen(true)}
              aria-label="Filter past readings by tag"
              className="rounded p-1 hover:bg-gold/10"
              style={{ color: "var(--accent, var(--gold))" }}
            >
              <SlidersHorizontal size={14} strokeWidth={1.5} />
            </button>
            <span
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: "var(--text-caption)",
                color: "var(--color-foreground)",
              }}
            >
              History:
            </span>
            <div style={{ position: "relative" }}>
              <button
                type="button"
                onClick={() => setWindowMenuOpen((v) => !v)}
                className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-gold hover:bg-gold/10"
              >
                {WINDOWS.find((w) => w.value === windowDays)?.label}
                <ChevronDown className="h-3 w-3" strokeWidth={1.5} />
              </button>
              {windowMenuOpen && (
                <div
                  role="listbox"
                  className="absolute left-0 top-full z-50 mt-1 w-[140px] rounded-lg border border-gold/30 bg-cosmos p-1 shadow-2xl"
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
            {tagFilter.size > 0 && (
              <span className="ml-auto text-[10px] text-muted-foreground">
                {tagFilter.size} tag filter
              </span>
            )}
          </div>

          {/* Row 2 — Current question radio */}
          {hasQuestion && (
            <RadioRow
              checked={includeQuestion}
              onChange={() => setIncludeQuestion((v) => !v)}
            >
              <div
                style={{
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  WebkitMaskImage:
                    "linear-gradient(to right, black 75%, transparent 100%)",
                  maskImage:
                    "linear-gradient(to right, black 75%, transparent 100%)",
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: "var(--text-body-sm)",
                }}
              >
                {props.question!.trim()}
              </div>
            </RadioRow>
          )}

          {/* Row 3 — Past readings radio */}
          <RadioRow
            checked={includePastReadings}
            onChange={() => setIncludePastReadings((v) => !v)}
          >
            <div className="flex items-center justify-between gap-2">
              <span>Include past readings</span>
              <span className="text-[10px] text-muted-foreground">
                {loading
                  ? "loading…"
                  : `${matchedCount} spread${matchedCount === 1 ? "" : "s"} matched`}
              </span>
            </div>
          </RadioRow>

          {/* Row 4 — Past questions radio */}
          <RadioRow
            checked={includePastQuestions && includePastReadings}
            disabled={!includePastReadings}
            onChange={() => setIncludePastQuestions((v) => !v)}
          >
            <span>Include past questions</span>
          </RadioRow>

          {/* Live preview */}
          <div
            className="mt-2 rounded"
            style={{
              maxHeight: 200,
              overflowY: "auto",
              border: "1px solid var(--border-subtle, color-mix(in oklab, var(--gold) 20%, transparent))",
              background: "var(--surface-card, color-mix(in oklab, var(--cosmos) 80%, transparent))",
              padding: 8,
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-caption)",
              lineHeight: 1.55,
              color: "color-mix(in oklab, var(--foreground) 80%, transparent)",
              whiteSpace: "pre-wrap",
            }}
          >
            {previewText || (loading ? "Loading context…" : "Nothing selected.")}
          </div>

          {/* Token estimate */}
          <div
            style={{
              textAlign: "right",
              fontSize: "var(--text-caption)",
              opacity: 0.45,
              marginTop: 4,
            }}
          >
            ~{tokenEstimate} tokens
          </div>

          {/* Tag flyout drawer */}
          {flyoutOpen && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 60,
                background:
                  "color-mix(in oklab, var(--cosmos) 60%, transparent)",
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
                  borderLeft:
                    "1px solid color-mix(in oklab, var(--gold) 30%, transparent)",
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

function RadioRow({
  checked,
  disabled,
  onChange,
  children,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onChange}
      disabled={disabled}
      className="flex w-full items-center gap-2 rounded px-1 py-1.5 text-left text-[12px] hover:bg-gold/5 disabled:cursor-not-allowed"
      style={{
        opacity: disabled
          ? 0.4
          : checked
            ? 1
            : 0.55,
      }}
    >
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: 14,
          height: 14,
          borderRadius: "50%",
          border: `1.5px solid ${
            checked
              ? "var(--accent, var(--gold))"
              : "color-mix(in oklab, var(--foreground) 35%, transparent)"
          }`,
          background: checked
            ? "radial-gradient(circle, var(--accent, var(--gold)) 0 45%, transparent 50%)"
            : "transparent",
          flexShrink: 0,
        }}
      />
      <span className="flex-1 min-w-0">{children}</span>
    </button>
  );
}
