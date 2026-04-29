import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, Heart, Image as ImageIcon, Pencil, Search, SlidersHorizontal, X as XIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useOracleMode } from "@/lib/use-oracle-mode";
import { SPREAD_META, isValidSpreadMode, type SpreadMode } from "@/lib/spreads";
import { getGuideById } from "@/lib/guides";
import { getCardImagePath, getCardName } from "@/lib/tarot";
import { cn } from "@/lib/utils";
import { useRegisterCloseHandler } from "@/lib/floating-menu-context";
import { stripMarkdown } from "@/lib/strip-markdown";
import {
  EnrichmentPanel,
  type EnrichmentTag,
} from "@/components/journal/EnrichmentPanel";
import { DeepReadingPanel } from "@/components/reading/DeepReadingPanel";
import { TearOffCard } from "@/components/reading/TearOffCard";

export const Route = createFileRoute("/journal")({
  head: () => ({
    meta: [
      { title: "Journal — Moonseed" },
      {
        name: "description",
        content:
          "Your archive of tarot readings — search, filter, and revisit.",
      },
      { property: "og:title", content: "Journal — Moonseed" },
      {
        property: "og:description",
        content: "Your archive of tarot readings.",
      },
    ],
  }),
  component: JournalPage,
});

/* ---------- Types ---------- */

type ReadingRow = {
  id: string;
  user_id: string;
  spread_type: string;
  card_ids: number[];
  interpretation: string | null;
  created_at: string;
  guide_id: string | null;
  lens_id: string | null;
  moon_phase: string | null;
  note: string | null;
  is_favorite: boolean;
  tags: string[] | null;
  is_deep_reading: boolean;
  deep_reading_lenses: Record<string, string> | null;
  mirror_saved: boolean;
};

type TagRow = { id: string; name: string; usage_count: number };

type ViewMode =
  | "readings"
  | "gallery"
  | "notes"
  | "favorites"
  | "threads"
  | "calendar";

/** Draw types the seeker can filter by. Maps to `readings.spread_type`. */
type DrawTypeKey = "single" | "three" | "celtic" | "yes_no";
const DRAW_TYPE_LABEL: Record<DrawTypeKey, string> = {
  single: "Single",
  three: "Three Card",
  celtic: "Celtic Cross",
  yes_no: "Yes / No",
};
const DRAW_TYPE_KEYS: DrawTypeKey[] = ["single", "three", "celtic", "yes_no"];

/** Tag combinator: any-of (OR) vs all-of (AND). */
type TagMode = "any" | "all";

type ThreadRow = {
  id: string;
  summary: string;
  tags: string[] | null;
  reading_ids: string[] | null;
  status: "emerging" | "active" | "quieting" | "retired" | "reawakened";
  detected_at: string;
  pattern_id: string | null;
};

type PatternRow = {
  id: string;
  name: string;
  lifecycle_state: string;
};

/* ---------- Helpers ---------- */

function relativeTime(iso: string): string {
  const d = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - d);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function spreadLabel(spread: string): string {
  if (isValidSpreadMode(spread)) return SPREAD_META[spread as SpreadMode].label;
  return spread;
}

const PHASE_GLYPHS: Record<string, string> = {
  "New Moon": "🌑",
  "Waxing Crescent": "🌒",
  "First Quarter": "🌓",
  "Waxing Gibbous": "🌔",
  "Full Moon": "🌕",
  "Waning Gibbous": "🌖",
  "Last Quarter": "🌗",
  "Waning Crescent": "🌘",
};

/* ---------- Page ---------- */

function JournalPage() {
  const { user, loading: authLoading } = useAuth();
  const { isOracle } = useOracleMode();

  const [readings, setReadings] = useState<ReadingRow[]>([]);
  const [tags, setTags] = useState<TagRow[]>([]);
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [patternsById, setPatternsById] = useState<Record<string, PatternRow>>({});
  const [photoCounts, setPhotoCounts] = useState<Record<string, number>>({});
  // Cover photo per reading: signed URL for the earliest photo.
  const [photoCovers, setPhotoCovers] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);

  const [search, setSearch] = useState("");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [tagMode, setTagMode] = useState<TagMode>("all");
  const [activeDrawTypes, setActiveDrawTypes] = useState<DrawTypeKey[]>([]);
  const [deepOnly, setDeepOnly] = useState(false);
  // YYYY-MM-DD selected from the calendar view; null = no date filter.
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("readings");
  const [openId, setOpenId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Fetch readings + tags + photo counts whenever the user resolves.
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      const [{ data: rows }, { data: tagRows }, { data: photoRows }] =
        await Promise.all([
          supabase
            .from("readings")
            .select(
              "id,user_id,spread_type,card_ids,interpretation,created_at,guide_id,lens_id,moon_phase,note,is_favorite,tags,is_deep_reading,deep_reading_lenses,mirror_saved",
            )
            .eq("user_id", user.id)
            .order("created_at", { ascending: false })
            .limit(500),
          supabase
            .from("user_tags")
            .select("id,name,usage_count")
            .eq("user_id", user.id)
            .order("usage_count", { ascending: false })
            .limit(100),
          supabase
            .from("reading_photos")
            .select("reading_id,storage_path,created_at")
            .eq("user_id", user.id)
            .order("created_at", { ascending: true }),
        ]);
      if (cancelled) return;
      setReadings((rows ?? []) as ReadingRow[]);
      setTags((tagRows ?? []) as TagRow[]);
      // Threads load is independent — never block the main journal on it.
      void (async () => {
        const { data: threadRows } = await supabase
          .from("symbolic_threads")
          .select("id,summary,tags,reading_ids,status,detected_at,pattern_id")
          .eq("user_id", user.id)
          .order("detected_at", { ascending: false });
        if (!cancelled) setThreads((threadRows ?? []) as ThreadRow[]);
        const { data: patternRows } = await supabase
          .from("patterns")
          .select("id,name,lifecycle_state")
          .eq("user_id", user.id);
        if (!cancelled) {
          const map: Record<string, PatternRow> = {};
          for (const p of (patternRows ?? []) as PatternRow[]) map[p.id] = p;
          setPatternsById(map);
        }
      })();
      const counts: Record<string, number> = {};
      // Pick earliest photo per reading as the cover.
      const coverPaths: Record<string, string> = {};
      for (const p of (photoRows ?? []) as Array<{
        reading_id: string;
        storage_path: string;
      }>) {
        counts[p.reading_id] = (counts[p.reading_id] ?? 0) + 1;
        if (!coverPaths[p.reading_id]) coverPaths[p.reading_id] = p.storage_path;
      }
      setPhotoCounts(counts);
      setLoaded(true);

      // Sign URLs for the cover photos in parallel.
      const entries = Object.entries(coverPaths);
      if (entries.length > 0) {
        const signed = await Promise.all(
          entries.map(async ([rid, path]) => {
            const { data } = await supabase.storage
              .from("reading-photos")
              .createSignedUrl(path, 60 * 60);
            return [rid, data?.signedUrl ?? ""] as const;
          }),
        );
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const [rid, url] of signed) if (url) map[rid] = url;
        setPhotoCovers(map);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  // Apply search + tag filters once, share across all four views.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return readings.filter((r) => {
      if (activeTags.length > 0) {
        const rt = r.tags ?? [];
        if (tagMode === "all") {
          if (!activeTags.every((t) => rt.includes(t))) return false;
        } else {
          if (!activeTags.some((t) => rt.includes(t))) return false;
        }
      }
      if (activeDrawTypes.length > 0) {
        if (!activeDrawTypes.includes(r.spread_type as DrawTypeKey))
          return false;
      }
      if (deepOnly && !r.is_deep_reading) return false;
      if (activeDate) {
        const d = new Date(r.created_at);
        const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        if (local !== activeDate) return false;
      }
      if (q.length > 0) {
        const interp = (r.interpretation ?? "").toLowerCase();
        const note = (r.note ?? "").toLowerCase();
        const spread = spreadLabel(r.spread_type).toLowerCase();
        const guide = getGuideById(r.guide_id).name.toLowerCase();
        const tagBlob = (r.tags ?? []).join(" ").toLowerCase();
        if (
          !interp.includes(q) &&
          !note.includes(q) &&
          !spread.includes(q) &&
          !guide.includes(q) &&
          !tagBlob.includes(q)
        )
          return false;
      }
      return true;
    });
  }, [readings, search, activeTags, tagMode, activeDrawTypes, deepOnly, activeDate]);

  const galleryItems = useMemo(
    () => filtered.filter((r) => (photoCounts[r.id] ?? 0) > 0),
    [filtered, photoCounts],
  );
  const noteItems = useMemo(
    () => filtered.filter((r) => (r.note ?? "").trim().length > 0),
    [filtered],
  );
  const favItems = useMemo(
    () => filtered.filter((r) => r.is_favorite),
    [filtered],
  );

  const topTags = tags.slice(0, 8);
  const openReading = openId
    ? readings.find((r) => r.id === openId) ?? null
    : null;

  // Stable callbacks for the EnrichmentPanel — keep the Journal list and
  // tag library in sync with edits made inside the Reading Detail overlay
  // without re-fetching from the server.
  const handleReadingChange = useCallback(
    (next: {
      id: string;
      note: string | null;
      is_favorite: boolean;
      tags: string[] | null;
    }) => {
      setReadings((prev) =>
        prev.map((r) =>
          r.id === next.id
            ? {
                ...r,
                note: next.note,
                is_favorite: next.is_favorite,
                tags: next.tags,
              }
            : r,
        ),
      );
    },
    [],
  );
  const handleTagLibraryChange = useCallback((next: EnrichmentTag[]) => {
    setTags(
      [...next].sort((a, b) => b.usage_count - a.usage_count).slice(0, 100),
    );
  }, []);
  const handlePhotoCountChange = useCallback(
    (readingId: string, count: number) => {
      setPhotoCounts((prev) => {
        if ((prev[readingId] ?? 0) === count) return prev;
        const next = { ...prev };
        if (count <= 0) delete next[readingId];
        else next[readingId] = count;
        return next;
      });
      // Refresh the cover photo for this reading so the Gallery view stays
      // in sync after uploads/removals from the Detail enrichment panel.
      void (async () => {
        if (count <= 0) {
          setPhotoCovers((prev) => {
            if (!(readingId in prev)) return prev;
            const next = { ...prev };
            delete next[readingId];
            return next;
          });
          return;
        }
        const { data: row } = await supabase
          .from("reading_photos")
          .select("storage_path")
          .eq("reading_id", readingId)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (!row?.storage_path) return;
        const { data: signed } = await supabase.storage
          .from("reading-photos")
          .createSignedUrl(row.storage_path, 60 * 60);
        if (signed?.signedUrl) {
          setPhotoCovers((prev) => ({ ...prev, [readingId]: signed.signedUrl }));
        }
      })();
    },
    [],
  );

  // Count of currently-active filters (excludes search and active date,
  // which have their own UI affordances). Drives the badge on the mobile
  // "Filter" button.
  const activeFilterCount =
    activeTags.length + activeDrawTypes.length + (deepOnly ? 1 : 0);

  const filtersNode = (
    <FiltersPanel
      topTags={topTags}
      activeTags={activeTags}
      setActiveTags={setActiveTags}
      tagMode={tagMode}
      setTagMode={setTagMode}
      activeDrawTypes={activeDrawTypes}
      setActiveDrawTypes={setActiveDrawTypes}
      deepOnly={deepOnly}
      setDeepOnly={setDeepOnly}
      onClearAll={() => {
        setActiveTags([]);
        setActiveDrawTypes([]);
        setDeepOnly(false);
      }}
    />
  );

  return (
    <div className="bg-cosmos relative flex h-dvh">
      {/* Right-side flyout filter drawer — used on both mobile and
          desktop. The backdrop is pointer-events:none so the journal
          behind keeps scrolling; a small left-edge tap target closes
          the drawer. */}
      {filtersOpen && (
        <>
          <div
            aria-hidden
            className="fixed inset-0 z-40 bg-transparent"
            style={{ pointerEvents: "none" }}
          />
          <button
            type="button"
            aria-label="Close filters"
            onClick={() => setFiltersOpen(false)}
            className="fixed top-0 z-40 h-dvh w-10 cursor-pointer bg-transparent"
            style={{ right: "var(--journal-drawer-w)" }}
          />
        </>
      )}
      <aside
        aria-hidden={!filtersOpen}
        className="journal-filter-drawer fixed right-0 top-0 z-50 flex h-dvh flex-col overflow-y-auto border-l shadow-2xl transition-transform duration-300 ease-out"
        style={{
          width: "var(--journal-drawer-w)",
          borderColor:
            "color-mix(in oklab, var(--gold) 18%, transparent)",
          background: "oklch(0.08 0.03 280)",
          paddingTop:
            "calc(env(safe-area-inset-top,0px) + 72px)",
          paddingBottom: "calc(env(safe-area-inset-bottom,0px) + 96px)",
          paddingLeft: 20,
          paddingRight: 20,
          transform: filtersOpen ? "translateX(0)" : "translateX(100%)",
          pointerEvents: filtersOpen ? "auto" : "none",
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
            onClick={() => setFiltersOpen(false)}
            aria-label="Close"
            className="rounded-full p-1 text-muted-foreground hover:text-gold focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
          >
            <XIcon size={16} strokeWidth={1.5} />
          </button>
        </div>
        {filtersNode}
      </aside>

    <main className="relative h-dvh flex-1 overflow-y-auto px-5 pb-28">
      {/* Sticky header — title, search, filter button, tab row.
          Stays pinned while the body below scrolls. */}
      <div
        className="sticky top-0 z-30 -mx-5 px-5 pt-[calc(env(safe-area-inset-top,0px)+12px)]"
        style={{
          background:
            "linear-gradient(to bottom, oklch(0.10 0.03 280) 92%, transparent)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
        }}
      >
        <h1
          className="font-display text-2xl italic text-gold"
          style={{ opacity: "var(--ro-plus-20)" }}
        >
          Journal
        </h1>

      {/* Search */}
      <div className="mt-2 flex items-center gap-2">
        <Search
          size={14}
          strokeWidth={1.5}
          className="text-gold"
          style={{ opacity: "var(--ro-plus-10)" }}
          aria-hidden
        />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={
            isOracle ? "Search your practice…" : "Search readings…"
          }
          className="w-full bg-transparent py-1 font-display text-[15px] italic text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
          style={{
            borderBottom:
              "1px solid color-mix(in oklab, var(--gold) 20%, transparent)",
          }}
        />
        <button
          type="button"
          onClick={() => setFiltersOpen(true)}
          aria-label="Filter"
          className="journal-filter-btn ml-auto inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 font-display text-[12px] italic text-gold transition-opacity"
          style={{
            border:
              "1px solid color-mix(in oklab, var(--gold) 30%, transparent)",
          }}
        >
          <SlidersHorizontal
            className="journal-filter-btn__icon"
            size={14}
            strokeWidth={1.5}
            aria-hidden
          />
          {activeFilterCount > 0 && (
            <span
              className="inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono text-[10px] tabular-nums leading-none"
              style={{
                background: "var(--gold)",
                color: "oklch(0.10 0.03 280)",
              }}
            >
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {/* Tag strip */}
      {/* Compact filter row — Filter button (mobile only — sidebar covers
          desktop) plus the active-date chip. The full filter UI lives in
          either the bottom sheet or the desktop sidebar. */}
      <div className="mt-1 mb-1 flex flex-wrap items-center gap-x-3 gap-y-1" style={{ paddingTop: 4, paddingBottom: 4 }}>
        {(activeTags.length > 0 || activeDrawTypes.length > 0 || deepOnly || activeDate) && (
          <button
            type="button"
            onClick={() => {
              setActiveTags([]);
              setActiveDrawTypes([]);
              setDeepOnly(false);
              setActiveDate(null);
            }}
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "var(--text-body-sm)",
              fontWeight: 700,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              color: "#d4a843",
              opacity: 1,
              whiteSpace: "nowrap",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "0 var(--space-2) 0 0",
            }}
          >
            CLEAR FILTERS
          </button>
        )}
        {/* Inline summary of active filters — visible on all sizes so the
            seeker always sees what's narrowing their results. */}
        {(activeTags.length > 0 || activeDrawTypes.length > 0 || deepOnly) && (
          <span
            className="font-display text-[11px] italic text-muted-foreground"
            style={{ opacity: "var(--ro-plus-20)" }}
          >
            {[
              ...activeTags,
              ...activeDrawTypes.map((k) => DRAW_TYPE_LABEL[k]),
              ...(deepOnly ? ["Deep readings"] : []),
            ].join(" · ")}
          </span>
        )}
        {activeDate && (
          <button
            type="button"
            onClick={() => setActiveDate(null)}
            className="ml-auto inline-flex items-center gap-1 font-display text-[11px] italic text-muted-foreground"
            style={{ opacity: "var(--ro-plus-20)" }}
          >
            <XIcon size={11} strokeWidth={1.5} />
            {new Date(activeDate + "T12:00:00").toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </button>
        )}
      </div>

      {/* View tabs — icons only on mobile (< sm), label-only at sm+ */}
      <div className="mt-5 flex items-center gap-5">
        {(
          [
            ["readings", "Readings", BookOpen],
            ["gallery", "Gallery", ImageIcon],
            ["notes", "Notes", Pencil],
            ["favorites", "Favorites", Heart],
            ["calendar", "Calendar", null],
            ["threads", "Threads", null],
          ] as const
        ).map(([key, label, Icon]) => {
          const active = view === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              aria-label={label}
              className="font-display text-[13px] italic text-gold transition-opacity"
              style={{
                opacity: active ? "var(--ro-plus-40)" : "var(--ro-plus-10)",
                borderBottom: active
                  ? "1px solid color-mix(in oklab, var(--gold) 60%, transparent)"
                  : "1px solid transparent",
                paddingBottom: 2,
              }}
            >
              {Icon ? (
                <>
                  <span className="inline-flex sm:hidden">
                    <Icon size={16} strokeWidth={1.5} aria-hidden />
                  </span>
                  <span className="hidden sm:inline">{label}</span>
                </>
              ) : (
                <span>{label}</span>
              )}
            </button>
          );
        })}
      </div>
        <div className="h-3" />
      </div>

      {/* Body */}
      <div className="mt-6">
        {!loaded ? (
          <p
            className="mt-12 text-center font-display text-sm italic text-muted-foreground"
            style={{ opacity: "var(--ro-plus-10)" }}
          >
            …
          </p>
        ) : view === "readings" ? (
          <ReadingsList
            items={filtered}
            isOracle={isOracle}
            photoCounts={photoCounts}
            onOpen={setOpenId}
          />
        ) : view === "gallery" ? (
          <GalleryView
            items={galleryItems}
            covers={photoCovers}
            isOracle={isOracle}
            onOpen={setOpenId}
          />
        ) : view === "notes" ? (
          <NotesView items={noteItems} isOracle={isOracle} onOpen={setOpenId} />
        ) : view === "favorites" ? (
          <ReadingsList
            items={favItems}
            emptyOracle="Nothing yet held close to the heart…"
            emptyPlain="Favorite a reading to see it here."
            isOracle={isOracle}
            photoCounts={photoCounts}
            onOpen={setOpenId}
          />
        ) : view === "calendar" ? (
          <CalendarView
            readings={readings}
            activeTags={activeTags}
            tagMode={tagMode}
            activeDrawTypes={activeDrawTypes}
            activeDate={activeDate}
            onSelectDate={(d) => {
              setActiveDate((cur) => (cur === d ? null : d));
              setView("readings");
            }}
          />
        ) : (
          <ThreadsView threads={threads} patternsById={patternsById} />
        )}
      </div>

      {openReading && (
        <ReadingDetail
          reading={openReading}
          onClose={() => setOpenId(null)}
          isOracle={isOracle}
          tagLibrary={tags}
          onReadingChange={handleReadingChange}
          onTagLibraryChange={handleTagLibraryChange}
          onPhotoCountChange={handlePhotoCountChange}
        />
      )}
    </main>
    </div>
  );
}

/* ---------- Readings list (also Favorites view) ---------- */

function ReadingsList({
  items,
  isOracle,
  photoCounts: _photoCounts,
  onOpen,
  emptyOracle,
  emptyPlain,
}: {
  items: ReadingRow[];
  isOracle: boolean;
  photoCounts: Record<string, number>;
  onOpen: (id: string) => void;
  emptyOracle?: string;
  emptyPlain?: string;
}) {
  if (items.length === 0) {
    return (
      <Empty
        oracle={emptyOracle ?? "Your practice awaits its first telling…"}
        plain={emptyPlain ?? "No readings yet. Complete a reading to begin."}
        isOracle={isOracle}
      />
    );
  }
  return (
    <ul className="flex flex-col gap-5">
      {items.map((r) => (
        <li key={r.id}>
          <ReadingCard reading={r} onOpen={onOpen} />
        </li>
      ))}
    </ul>
  );
}

function ReadingCard({
  reading,
  onOpen,
}: {
  reading: ReadingRow;
  onOpen: (id: string) => void;
}) {
  const guide = getGuideById(reading.guide_id);
  const visible = reading.card_ids.slice(0, 5);
  const overflow = reading.card_ids.length - visible.length;
  const interpFirst = (reading.interpretation ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const interpClean = stripMarkdown(interpFirst);

  return (
    <button
      type="button"
      onClick={() => onOpen(reading.id)}
      className="block w-full rounded-2xl px-4 py-4 text-left transition-colors hover:bg-white/[0.02]"
      style={{
        border: "1px solid color-mix(in oklab, var(--gold) 8%, transparent)",
        background: "color-mix(in oklab, oklch(0.10 0.03 280) 30%, transparent)",
      }}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            <span style={{ opacity: "var(--ro-plus-30)" }}>
              {spreadLabel(reading.spread_type)}
            </span>
            <span style={{ opacity: "var(--ro-plus-20)" }}>
              {relativeTime(reading.created_at)}
            </span>
            {reading.is_deep_reading && (
              <span
                title="Deep reading"
                className="text-gold"
                style={{
                  opacity: "var(--ro-plus-50)",
                  letterSpacing: 0,
                  fontSize: "var(--text-body-sm)",
                }}
                aria-label="Deep reading"
              >
                ✦
              </span>
            )}
          </div>
          <div
            className="mt-1 flex items-center gap-2 font-display text-[12px] italic"
            style={{ opacity: "var(--ro-plus-10)" }}
          >
            {reading.moon_phase && (
              <span>
                {PHASE_GLYPHS[reading.moon_phase] ?? "🌙"} {reading.moon_phase}
              </span>
            )}
            {reading.moon_phase && <span aria-hidden>·</span>}
            <span>{guide.name}</span>
          </div>
        </div>
        <Heart
          size={16}
          strokeWidth={1.5}
          className={cn(
            "shrink-0 transition-opacity",
            reading.is_favorite ? "text-gold" : "text-muted-foreground",
          )}
          fill={reading.is_favorite ? "currentColor" : "none"}
          style={{
            opacity: reading.is_favorite
              ? "var(--ro-plus-50)"
              : "var(--ro-plus-10)",
          }}
          aria-hidden
        />
      </div>

      {/* Card thumbnails */}
      <div className="mt-3 flex items-center gap-1.5">
        {visible.map((id) => (
          <img
            key={id}
            src={getCardImagePath(id)}
            alt={getCardName(id)}
            loading="lazy"
            className="h-12 w-8 rounded-[3px] object-cover"
            style={{
              border: "1px solid color-mix(in oklab, var(--gold) 14%, transparent)",
              opacity: "var(--ro-plus-30)",
            }}
          />
        ))}
        {overflow > 0 && (
          <span
            className="ml-1 font-display text-[11px] italic text-muted-foreground"
            style={{ opacity: "var(--ro-plus-20)" }}
          >
            +{overflow} more
          </span>
        )}
      </div>

      {/* Interpretation excerpt */}
      {interpClean && (
        <p
          className="mt-3 font-display text-[14px] italic leading-snug text-foreground"
          style={{
            opacity: "var(--ro-plus-20)",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {interpClean}
        </p>
      )}

      {/* Tags */}
      {(reading.tags ?? []).length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {(reading.tags ?? []).map((t) => (
            <span
              key={t}
              className="font-display text-[11px] italic text-gold"
              style={{ opacity: "var(--ro-plus-20)" }}
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

/* ---------- Gallery view ---------- */

function GalleryView({
  items,
  covers,
  isOracle,
  onOpen,
}: {
  items: ReadingRow[];
  covers: Record<string, string>;
  isOracle: boolean;
  onOpen: (id: string) => void;
}) {
  if (items.length === 0) {
    return (
      <Empty
        oracle="No images have been woven into your practice yet…"
        plain="Add photos to your readings to see them here."
        isOracle={isOracle}
      />
    );
  }
  return (
    <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3">
      {items.map((r) => {
        const photoUrl = covers[r.id];
        // Fall back to the first card image while the signed URL is in flight.
        const fallback = getCardImagePath(r.card_ids[0] ?? 0);
        return (
          <button
            key={r.id}
            type="button"
            onClick={() => onOpen(r.id)}
            className="relative aspect-square overflow-hidden rounded-md"
            style={{
              border:
                "1px solid color-mix(in oklab, var(--gold) 12%, transparent)",
            }}
          >
            <img
              src={photoUrl ?? fallback}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
              style={photoUrl ? undefined : { opacity: "var(--ro-plus-30)" }}
            />
            <div
              className="absolute inset-x-0 bottom-0 flex items-center justify-between px-2 py-1.5 text-[10px] uppercase tracking-[0.14em]"
              style={{
                background:
                  "linear-gradient(to top, oklch(0 0 0 / 60%), transparent)",
                color: "var(--gold)",
                opacity: "var(--ro-plus-20)",
              }}
            >
              <span>{spreadLabel(r.spread_type)}</span>
              <span>{relativeTime(r.created_at)}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Notes view ---------- */

function NotesView({
  items,
  isOracle,
  onOpen,
}: {
  items: ReadingRow[];
  isOracle: boolean;
  onOpen: (id: string) => void;
}) {
  if (items.length === 0) {
    return (
      <Empty
        oracle="Your inner voice has not yet spoken here…"
        plain="Add notes to your readings to see them here."
        isOracle={isOracle}
      />
    );
  }
  return (
    <ul className="flex flex-col gap-5">
      {items.map((r) => (
        <li key={r.id}>
          <button
            type="button"
            onClick={() => onOpen(r.id)}
            className="block w-full rounded-xl px-4 py-3 text-left transition-colors hover:bg-white/[0.02]"
          >
            <div className="flex items-baseline gap-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              <span style={{ opacity: "var(--ro-plus-20)" }}>
                {relativeTime(r.created_at)}
              </span>
              <span style={{ opacity: "var(--ro-plus-30)" }}>
                {spreadLabel(r.spread_type)}
              </span>
            </div>
            <p
              className="mt-2 font-display text-[15px] italic leading-snug text-foreground"
              style={{
                opacity: "var(--ro-plus-30)",
                display: "-webkit-box",
                WebkitLineClamp: 4,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {r.note}
            </p>
          </button>
        </li>
      ))}
    </ul>
  );
}

/* ---------- Empty state ---------- */

function Empty({
  oracle,
  plain,
  isOracle,
}: {
  oracle: string;
  plain: string;
  isOracle: boolean;
}) {
  return (
    <p
      className="mx-auto mt-16 max-w-xs text-center font-display text-[14px] italic text-muted-foreground"
      style={{ opacity: "var(--ro-plus-10)" }}
    >
      {isOracle ? oracle : plain}
    </p>
  );
}

/* ---------- Threads view (Phase 7) ---------- */

function ThreadsView({
  threads,
  patternsById,
}: {
  threads: ThreadRow[];
  patternsById: Record<string, PatternRow>;
}) {
  if (threads.length === 0) {
    return (
      <div className="mx-auto mt-16 flex max-w-md flex-col items-center gap-4 px-4 text-center">
        <p
          className="font-display italic text-gold"
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "var(--text-body-lg)",
            lineHeight: 1.5,
            opacity: "var(--ro-plus-30)",
          }}
        >
          The threads are listening.
        </p>
        <p
          className="font-display italic text-muted-foreground"
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "var(--text-body-sm)",
            lineHeight: 1.7,
            opacity: "var(--ro-plus-10)",
          }}
        >
          This space fills slowly, and that is by design. Threads are not
          tags or summaries — they are deeper patterns that emerge only when
          the same symbolic current has moved through your practice more
          than once. The cards know. When something is truly recurring, it
          will surface here on its own.
        </p>
      </div>
    );
  }
  // Group threads by pattern_id; ungrouped threads fall under "Other threads".
  const grouped = new Map<string, ThreadRow[]>();
  const ungrouped: ThreadRow[] = [];
  for (const t of threads) {
    if (t.pattern_id && patternsById[t.pattern_id]) {
      const arr = grouped.get(t.pattern_id) ?? [];
      arr.push(t);
      grouped.set(t.pattern_id, arr);
    } else {
      ungrouped.push(t);
    }
  }
  const orderedPatternIds = Array.from(grouped.keys()).sort((a, b) =>
    patternsById[a].name.localeCompare(patternsById[b].name),
  );

  return (
    <div className="flex flex-col gap-8">
      {orderedPatternIds.map((pid) => {
        const p = patternsById[pid];
        return (
          <section key={pid} className="flex flex-col gap-3">
            <Link
              to="/threads/$patternId"
              params={{ patternId: pid }}
              className="flex items-baseline justify-between gap-3 text-gold no-underline"
            >
              <h3
                className="m-0 font-display italic"
                style={{
                  fontFamily: "var(--font-serif)",
                  fontSize: "var(--text-heading-sm, 17px)",
                  color: "var(--gold)",
                }}
              >
                {p.name}
              </h3>
              <span
                className="font-display text-[10px] uppercase tracking-[0.2em]"
                style={{ opacity: "var(--ro-plus-20)" }}
              >
                {p.lifecycle_state}
              </span>
            </Link>
            <ul className="flex flex-col gap-3">
              {grouped.get(pid)!.map((t) => (
                <ThreadCard key={t.id} t={t} />
              ))}
            </ul>
          </section>
        );
      })}
      {ungrouped.length > 0 && (
        <section className="flex flex-col gap-3">
          {orderedPatternIds.length > 0 && (
            <h3
              className="m-0 font-display italic text-muted-foreground"
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: "var(--text-body-sm)",
                opacity: "var(--ro-plus-20)",
              }}
            >
              Other threads
            </h3>
          )}
          <ul className="flex flex-col gap-3">
            {ungrouped.map((t) => (
              <ThreadCard key={t.id} t={t} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ThreadCard({ t }: { t: ThreadRow }) {
  const statusOpacity =
    t.status === "active" ? 1 : t.status === "emerging" ? 0.6 : 0.3;
  const statusLabel =
    t.status === "reawakened"
      ? "Reawakened"
      : t.status.charAt(0).toUpperCase() + t.status.slice(1);
  const readingCount = (t.reading_ids ?? []).length;
  return (
    <li className="rounded-lg border border-gold/20 bg-gold/5 px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span
          className="font-display text-[10px] uppercase tracking-[0.2em] text-gold"
          style={{ opacity: statusOpacity }}
        >
          {statusLabel}
        </span>
        {readingCount > 0 && (
          <span className="font-display text-[11px] italic text-muted-foreground">
            across {readingCount} {readingCount === 1 ? "reading" : "readings"}
          </span>
        )}
      </div>
      <p
        className="font-display italic"
        style={{
          fontSize: "var(--text-body)",
          lineHeight: 1.55,
          color: "color-mix(in oklab, var(--foreground) 88%, transparent)",
        }}
      >
        {t.summary}
      </p>
      {(t.tags?.length ?? 0) > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {t.tags!.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-gold/30 px-2 py-0.5 font-display text-[11px] italic text-gold"
              style={{ opacity: "var(--ro-plus-30)" }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}

/* ---------- Reading detail overlay ---------- */

/* ---------- Calendar view ---------- */

/**
 * Month grid showing a small reading-count badge on every day that has
 * one or more readings. Tapping a day filters the journal to that date
 * and switches back to the Readings tab. Tapping the same day a second
 * time clears the filter (handled by the parent).
 */
function CalendarView({
  readings,
  activeTags,
  tagMode,
  activeDrawTypes,
  activeDate,
  onSelectDate,
}: {
  readings: ReadingRow[];
  activeTags: string[];
  tagMode: TagMode;
  activeDrawTypes: DrawTypeKey[];
  activeDate: string | null;
  onSelectDate: (d: string) => void;
}) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  // YYYY-MM-DD -> count of readings on that local day, after applying
  // the same tag / draw-type filters used by the rest of the journal.
  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of readings) {
      if (activeTags.length > 0) {
        const rt = r.tags ?? [];
        if (tagMode === "all") {
          if (!activeTags.every((t) => rt.includes(t))) continue;
        } else {
          if (!activeTags.some((t) => rt.includes(t))) continue;
        }
      }
      if (activeDrawTypes.length > 0) {
        if (!activeDrawTypes.includes(r.spread_type as DrawTypeKey)) continue;
      }
      const d = new Date(r.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      map[key] = (map[key] ?? 0) + 1;
    }
    return map;
  }, [readings, activeTags, tagMode, activeDrawTypes]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const monthLabel = cursor.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
  const firstWeekday = new Date(year, month, 1).getDay(); // 0..6 Sun..Sat
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<{ day: number; key: string } | null> = [];
  for (let i = 0; i < firstWeekday; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) {
    const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ day: d, key });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const goPrev = () => setCursor(new Date(year, month - 1, 1));
  const goNext = () => setCursor(new Date(year, month + 1, 1));

  const todayKey = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();

  return (
    <div className="journal-calendar mx-auto max-w-md">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={goPrev}
          className="font-display text-[13px] italic text-gold transition-opacity"
          style={{ opacity: "var(--ro-plus-20)" }}
        >
          ← Prev
        </button>
        <span
          className="font-display text-[14px] italic text-gold"
          style={{ opacity: "var(--ro-plus-30)" }}
        >
          {monthLabel}
        </span>
        <button
          type="button"
          onClick={goNext}
          className="font-display text-[13px] italic text-gold transition-opacity"
          style={{ opacity: "var(--ro-plus-20)" }}
        >
          Next →
        </button>
      </div>

      <div className="mt-4 grid grid-cols-7 gap-1 text-center text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} style={{ opacity: "var(--ro-plus-10)" }}>
            {d}
          </div>
        ))}
      </div>

      <div className="mt-2 grid grid-cols-7 gap-1">
        {cells.map((c, i) => {
          if (!c) return <div key={`x-${i}`} className="aspect-square" />;
          const count = counts[c.key] ?? 0;
          const selected = activeDate === c.key;
          const isToday = todayKey === c.key;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => onSelectDate(c.key)}
              className={cn(
                "relative flex aspect-square items-center justify-center rounded-md text-[13px] transition-colors",
                selected ? "bg-gold/15 text-gold" : "text-foreground",
              )}
              style={{
                border: selected
                  ? "1px solid color-mix(in oklab, var(--gold) 50%, transparent)"
                  : isToday
                    ? "1px solid color-mix(in oklab, var(--gold) 25%, transparent)"
                    : "1px solid transparent",
                opacity: count > 0 ? "var(--ro-plus-30)" : "var(--ro-plus-0)",
              }}
            >
              <span style={{ fontFamily: "var(--font-serif)" }}>{c.day}</span>
              {count > 0 && (
                <span
                  className="journal-calendar-badge absolute -bottom-1 -right-1 rounded-full px-1 leading-none"
                  style={{
                    background: "var(--gold)",
                    color: "oklch(0.10 0.03 280)",
                    border:
                      "1px solid color-mix(in oklab, var(--gold) 70%, transparent)",
                    boxShadow: "0 1px 4px oklch(0 0 0 / 0.5)",
                  }}
                  aria-label={`${count} ${count === 1 ? "reading" : "readings"}`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {activeDate && (
        <p
          className="mt-4 text-center font-display text-[12px] italic text-muted-foreground"
          style={{ opacity: "var(--ro-plus-20)" }}
        >
          Tap the same day again to clear the filter.
        </p>
      )}
    </div>
  );
}

function ReadingDetail({
  reading,
  onClose,
  isOracle,
  tagLibrary,
  onReadingChange,
  onTagLibraryChange,
  onPhotoCountChange,
}: {
  reading: ReadingRow;
  onClose: () => void;
  isOracle: boolean;
  tagLibrary: EnrichmentTag[];
  onReadingChange: (next: {
    id: string;
    note: string | null;
    is_favorite: boolean;
    tags: string[] | null;
  }) => void;
  onTagLibraryChange: (next: EnrichmentTag[]) => void;
  onPhotoCountChange: (readingId: string, count: number) => void;
}) {
  const guide = getGuideById(reading.guide_id);
  const positions = isValidSpreadMode(reading.spread_type)
    ? SPREAD_META[reading.spread_type as SpreadMode].positions
    : undefined;
  const [shareOpen, setShareOpen] = useState(false);
  const spreadModeForShare: SpreadMode = isValidSpreadMode(reading.spread_type)
    ? (reading.spread_type as SpreadMode)
    : "single";
  const sharePicks = reading.card_ids.map((id, idx) => ({
    id: idx,
    cardIndex: id,
  }));
  const sharePositions =
    positions ?? reading.card_ids.map((id) => getCardName(id));

  // Lock body scroll while the overlay is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Close on Escape.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  // The floating ··· menu's X icon closes the overlay; we no longer
  // render a standalone close button inside the dialog.
  useRegisterCloseHandler(onClose);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Reading detail"
      className="bg-cosmos fixed inset-0 z-50 overflow-y-auto"
    >
      <div className="mx-auto max-w-2xl px-5 pb-24 pt-[calc(env(safe-area-inset-top,0px)+56px)]">
        <header>
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            <span style={{ opacity: "var(--ro-plus-30)" }}>
              {spreadLabel(reading.spread_type)}
            </span>
            <span className="mx-2" aria-hidden>
              ·
            </span>
            <span style={{ opacity: "var(--ro-plus-20)" }}>
              {new Date(reading.created_at).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
          </div>
          <div
            className="mt-2 font-display text-sm italic text-gold"
            style={{ opacity: "var(--ro-plus-20)" }}
          >
            {reading.moon_phase &&
              `${PHASE_GLYPHS[reading.moon_phase] ?? "🌙"} ${reading.moon_phase} · `}
            {guide.name}
          </div>
        </header>

        {/* Cards */}
        <div className="mt-6 flex flex-wrap items-end justify-center gap-3">
          {reading.card_ids.map((id, idx) => (
            <div key={`${id}-${idx}`} className="flex flex-col items-center">
              <img
                src={getCardImagePath(id)}
                alt={getCardName(id)}
                className="h-32 w-20 rounded-md object-cover"
                style={{
                  border:
                    "1px solid color-mix(in oklab, var(--gold) 18%, transparent)",
                  opacity: "var(--ro-plus-40)",
                }}
              />
              <span
                className="mt-1 max-w-[90px] text-center font-display text-[10px] italic text-muted-foreground"
                style={{ opacity: "var(--ro-plus-20)" }}
              >
                {positions?.[idx] ?? getCardName(id)}
              </span>
            </div>
          ))}
        </div>

        {/* Interpretation */}
        {reading.interpretation && (
          <article
            className="mx-auto mt-8 max-w-prose font-display text-[16px] italic leading-relaxed text-foreground"
            style={{
              opacity: "var(--ro-plus-30)",
              whiteSpace: "pre-wrap",
            }}
          >
            {stripMarkdown(reading.interpretation)}
          </article>
        )}

        {/* Deep reading lenses */}
        {reading.is_deep_reading && reading.deep_reading_lenses && (
          <section
            className="mx-auto max-w-prose space-y-6"
            style={{
              marginTop: "var(--space-6)",
              padding: "var(--space-5)",
              borderRadius: "var(--radius-md)",
              border: "1px solid oklch(1 0 0 / 0.22)",
              borderLeft: "2px solid var(--accent)",
              background: "var(--surface-card)",
            }}
          >
            <div
              className="flex items-center gap-2"
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: "var(--text-caption)",
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                color: "color-mix(in oklab, var(--color-foreground) 70%, transparent)",
                opacity: "var(--ro-plus-30)",
              }}
            >
              <span aria-hidden style={{ color: "var(--accent-color)" }}>
                ✦
              </span>
              <span>Deep Reading</span>
              {reading.mirror_saved && (
                <span
                  className="ml-2 italic normal-case tracking-normal"
                  style={{
                    fontSize: "var(--text-caption)",
                    opacity: "var(--ro-plus-20)",
                  }}
                >
                  · mirror saved
                </span>
              )}
            </div>
            {Object.entries(reading.deep_reading_lenses).map(([key, text]) => (
              <div key={key}>
                <h3
                  className="font-display uppercase text-gold mb-1"
                  style={{
                    fontSize: "var(--text-caption)",
                    letterSpacing: "0.2em",
                    opacity: "var(--ro-plus-30)",
                  }}
                >
                  {key.replace(/[-_]/g, " ")}
                </h3>
                <p
                  className="font-display italic leading-relaxed text-foreground"
                  style={{
                    fontSize: "var(--text-body)",
                    opacity: "var(--ro-plus-30)",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {text}
                </p>
              </div>
            ))}
          </section>
        )}

        {/* Enrichment panel: note, tags, photos, favorite — with debounced
            auto-save. Lives below the interpretation per the spec. */}
        <EnrichmentPanel
          reading={{
            id: reading.id,
            user_id: reading.user_id,
            note: reading.note,
            is_favorite: reading.is_favorite,
            tags: reading.tags,
          }}
          tagLibrary={tagLibrary}
          isOracle={isOracle}
          onReadingChange={(next) =>
            onReadingChange({
              id: next.id,
              note: next.note,
              is_favorite: next.is_favorite,
              tags: next.tags,
            })
          }
          onTagLibraryChange={onTagLibraryChange}
          onPhotoCountChange={onPhotoCountChange}
          copyText={reading.interpretation ?? undefined}
          onShare={() => setShareOpen(true)}
        />

        {/* Phase 8: surface the Deep Reading mist (or completed lenses) so
            the seeker can revisit/begin a deep reading from the journal
            detail view, mirroring the live reading screen. */}
        {!reading.is_deep_reading && (
          <DeepReadingPanel
            readingId={reading.id}
            guideId={reading.guide_id ?? undefined}
            lensId={reading.lens_id ?? undefined}
          />
        )}
      </div>
      <TearOffCard
        open={shareOpen}
        onOpenChange={setShareOpen}
        spread={spreadModeForShare}
        picks={sharePicks}
        positionLabels={sharePositions}
        interpretation={{
          overview: reading.interpretation ?? "",
          positions: [],
          closing: "",
        }}
        guideName={guide.name}
        isOracle={isOracle}
      />
    </div>
  );
}

/* ---------- Filters panel (shared between mobile sheet + desktop sidebar) ---------- */

function FiltersPanel({
  topTags,
  activeTags,
  setActiveTags,
  tagMode,
  setTagMode,
  activeDrawTypes,
  setActiveDrawTypes,
  deepOnly,
  setDeepOnly,
  onClearAll,
}: {
  topTags: TagRow[];
  activeTags: string[];
  setActiveTags: React.Dispatch<React.SetStateAction<string[]>>;
  tagMode: TagMode;
  setTagMode: React.Dispatch<React.SetStateAction<TagMode>>;
  activeDrawTypes: DrawTypeKey[];
  setActiveDrawTypes: React.Dispatch<React.SetStateAction<DrawTypeKey[]>>;
  deepOnly: boolean;
  setDeepOnly: React.Dispatch<React.SetStateAction<boolean>>;
  onClearAll: () => void;
}) {
  const hasAny =
    activeTags.length > 0 || activeDrawTypes.length > 0 || deepOnly;
  return (
    <div className="flex flex-col gap-5">
      {/* Deep readings toggle */}
      <section>
        <h3
          className="font-display text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2"
          style={{ opacity: "var(--ro-plus-20)" }}
        >
          Depth
        </h3>
        <button
          type="button"
          onClick={() => setDeepOnly((v) => !v)}
          className="font-display text-[13px] italic text-gold transition-opacity"
          style={{
            opacity: deepOnly ? "var(--ro-plus-40)" : "var(--ro-plus-0)",
            borderBottom: deepOnly
              ? "1px solid color-mix(in oklab, var(--gold) 60%, transparent)"
              : "1px solid transparent",
            paddingBottom: 2,
          }}
        >
          ✦ Deep readings only
          {deepOnly && <span className="ml-1 text-[10px]">×</span>}
        </button>
      </section>

      {/* Tags */}
      {topTags.length > 0 && (
        <section>
          <h3
            className="font-display text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2"
            style={{ opacity: "var(--ro-plus-20)" }}
          >
            Tags
          </h3>
          <div className="flex flex-wrap gap-x-3 gap-y-2">
            {topTags.map((t) => {
              const active = activeTags.includes(t.name);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() =>
                    setActiveTags((prev) =>
                      prev.includes(t.name)
                        ? prev.filter((x) => x !== t.name)
                        : [...prev, t.name],
                    )
                  }
                  className="font-display text-[13px] italic text-gold transition-opacity"
                  style={{
                    opacity: active ? "var(--ro-plus-40)" : "var(--ro-plus-0)",
                    borderBottom: active
                      ? "1px solid color-mix(in oklab, var(--gold) 60%, transparent)"
                      : "1px solid transparent",
                    paddingBottom: 2,
                  }}
                >
                  {t.name}
                  {active && <span className="ml-1 text-[10px]">×</span>}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {activeTags.length >= 2 && (
        <section>
          <h3
            className="font-display text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2"
            style={{ opacity: "var(--ro-plus-20)" }}
          >
            Match
          </h3>
          <div className="flex items-center gap-3">
            {(["any", "all"] as const).map((m) => {
              const active = tagMode === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setTagMode(m)}
                  className="font-display text-[12px] italic text-gold transition-opacity"
                  style={{
                    opacity: active ? "var(--ro-plus-40)" : "var(--ro-plus-10)",
                    borderBottom: active
                      ? "1px solid color-mix(in oklab, var(--gold) 60%, transparent)"
                      : "1px solid transparent",
                    paddingBottom: 2,
                  }}
                >
                  {m === "any" ? "Any tag" : "All tags"}
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <h3
          className="font-display text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2"
          style={{ opacity: "var(--ro-plus-20)" }}
        >
          Draw type
        </h3>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {DRAW_TYPE_KEYS.map((k) => {
            const active = activeDrawTypes.includes(k);
            return (
              <button
                key={k}
                type="button"
                onClick={() =>
                  setActiveDrawTypes((prev) =>
                    prev.includes(k)
                      ? prev.filter((x) => x !== k)
                      : [...prev, k],
                  )
                }
                className="font-display text-[12px] italic text-gold transition-opacity"
                style={{
                  opacity: active ? "var(--ro-plus-40)" : "var(--ro-plus-0)",
                  borderBottom: active
                    ? "1px solid color-mix(in oklab, var(--gold) 60%, transparent)"
                    : "1px solid transparent",
                  paddingBottom: 2,
                }}
              >
                {DRAW_TYPE_LABEL[k]}
              </button>
            );
          })}
        </div>
      </section>

      {hasAny && (
        <button
          type="button"
          onClick={onClearAll}
          className="self-start font-display text-[12px] uppercase tracking-[0.15em] underline-offset-2 hover:underline"
          style={{ color: "#d4a843", opacity: 1, fontWeight: 700 }}
        >
          Clear all
        </button>
      )}
    </div>
  );
}