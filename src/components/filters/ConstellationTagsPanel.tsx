/**
 * EK36 — ConstellationTagsPanel.
 *
 * Replaces the simple TagsSection inside GlobalFilterBar for the
 * constellation/manual entry surface. Renders the same set of tags
 * (toggleable for filtering) but adds:
 *
 *   - Two view toggles at the top of the section:
 *       sort: alphabetical | by count
 *       scope: any | all (cards in slots)
 *   - "Showing tags from N readings" status line under the toggles
 *   - Font-weight gradient on tag names (bolder = more usage in scope)
 *   - Recent-activity dot for tags used in the last 7 days
 *   - Hover preview popover containing: full count, last used, top 3
 *     co-occurring cards, trend arrow (up/down/flat vs prior period)
 *
 * Per-tag counts are NEVER inline — they live in the hover so the
 * tag list stays scannable and editorial. The weight gradient is the
 * inline signal; the hover is the precise lookup.
 *
 * Toggle state persists in localStorage under tarotseed:tag-sort and
 * tarotseed:tag-scope so the seeker's preference is sticky per device.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getCardName } from "@/lib/tarot";

export type ConstellationTagStat = {
  name: string;
  count: number;
  lastUsedAt: string | null;
  recentlyActive: boolean;
  coOccurringCards: number[];
  trendDirection: "up" | "down" | "flat";
};

type SortMode = "count" | "alpha";
type ScopeMode = "any" | "all";

const SORT_KEY = "tarotseed:tag-sort";
const SCOPE_KEY = "tarotseed:tag-scope";

function readPref<T extends string>(key: string, def: T, valid: readonly T[]): T {
  if (typeof window === "undefined") return def;
  try {
    const v = window.localStorage.getItem(key);
    if (v && (valid as readonly string[]).includes(v)) return v as T;
  } catch {}
  return def;
}

function writePref(key: string, v: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, v);
  } catch {}
}

export function useTagSortPref(): [SortMode, (m: SortMode) => void] {
  const [mode, setModeState] = useState<SortMode>(() =>
    readPref<SortMode>(SORT_KEY, "count", ["count", "alpha"]),
  );
  return [
    mode,
    (m: SortMode) => {
      setModeState(m);
      writePref(SORT_KEY, m);
    },
  ];
}

export function useTagScopePref(): [ScopeMode, (m: ScopeMode) => void] {
  const [mode, setModeState] = useState<ScopeMode>(() =>
    readPref<ScopeMode>(SCOPE_KEY, "any", ["any", "all"]),
  );
  return [
    mode,
    (m: ScopeMode) => {
      setModeState(m);
      writePref(SCOPE_KEY, m);
    },
  ];
}

// Format the lastUsedAt timestamp as a human-readable relative date.
function formatLastUsed(iso: string | null): string {
  if (!iso) return "—";
  const now = Date.now();
  const then = new Date(iso).getTime();
  const days = Math.floor((now - then) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "1 week ago";
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 60) return "1 month ago";
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

/**
 * Compute a font weight (CSS keyword string) based on usage count
 * relative to the max count in the visible set. Provides the "soft tag
 * cloud" visual signal without resorting to font-size changes (which
 * would make the list jagged). Range: 400 (regular) → 600 (semibold).
 */
function weightForCount(count: number, maxCount: number): number {
  if (maxCount <= 0) return 400;
  const ratio = count / maxCount;
  // Quantize to three steps for cleaner typography: 400 / 500 / 600.
  if (ratio >= 0.66) return 600;
  if (ratio >= 0.33) return 500;
  return 400;
}

export function ConstellationTagsPanel({
  tagStats,
  selectedTagNames,
  tagMode,
  onToggleTag,
  onTagModeChange,
  scopeMode,
  onScopeModeChange,
  sortMode,
  onSortModeChange,
  readingsInScope,
  hasSlotCards,
}: {
  tagStats: ConstellationTagStat[];
  selectedTagNames: string[];
  tagMode: "any" | "all";
  onToggleTag: (name: string) => void;
  onTagModeChange: (mode: "any" | "all") => void;
  scopeMode: ScopeMode;
  onScopeModeChange: (mode: ScopeMode) => void;
  sortMode: SortMode;
  onSortModeChange: (mode: SortMode) => void;
  readingsInScope: number;
  hasSlotCards: boolean;
}) {
  // EK36 — Hovered tag drives the preview popover. The trigger is the
  // tag pill itself; cursor enter opens, cursor leave closes (with a
  // short delay so the seeker can scan multiple tags rapidly).
  const [hoverTag, setHoverTag] = useState<string | null>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const dismissTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (dismissTimerRef.current !== null)
        window.clearTimeout(dismissTimerRef.current);
    };
  }, []);

  const handleEnter = (name: string, rect: DOMRect) => {
    if (dismissTimerRef.current !== null) {
      window.clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    setHoverTag(name);
    setAnchorRect(rect);
  };

  const handleLeave = () => {
    if (dismissTimerRef.current !== null)
      window.clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = window.setTimeout(() => {
      setHoverTag(null);
      setAnchorRect(null);
    }, 100);
  };

  // EK36 — Apply the chosen sort mode. Default from the server is
  // count-desc; if the seeker picks alpha, re-sort. Otherwise leave the
  // server order intact.
  const sortedTags = useMemo(() => {
    if (sortMode === "alpha") {
      return [...tagStats].sort((a, b) => a.name.localeCompare(b.name));
    }
    return tagStats;
  }, [tagStats, sortMode]);

  // Max count in the visible set — drives the font-weight gradient.
  const maxCount = useMemo(
    () => tagStats.reduce((max, t) => (t.count > max ? t.count : max), 0),
    [tagStats],
  );

  // EK36 — Resolve the hovered tag's stat for the preview popover.
  const hoveredStat = useMemo(
    () => (hoverTag ? tagStats.find((t) => t.name === hoverTag) : null),
    [hoverTag, tagStats],
  );

  if (sortedTags.length === 0) {
    return (
      <section>
        <SectionHeader>Tags</SectionHeader>
        <ToggleStrip
          sortMode={sortMode}
          onSortModeChange={onSortModeChange}
          scopeMode={scopeMode}
          onScopeModeChange={onScopeModeChange}
          hasSlotCards={hasSlotCards}
        />
        <div
          className="font-serif italic"
          style={{
            fontSize: "var(--text-body-sm, 0.85rem)",
            color: "var(--color-foreground-muted, var(--color-foreground))",
            opacity: 0.65,
            marginTop: 8,
          }}
        >
          No tags in this view.
        </div>
      </section>
    );
  }

  return (
    <section>
      <SectionHeader>Tags</SectionHeader>
      <ToggleStrip
        sortMode={sortMode}
        onSortModeChange={onSortModeChange}
        scopeMode={scopeMode}
        onScopeModeChange={onScopeModeChange}
        hasSlotCards={hasSlotCards}
      />
      {/* EK36 — Status line confirming what slice of journal data the
          tag list is drawn from. Same affordance Walmart faceted search
          uses ("Showing 1,234 results from N filters"): tells the
          seeker WHY the visible tags are what they are. */}
      <div
        className="font-display italic"
        style={{
          fontSize: "var(--text-caption, 0.75rem)",
          color: "var(--color-foreground)",
          opacity: 0.65,
          letterSpacing: "0.05em",
          marginBottom: 10,
        }}
      >
        Showing tags from {readingsInScope}{" "}
        {readingsInScope === 1 ? "reading" : "readings"}
      </div>
      {/* EK36 — Any/All tag-match mode (existing behavior: how to
          combine multiple selected tag chips). Only shown when 2+ tags
          selected. Distinct from the scope toggle above. */}
      {selectedTagNames.length >= 2 && (
        <div className="mb-3 flex items-center gap-3">
          <span
            className="font-display"
            style={{
              fontSize: "10px",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--color-foreground)",
              opacity: 0.85,
            }}
          >
            Match
          </span>
          {(["any", "all"] as const).map((m) => {
            const active = tagMode === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => onTagModeChange(m)}
                className="font-display italic"
                style={{
                  fontSize: 12,
                  background: "transparent",
                  border: "none",
                  borderBottom: active
                    ? "1px solid color-mix(in oklab, var(--gold) 70%, transparent)"
                    : "1px solid transparent",
                  paddingBottom: 2,
                  color: "var(--color-foreground)",
                  opacity: active ? 1 : 0.75,
                  cursor: "pointer",
                }}
              >
                {m === "any" ? "Any tag" : "All tags"}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-2">
        {sortedTags.map((t) => {
          const isActive = selectedTagNames.includes(t.name);
          const weight = weightForCount(t.count, maxCount);
          return (
            <button
              key={t.name}
              type="button"
              onClick={() => onToggleTag(t.name)}
              onMouseEnter={(e) =>
                handleEnter(t.name, e.currentTarget.getBoundingClientRect())
              }
              onMouseLeave={handleLeave}
              className="font-display italic"
              style={{
                background: isActive
                  ? "color-mix(in oklab, var(--gold) 18%, transparent)"
                  : "transparent",
                border: `1px solid ${
                  isActive
                    ? "color-mix(in oklab, var(--gold) 50%, transparent)"
                    : "var(--border-subtle)"
                }`,
                borderRadius: 999,
                padding: "4px 10px",
                fontSize: "var(--text-body-sm, 0.85rem)",
                fontWeight: weight,
                color: "var(--color-foreground)",
                cursor: "pointer",
                position: "relative",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {t.recentlyActive && (
                <span
                  aria-label="Recently active"
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: 999,
                    background: "var(--accent, var(--gold))",
                    flexShrink: 0,
                  }}
                />
              )}
              {t.name}
            </button>
          );
        })}
      </div>
      {hoveredStat && anchorRect && (
        <TagHoverPopover stat={hoveredStat} anchorRect={anchorRect} />
      )}
    </section>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="font-display italic"
      style={{
        fontSize: "var(--text-body-sm, 0.85rem)",
        color: "var(--color-foreground)",
        opacity: 0.85,
        letterSpacing: "0.05em",
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

function ToggleStrip({
  sortMode,
  onSortModeChange,
  scopeMode,
  onScopeModeChange,
  hasSlotCards,
}: {
  sortMode: SortMode;
  onSortModeChange: (m: SortMode) => void;
  scopeMode: ScopeMode;
  onScopeModeChange: (m: ScopeMode) => void;
  hasSlotCards: boolean;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-2"
      style={{ marginBottom: 8 }}
    >
      <ToggleGroup
        label="Sort"
        value={sortMode}
        onChange={(v) => onSortModeChange(v as SortMode)}
        options={[
          { value: "count", label: "Most used" },
          { value: "alpha", label: "A → Z" },
        ]}
      />
      {hasSlotCards && (
        <ToggleGroup
          label="Scope"
          value={scopeMode}
          onChange={(v) => onScopeModeChange(v as ScopeMode)}
          options={[
            { value: "any", label: "Any slot" },
            { value: "all", label: "All slots" },
          ]}
        />
      )}
    </div>
  );
}

function ToggleGroup({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="font-display"
        style={{
          fontSize: "10px",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--color-foreground)",
          opacity: 0.7,
        }}
      >
        {label}
      </span>
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className="font-display italic"
            style={{
              fontSize: 12,
              background: "transparent",
              border: "none",
              borderBottom: active
                ? "1px solid color-mix(in oklab, var(--gold) 70%, transparent)"
                : "1px solid transparent",
              paddingBottom: 2,
              color: "var(--color-foreground)",
              opacity: active ? 1 : 0.6,
              cursor: "pointer",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function TagHoverPopover({
  stat,
  anchorRect,
}: {
  stat: ConstellationTagStat;
  anchorRect: DOMRect;
}) {
  // EK36 — Anchored ABOVE the tag pill by default; if there's not
  // enough room (within 140px of the viewport top), flip below.
  const PANEL_MAX_W = 260;
  const GAP = 6;
  const centerX = anchorRect.left + anchorRect.width / 2;
  let left = centerX - PANEL_MAX_W / 2;
  if (left < 8) left = 8;
  if (left + PANEL_MAX_W > window.innerWidth - 8)
    left = window.innerWidth - 8 - PANEL_MAX_W;
  const above = anchorRect.top > 160;
  const top = above ? anchorRect.top - GAP : anchorRect.bottom + GAP;

  const cardNames = stat.coOccurringCards
    .slice(0, 3)
    .map((cid) => getCardName(cid) ?? `Card ${cid}`)
    .filter(Boolean);

  return createPortal(
    <div
      role="dialog"
      style={{
        position: "fixed",
        top,
        left,
        maxWidth: PANEL_MAX_W,
        zIndex: "var(--z-popover, 50)" as unknown as number,
        background: "var(--surface-card)",
        border: "1px solid var(--border-subtle)",
        borderRadius: 10,
        padding: "10px 12px",
        fontFamily: "var(--font-serif)",
        color: "var(--color-foreground)",
        boxShadow:
          "0 8px 24px color-mix(in oklch, var(--color-foreground) 14%, transparent)",
        transform: above ? "translateY(-100%)" : undefined,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          fontSize: "var(--text-body, 0.95rem)",
          fontStyle: "italic",
          marginBottom: 4,
        }}
      >
        {stat.name}
      </div>
      {/* Count line with trend arrow */}
      <div
        style={{
          fontSize: "var(--text-body-sm, 0.85rem)",
          opacity: 0.85,
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 2,
        }}
      >
        <span>
          {stat.count} {stat.count === 1 ? "reading" : "readings"}
        </span>
        {stat.trendDirection !== "flat" && (
          <span
            aria-label={stat.trendDirection === "up" ? "trending up" : "trending down"}
            style={{
              fontSize: 11,
              color:
                stat.trendDirection === "up"
                  ? "var(--accent, var(--gold))"
                  : "color-mix(in oklch, var(--color-foreground) 60%, transparent)",
            }}
          >
            {stat.trendDirection === "up" ? "↑" : "↓"}
          </span>
        )}
      </div>
      <div
        style={{
          fontSize: "var(--text-caption, 0.75rem)",
          opacity: 0.7,
          marginBottom: cardNames.length ? 6 : 0,
        }}
      >
        Last used: {formatLastUsed(stat.lastUsedAt)}
      </div>
      {cardNames.length > 0 && (
        <div
          style={{
            fontSize: "var(--text-caption, 0.75rem)",
            opacity: 0.7,
            lineHeight: 1.4,
          }}
        >
          <div
            style={{
              fontSize: "9px",
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              opacity: 0.6,
              marginBottom: 2,
            }}
          >
            Top cards
          </div>
          {cardNames.join(" · ")}
        </div>
      )}
    </div>,
    document.body,
  );
}
