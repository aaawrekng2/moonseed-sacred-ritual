/**
 * FU — Canonical filter pattern shared by Journal + Insights.
 *
 * Layout (left → right):
 *   [time-range dropdown?] [CLEAR FILTERS] [active chip · chip · ...] [⚙ filter icon]
 *
 * Tapping the filter icon opens a right-side flyout drawer (same chrome
 * as the historical Journal drawer) with sections rendered in the order
 * specified by the `sections` prop.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { SlidersHorizontal, X as XIcon } from "lucide-react";
import { Dropdown } from "@/components/filters/Dropdown";
import {
  DRAW_TYPE_LABEL,
  DRAW_TYPE_KEYS,
  MOON_PHASE_KEYS,
  MOON_PHASE_LABEL,
  clearAll,
  hasAnyActive,
  type FilterSectionKey,
  type GlobalFilters,
} from "@/lib/filters.types";

type TimeRangeProp = {
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (next: string) => void;
};

export type GlobalFilterBarProps = {
  filters: GlobalFilters;
  onChange: (next: GlobalFilters) => void;
  /** Drawer sections to render and their order. */
  sections: ReadonlyArray<FilterSectionKey>;
  /** Optional leading time-range dropdown. Insights uses; Journal omits. */
  timeRange?: TimeRangeProp;
  /** Reference data for the Tags section. */
  userTags?: ReadonlyArray<{ id: string; name: string; usage_count: number }>;
  /** Reference data for the Stories section (Journal only). */
  allStories?: ReadonlyArray<{ id: string; name: string }>;
  /**
   * Slot for surface-specific extras inside the chip area
   * (Journal uses this for the active-date chip).
   */
  trailingChips?: React.ReactNode;
  /** Optional dropdowns rendered to the right of the time range. */
  trailingDropdowns?: React.ReactNode;
};

const STORIES_DEFAULT_VISIBLE = 5;

export function GlobalFilterBar({
  filters,
  onChange,
  sections,
  timeRange,
  userTags = [],
  allStories = [],
  trailingChips,
  trailingDropdowns,
}: GlobalFilterBarProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const update = (patch: Partial<GlobalFilters>) =>
    onChange({ ...filters, ...patch });

  const removeTag = (name: string) =>
    update({ tags: filters.tags.filter((t) => t !== name) });
  const removeSpread = (s: string) =>
    update({ spreadTypes: filters.spreadTypes.filter((x) => x !== s) });
  const removeMoon = (p: string) =>
    update({ moonPhases: filters.moonPhases.filter((x) => x !== p) });
  const removeStory = (id: string) =>
    update({ storyIds: filters.storyIds.filter((x) => x !== id) });

  // Build active-chip list (in a stable, readable order).
  const chips: Array<{ key: string; label: string; clear: () => void }> = [];
  filters.tags.forEach((t) =>
    chips.push({ key: `tag-${t}`, label: t, clear: () => removeTag(t) }),
  );
  filters.spreadTypes.forEach((s) =>
    chips.push({
      key: `spread-${s}`,
      label: DRAW_TYPE_LABEL[s] ?? s,
      clear: () => removeSpread(s),
    }),
  );
  filters.moonPhases.forEach((p) =>
    chips.push({
      key: `moon-${p}`,
      label: MOON_PHASE_LABEL[p] ?? p,
      clear: () => removeMoon(p),
    }),
  );
  if (filters.deepOnly) {
    chips.push({
      key: "deep",
      label: "Deep readings only",
      clear: () => update({ deepOnly: false }),
    });
  }
  if (filters.reversedOnly) {
    chips.push({
      key: "rev",
      label: "Reversed only",
      clear: () => update({ reversedOnly: false }),
    });
  }
  if (filters.bookmarked) {
    chips.push({
      key: "bookmarked",
      label: "Bookmarked",
      clear: () => update({ bookmarked: false }),
    });
  }
  filters.storyIds.forEach((id) => {
    const s = allStories.find((x) => x.id === id);
    chips.push({
      key: `story-${id}`,
      label: s?.name ?? "Story",
      clear: () => removeStory(id),
    });
  });

  const showClear = hasAnyActive(filters);

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Filters"
          className="shrink-0 inline-flex items-center justify-center p-1 rounded-md transition-opacity"
          style={{ color: "var(--color-foreground)", opacity: 0.7 }}
        >
          <SlidersHorizontal className="h-4 w-4" />
        </button>

        {timeRange && <TimeRangeDropdown {...timeRange} />}

        {trailingDropdowns}

        {showClear && (
          <button
            type="button"
            onClick={() => onChange(clearAll(filters))}
            className="uppercase shrink-0"
            style={{
              fontFamily: "var(--font-display, var(--font-serif))",
              fontSize: "12px",
              fontWeight: 700,
              letterSpacing: "0.15em",
              color: "var(--gold)",
            }}
          >
            CLEAR FILTERS
          </button>
        )}

        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={c.clear}
            className="inline-flex items-center gap-1 text-xs"
            style={{ color: "var(--color-foreground)", opacity: 0.85 }}
          >
            {c.label}
            <XIcon className="h-3 w-3 opacity-60" />
          </button>
        ))}

        {trailingChips}
      </div>

      <FilterDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        filters={filters}
        onChange={onChange}
        sections={sections}
        userTags={userTags}
        allStories={allStories}
      />
    </>
  );
}

/* ---------- Time-range dropdown ---------- */

function TimeRangeDropdown({ value, options, onChange }: TimeRangeProp) {
  return <Dropdown value={value} options={options} onChange={onChange} />;
}

/* ---------- Right-side flyout drawer ---------- */

function FilterDrawer({
  open,
  onClose,
  filters,
  onChange,
  sections,
  userTags,
  allStories,
}: {
  open: boolean;
  onClose: () => void;
  filters: GlobalFilters;
  onChange: (next: GlobalFilters) => void;
  sections: ReadonlyArray<FilterSectionKey>;
  userTags: ReadonlyArray<{ id: string; name: string; usage_count: number }>;
  allStories: ReadonlyArray<{ id: string; name: string }>;
}) {
  // FU-2 — Portal to document.body so the drawer escapes any ancestor
  // stacking/containing context (e.g. `backdrop-filter`, `transform`)
  // which would otherwise trap a `position: fixed` child inside that
  // ancestor's box and z-index layer.
  if (typeof document === "undefined") return null;
  return createPortal(
    <>
      {open && (
        <button
          type="button"
          aria-label="Close filters"
          onClick={onClose}
          className="fixed top-0 h-dvh w-10 cursor-pointer bg-transparent"
          style={{ right: "var(--journal-drawer-w)", zIndex: 50 }}
        />
      )}
      <aside
        aria-hidden={!open}
        className="journal-filter-drawer fixed right-0 top-0 flex h-dvh flex-col overflow-y-auto border-l shadow-2xl transition-transform duration-300 ease-out"
        style={{
          width: "var(--journal-drawer-w)",
          borderColor: "color-mix(in oklab, var(--gold) 18%, transparent)",
          background: "var(--surface-overlay)",
          paddingTop: "calc(env(safe-area-inset-top,0px) + 72px)",
          paddingBottom: "calc(env(safe-area-inset-bottom,0px) + 96px)",
          paddingLeft: 20,
          paddingRight: 20,
          transform: open ? "translateX(0)" : "translateX(100%)",
          pointerEvents: open ? "auto" : "none",
          zIndex: "var(--z-drawer)",
        }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2
            className="font-display text-[11px] uppercase tracking-[0.22em] text-gold"
            style={{ opacity: "var(--ro-plus-30, 0.85)" }}
          >
            Filters
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1 text-muted-foreground hover:text-gold"
          >
            <XIcon size={16} strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex flex-col gap-5">
          {sections.map((key) => {
            switch (key) {
              case "tags":
                return (
                  <TagsSection
                    key={key}
                    filters={filters}
                    onChange={onChange}
                    userTags={userTags}
                  />
                );
              case "spreadTypes":
                return (
                  <SpreadTypesSection
                    key={key}
                    filters={filters}
                    onChange={onChange}
                  />
                );
              case "depth":
                return (
                  <DepthSection
                    key={key}
                    filters={filters}
                    onChange={onChange}
                  />
                );
              case "moonPhases":
                return (
                  <MoonPhasesSection
                    key={key}
                    filters={filters}
                    onChange={onChange}
                  />
                );
              case "reversed":
                return (
                  <ReversedSection
                    key={key}
                    filters={filters}
                    onChange={onChange}
                  />
                );
              case "stories":
                return (
                  <StoriesSection
                    key={key}
                    filters={filters}
                    onChange={onChange}
                    allStories={allStories}
                  />
                );
              default:
                return null;
            }
          })}
        </div>
      </aside>
    </>,
    document.body,
  );
}

/* ---------- Drawer sections ---------- */

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3
      className="font-display text-[14px] uppercase tracking-[0.18em] mb-2"
      style={{ color: "var(--accent)" }}
    >
      {children}
    </h3>
  );
}

function ToggleRow({
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
      className="font-display text-[13px] italic transition-colors text-foreground"
      style={{
        opacity: active ? 1 : 0.85,
        borderBottom: active
          ? "1px solid color-mix(in oklab, var(--gold) 70%, transparent)"
          : "1px solid transparent",
        paddingBottom: 2,
      }}
    >
      {children}
      {active && <span className="ml-1 text-[10px]">×</span>}
    </button>
  );
}

function TagsSection({
  filters,
  onChange,
  userTags,
}: {
  filters: GlobalFilters;
  onChange: (next: GlobalFilters) => void;
  userTags: ReadonlyArray<{ id: string; name: string; usage_count: number }>;
}) {
  if (userTags.length === 0) return null;
  const toggle = (name: string) => {
    const next = filters.tags.includes(name)
      ? filters.tags.filter((x) => x !== name)
      : [...filters.tags, name];
    onChange({ ...filters, tags: next });
  };
  return (
    <section>
      <SectionHeader>Tags</SectionHeader>
      {filters.tags.length >= 2 && (
        <div className="mb-3 flex items-center gap-3">
          <span className="font-display text-[10px] uppercase tracking-[0.18em] text-foreground/85">
            Match
          </span>
          {(["any", "all"] as const).map((m) => {
            const active = filters.tagMode === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => onChange({ ...filters, tagMode: m })}
                className="font-display text-[12px] italic transition-colors text-foreground"
                style={{
                  opacity: active ? 1 : 0.75,
                  borderBottom: active
                    ? "1px solid color-mix(in oklab, var(--gold) 70%, transparent)"
                    : "1px solid transparent",
                  paddingBottom: 2,
                }}
              >
                {m === "any" ? "Any tag" : "All tags"}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-2">
        {userTags.map((t) => (
          <ToggleRow
            key={t.id}
            active={filters.tags.includes(t.name)}
            onClick={() => toggle(t.name)}
          >
            {t.name}
          </ToggleRow>
        ))}
      </div>
    </section>
  );
}

function SpreadTypesSection({
  filters,
  onChange,
}: {
  filters: GlobalFilters;
  onChange: (next: GlobalFilters) => void;
}) {
  const toggle = (k: string) => {
    const next = filters.spreadTypes.includes(k)
      ? filters.spreadTypes.filter((x) => x !== k)
      : [...filters.spreadTypes, k];
    onChange({ ...filters, spreadTypes: next });
  };
  return (
    <section>
      <SectionHeader>Spread types</SectionHeader>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {DRAW_TYPE_KEYS.map((k) => (
          <ToggleRow
            key={k}
            active={filters.spreadTypes.includes(k)}
            onClick={() => toggle(k)}
          >
            {DRAW_TYPE_LABEL[k]}
          </ToggleRow>
        ))}
      </div>
    </section>
  );
}

function DepthSection({
  filters,
  onChange,
}: {
  filters: GlobalFilters;
  onChange: (next: GlobalFilters) => void;
}) {
  return (
    <section>
      <SectionHeader>Depth</SectionHeader>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        <ToggleRow
          active={filters.deepOnly}
          onClick={() => onChange({ ...filters, deepOnly: !filters.deepOnly })}
        >
          ✦ Deep readings only
        </ToggleRow>
        <ToggleRow
          active={filters.bookmarked}
          onClick={() =>
            onChange({ ...filters, bookmarked: !filters.bookmarked })
          }
        >
          Bookmarked
        </ToggleRow>
      </div>
    </section>
  );
}

function MoonPhasesSection({
  filters,
  onChange,
}: {
  filters: GlobalFilters;
  onChange: (next: GlobalFilters) => void;
}) {
  const toggle = (p: string) => {
    const next = filters.moonPhases.includes(p)
      ? filters.moonPhases.filter((x) => x !== p)
      : [...filters.moonPhases, p];
    onChange({ ...filters, moonPhases: next });
  };
  return (
    <section>
      <SectionHeader>Moon phases</SectionHeader>
      <div className="flex flex-wrap gap-x-3 gap-y-2">
        {MOON_PHASE_KEYS.map((p) => (
          <ToggleRow
            key={p}
            active={filters.moonPhases.includes(p)}
            onClick={() => toggle(p)}
          >
            {MOON_PHASE_LABEL[p]}
          </ToggleRow>
        ))}
      </div>
    </section>
  );
}

function ReversedSection({
  filters,
  onChange,
}: {
  filters: GlobalFilters;
  onChange: (next: GlobalFilters) => void;
}) {
  return (
    <section>
      <SectionHeader>Reversed</SectionHeader>
      <ToggleRow
        active={filters.reversedOnly}
        onClick={() =>
          onChange({ ...filters, reversedOnly: !filters.reversedOnly })
        }
      >
        Reversed only
      </ToggleRow>
    </section>
  );
}

function StoriesSection({
  filters,
  onChange,
  allStories,
}: {
  filters: GlobalFilters;
  onChange: (next: GlobalFilters) => void;
  allStories: ReadonlyArray<{ id: string; name: string }>;
}) {
  const [showAll, setShowAll] = useState(false);
  if (allStories.length === 0) return null;
  const visible = showAll
    ? allStories
    : allStories.slice(0, STORIES_DEFAULT_VISIBLE);
  const toggle = (id: string) => {
    const next = filters.storyIds.includes(id)
      ? filters.storyIds.filter((x) => x !== id)
      : [...filters.storyIds, id];
    onChange({ ...filters, storyIds: next });
  };
  return (
    <section>
      <SectionHeader>Stories</SectionHeader>
      <div className="flex flex-wrap gap-x-3 gap-y-2">
        {visible.map((s) => (
          <ToggleRow
            key={s.id}
            active={filters.storyIds.includes(s.id)}
            onClick={() => toggle(s.id)}
          >
            {s.name}
          </ToggleRow>
        ))}
      </div>
      {allStories.length > STORIES_DEFAULT_VISIBLE && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="font-display text-[11px] italic mt-2"
          style={{ color: "var(--gold)", background: "none", border: "none" }}
        >
          {showAll ? "Show fewer" : `Show all (${allStories.length})`}
        </button>
      )}
    </section>
  );
}