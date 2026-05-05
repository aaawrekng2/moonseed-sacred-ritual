import { useState } from "react";
import { ChevronDown, X } from "lucide-react";
import type { InsightsFilters, TimeRange } from "@/lib/insights.types";

// FK-4 — unify all bounded time ranges as "Last X days".
const TIME_LABELS: Record<TimeRange, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "365d": "Last 365 days",
  all: "All time",
};

/**
 * EJ-3 — Sticky filter bar. Collapsed summary + Edit drawer + chip row.
 * Hidden when activeTab === "recap".
 */
export function InsightsFilterBar({
  filters,
  onChange,
  hidden,
}: {
  filters: InsightsFilters;
  onChange: (next: InsightsFilters) => void;
  hidden?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (hidden) return null;

  const activeChips: Array<{ key: string; label: string; clear: () => void }> = [];
  if (filters.reversedOnly) {
    activeChips.push({ key: "rev", label: "Reversed only", clear: () => onChange({ ...filters, reversedOnly: false }) });
  }
  if (filters.deepOnly) {
    activeChips.push({ key: "deep", label: "Deep readings only", clear: () => onChange({ ...filters, deepOnly: false }) });
  }
  filters.spreadTypes.forEach((s) =>
    activeChips.push({
      key: `spread-${s}`,
      label: s,
      clear: () => onChange({ ...filters, spreadTypes: filters.spreadTypes.filter((x) => x !== s) }),
    }),
  );
  filters.moonPhases.forEach((p) =>
    activeChips.push({
      key: `moon-${p}`,
      label: p,
      clear: () => onChange({ ...filters, moonPhases: filters.moonPhases.filter((x) => x !== p) }),
    }),
  );

  const summary = [
    TIME_LABELS[filters.timeRange],
    filters.moonPhases.length === 0 ? "All phases" : `${filters.moonPhases.length} phase${filters.moonPhases.length === 1 ? "" : "s"}`,
    filters.spreadTypes.length === 0 ? "All spreads" : `${filters.spreadTypes.length} spread${filters.spreadTypes.length === 1 ? "" : "s"}`,
  ];
  const extra = activeChips.length;
  if (extra) summary.push(`+${extra} filter${extra === 1 ? "" : "s"}`);

  return (
    <div
      className="sticky top-0 z-30 backdrop-blur-md"
      style={{
        background: "color-mix(in oklch, var(--surface-elevated) 88%, transparent)",
        borderBottom: "1px solid var(--border-subtle)",
      }}
    >
      {/* FO-1 — Edit dropdown moves to the far left. Summary follows after. */}
      <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1 px-2 py-1 text-sm flex-shrink-0"
          style={{ color: "var(--gold)", fontStyle: "italic" }}
        >
          {open ? "Done" : "Edit"}
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        <div
          className="truncate"
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body-sm)",
            color: "var(--color-foreground)",
            opacity: 0.85,
            minWidth: 0,
          }}
        >
          {summary.join(" · ")}
        </div>
      </div>
      {activeChips.length > 0 && (
        <div className="mx-auto flex max-w-2xl flex-wrap items-center gap-2 px-4 pb-2">
          {/* FT-1 (2A) — CLEAR FILTERS leads the row. */}
          <button
            type="button"
            onClick={() =>
              onChange({
                ...filters,
                moonPhases: [],
                spreadTypes: [],
                tagIds: [],
                deckIds: [],
                reversedOnly: false,
                deepOnly: false,
              })
            }
            className="uppercase"
            style={{
              fontFamily: "var(--font-display, var(--font-serif))",
              fontSize: "12px",
              letterSpacing: "0.15em",
              color: "var(--gold)",
              opacity: 1,
              fontWeight: 700,
            }}
          >
            CLEAR FILTERS
          </button>
          {activeChips.map((c) => (
            // FT-1 (2B) — kill the pill. Plain text + X.
            <button
              key={c.key}
              type="button"
              onClick={c.clear}
              className="inline-flex items-center gap-1 text-xs transition-opacity hover:opacity-100"
              style={{
                color: "var(--color-foreground)",
                opacity: 0.85,
              }}
            >
              {c.label}
              <X className="h-3 w-3 opacity-60" />
            </button>
          ))}
        </div>
      )}
      {open && (
        <div className="mx-auto max-w-2xl space-y-3 px-4 pb-4">
          <div>
            <div
              className="mb-1 uppercase"
              style={{
                fontSize: "var(--text-caption, 0.7rem)",
                letterSpacing: "0.18em",
                opacity: 0.6,
              }}
            >
              Time range
            </div>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(TIME_LABELS) as TimeRange[]).map((tr) => {
                const active = filters.timeRange === tr;
                return (
                  <button
                    key={tr}
                    type="button"
                    onClick={() => onChange({ ...filters, timeRange: tr })}
                    className="rounded-full px-3 py-1 text-xs"
                    style={{
                      background: active
                        ? "color-mix(in oklch, var(--gold) 28%, transparent)"
                        : "var(--surface-card)",
                      color: active ? "var(--gold)" : "var(--color-foreground)",
                      fontStyle: "italic",
                    }}
                  >
                    {TIME_LABELS[tr]}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm" style={{ fontStyle: "italic" }}>
              <input
                type="checkbox"
                checked={filters.reversedOnly}
                onChange={(e) => onChange({ ...filters, reversedOnly: e.target.checked })}
              />
              Reversed only
            </label>
            <label className="flex items-center gap-2 text-sm" style={{ fontStyle: "italic" }}>
              <input
                type="checkbox"
                checked={filters.deepOnly}
                onChange={(e) => onChange({ ...filters, deepOnly: e.target.checked })}
              />
              Deep readings only
            </label>
          </div>
        </div>
      )}
    </div>
  );
}