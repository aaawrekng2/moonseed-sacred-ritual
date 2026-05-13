import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive as ArchiveIcon, BookOpen, Bookmark, CalendarDays, Camera, Ghost, Heart, Image as ImageIcon, MessageCircle, Network, Sparkles, Star, StickyNote, Tag as TagIcon, X as XIcon } from "lucide-react";
import { usePremium } from "@/lib/premium";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { usePortraitOnly } from "@/lib/use-portrait-only";
import { useOracleMode } from "@/lib/use-oracle-mode";
import { SPREAD_META, isValidSpreadMode, type SpreadMode } from "@/lib/spreads";
import { getGuideById } from "@/lib/guides";
import { cn, firstCardName } from "@/lib/utils";
import {
  formatTimeAgo,
  formatDateShort,
  formatDateLong,
  formatDateTime,
  formatMonthYear,
} from "@/lib/dates";
import { useRegisterCloseHandler } from "@/lib/floating-menu-context";
import { stripMarkdown, stripLegacyMoonseedPrefix } from "@/lib/strip-markdown";
import {
  useDeckImage,
  useDeckCornerRadius,
  useActiveDeckCardName,
  useDeckCardName,
  useMultiDeckCardName,
  useMultiDeckImage,
} from "@/lib/active-deck";
import { CardImage } from "@/components/card/CardImage";
import { useElementWidth } from "@/lib/use-element-width";
import { fetchUserDecks, type CustomDeck } from "@/lib/custom-decks";
import { toast } from "sonner";
import {
  EnrichmentPanel,
  type EnrichmentTag,
} from "@/components/journal/EnrichmentPanel";
import { DeepReadingPanel } from "@/components/reading/DeepReadingPanel";
import { ShareBuilder } from "@/components/share/ShareBuilder";
import { HorizontalScroll } from "@/components/HorizontalScroll";
import { useScrollCollapse } from "@/lib/use-scroll-collapse";
import { useIsMobile } from "@/hooks/use-mobile";
import { CardZoomModal } from "@/components/tabletop/CardZoomModal";
import { ArchiveView } from "@/components/journal/ArchiveView";
import { archiveReading, daysUntilPurge, restoreReading } from "@/lib/readings-archive";
import { useServerFn } from "@tanstack/react-start";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import { GlobalFilterBar } from "@/components/filters/GlobalFilterBar";
import { FullScreenSheet } from "@/components/ui/full-screen-sheet";
import { SearchInput } from "@/components/ui/search-input";
import { EmptyHero } from "@/components/ui/empty-hero";
import { EmptyNote } from "@/components/ui/empty-note";
import { useReadingStats, formatReadingStatsLine } from "@/lib/use-reading-stats";
import {
  EMPTY_GLOBAL_FILTERS,
  type GlobalFilters,
} from "@/lib/filters.types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// DD-3 — Subtle gold-tinted placeholder shown while a custom deck's
// images are still being fetched. Prevents the brief Rider-Waite flash
// that used to appear before the user's photographed card resolved.
function CardThumb({
  src,
  alt,
  className,
  style,
  loading,
  onClick,
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
  loading?: "lazy" | "eager";
  onClick?: () => void;
}) {
  if (!src) {
    return (
      <div
        aria-hidden
        className={className}
        style={{
          background: "color-mix(in oklab, var(--gold) 6%, transparent)",
          border:
            "1px solid color-mix(in oklab, var(--gold) 14%, transparent)",
          opacity: 0.4,
          ...(style ?? {}),
        }}
      />
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading={loading}
      className={className}
      style={style}
      onClick={onClick}
    />
  );
}

export const Route = createFileRoute("/journal")({
  validateSearch: (search: Record<string, unknown>) => ({
    batch:
      typeof search.batch === "string" && search.batch.length > 0
        ? (search.batch as string)
        : undefined,
  }),
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
  card_orientations: boolean[] | null;
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
  pattern_id: string | null;
  question: string | null;
  import_batch_id?: string | null;
  /** DB-3.1 — saved deck for THIS reading (null = default Rider-Waite). */
  deck_id?: string | null;
  /** Q38 Fix 1 — per-card source deck for mixed-deck readings. */
  card_deck_ids?: string[] | null;
  /** DV — soft-delete timestamp; null = active reading. */
  archived_at?: string | null;
  /** Q12 — cached tailored journaling prompt for premium seekers. */
  tailored_prompt?: string | null;
  /** Q14 — true once the seeker inserted a prompt into the note. */
  journal_prompt_used?: boolean;
};

type TagRow = { id: string; name: string; usage_count: number };

type ViewMode =
  | "readings"
  | "gallery"
  | "notes"
  | "favorites"
  | "threads"
  | "calendar"
  | "archive";

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
  description: string | null;
};

/* ---------- Helpers ---------- */

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
  // BX — journal stays portrait-only.
  usePortraitOnly();
  const { user, loading: authLoading } = useAuth();
  const { isOracle } = useOracleMode();
  const { batch: batchParam } = Route.useSearch();
  const navigate = useNavigate();
  // FU-8 — iOS large-to-compact title collapse driven by main scroll.
  const scrollRef = useRef<HTMLElement | null>(null);
  const collapseProgress = useScrollCollapse(scrollRef, 40);
  const [batchMeta, setBatchMeta] = useState<{
    sourceFormat: string;
    createdAt: string;
  } | null>(null);

  const [readings, setReadings] = useState<ReadingRow[]>([]);
  const readingStats = useReadingStats(user?.id ?? null);
  const statsLine = formatReadingStatsLine(readingStats);
  // EG-2 — increments on every archive action so ArchiveView remounts
  // (and re-fetches) when the user navigates to the archive tab.
  const [archiveCounter, setArchiveCounter] = useState(0);
  const [tags, setTags] = useState<TagRow[]>([]);
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [patternsById, setPatternsById] = useState<Record<string, PatternRow>>({});
  const [photoCounts, setPhotoCounts] = useState<Record<string, number>>({});
  // Cover photo per reading: signed URL for the earliest photo.
  const [photoCovers, setPhotoCovers] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);

  const [search, setSearch] = useState("");
  // FU-3 — Consolidated filter state. Mirrors what Insights does for
  // its InsightsFilters. activeDate stays separate — it's a date
  // picker tied to the calendar tab, not a generic filter.
  const [journalFilters, setJournalFilters] = useState<GlobalFilters>({
    ...EMPTY_GLOBAL_FILTERS,
    tagMode: "all", // Journal's default match mode is "all"
  });
  // YYYY-MM-DD selected from the calendar view; null = no date filter.
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("readings");
  const [openId, setOpenId] = useState<string | null>(null);
  // ED-2A — cache for an archived reading opened from the Archive view.
  // Active readings come from `readings`; archived rows are filtered out
  // of that list, so we lazily fetch them by id here.
  const [openOverride, setOpenOverride] = useState<ReadingRow | null>(null);

  // Q45 Fix 1 – preload deck image maps for every deck referenced
  // across all visible readings, so oracle cards render instantly.
  const allJournalDeckIds = useMemo(() => {
    const ids = new Set<string>();
    readings.forEach((r) => {
      if (r.deck_id) ids.add(r.deck_id);
      (r.card_deck_ids ?? []).forEach((id) => {
        if (id) ids.add(id);
      });
    });
    return Array.from(ids);
  }, [readings]);
  const { loading: journalMapsLoading } = useMultiDeckImage(allJournalDeckIds);

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
              "id,user_id,spread_type,card_ids,card_orientations,interpretation,created_at,guide_id,lens_id,moon_phase,note,is_favorite,tags,is_deep_reading,deep_reading_lenses,mirror_saved,pattern_id,question,import_batch_id,deck_id,card_deck_ids,tailored_prompt,journal_prompt_used",
            )
            .eq("user_id", user.id)
            .is("archived_at", null)
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
            .is("archived_at", null)
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
          .select("id,name,lifecycle_state,description")
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
      if (batchParam && r.import_batch_id !== batchParam) return false;
      if (journalFilters.tags.length > 0) {
        const rt = r.tags ?? [];
        if (journalFilters.tagMode === "all") {
          if (!journalFilters.tags.every((t) => rt.includes(t))) return false;
        } else {
          if (!journalFilters.tags.some((t) => rt.includes(t))) return false;
        }
      }
      if (journalFilters.spreadTypes.length > 0) {
        if (!journalFilters.spreadTypes.includes(r.spread_type as DrawTypeKey))
          return false;
      }
      if (journalFilters.deepOnly && !r.is_deep_reading) return false;
      if (journalFilters.bookmarked && !r.mirror_saved) return false;
      // DN-5 — Stories filter: keep only readings attached to one of
      // the currently-active patterns.
      if (journalFilters.storyIds.length > 0) {
        if (!r.pattern_id || !journalFilters.storyIds.includes(r.pattern_id))
          return false;
      }
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
  }, [
    readings,
    search,
    journalFilters,
    activeDate,
    batchParam,
  ]);

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
  // DN-5 — Stories the user can filter by: every pattern referenced
  // by at least one reading they currently see. We rely on the
  // patterns map already loaded for ThreadsView so no extra query.
  // DO-1 — Stories sorted by recency (most-recent reading.created_at)
  // so the default top-5 chips reflect what the seeker is currently
  // working with, not arbitrary alphabetical order.
  const allStories = useMemo(() => {
    const map = new Map<
      string,
      { id: string; name: string; lastActiveAt: string }
    >();
    for (const r of readings) {
      if (!r.pattern_id) continue;
      const p = patternsById[r.pattern_id];
      if (!p) continue;
      const existing = map.get(r.pattern_id);
      if (!existing || r.created_at > existing.lastActiveAt) {
        map.set(r.pattern_id, {
          id: r.pattern_id,
          name: p.name,
          lastActiveAt: r.created_at,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      b.lastActiveAt.localeCompare(a.lastActiveAt),
    );
  }, [readings, patternsById]);
  const openReading = openId
    ? readings.find((r) => r.id === openId) ??
      (openOverride && openOverride.id === openId ? openOverride : null)
    : null;

  // ED-2A — when an Archive row is tapped, the reading isn't in
  // `readings` (it's filtered out by `archived_at IS NULL`). Fetch it
  // on demand so ReadingDetail can render in read-only mode.
  useEffect(() => {
    if (!openId || !user) return;
    if (readings.find((r) => r.id === openId)) return;
    if (openOverride && openOverride.id === openId) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("readings")
        .select(
          "id,user_id,spread_type,card_ids,card_orientations,interpretation,created_at,guide_id,lens_id,moon_phase,note,is_favorite,tags,is_deep_reading,deep_reading_lenses,mirror_saved,pattern_id,question,import_batch_id,deck_id,card_deck_ids,archived_at,tailored_prompt,journal_prompt_used",
        )
        .eq("id", openId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!cancelled && data) setOpenOverride(data as ReadingRow);
    })();
    return () => {
      cancelled = true;
    };
  }, [openId, user, readings, openOverride]);

  // Stable callbacks for the EnrichmentPanel — keep the Journal list and
  // tag library in sync with edits made inside the Reading Detail overlay
  // without re-fetching from the server.
  const handleReadingChange = useCallback(
    (next: {
      id: string;
      note: string | null;
      is_favorite: boolean;
      tags: string[] | null;
      journal_prompt_used?: boolean;
    }) => {
      setReadings((prev) =>
        prev.map((r) =>
          r.id === next.id
            ? {
                ...r,
                note: next.note,
                is_favorite: next.is_favorite,
                tags: next.tags,
                ...(next.journal_prompt_used !== undefined
                  ? { journal_prompt_used: next.journal_prompt_used }
                  : {}),
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

  // DB-3.2 — Patch a reading's deck_id locally after the override picker
  // updates the row in the database. Keeps the journal list & detail view
  // in sync without a refetch.
  const handleReadingDeckChange = useCallback(
    (id: string, deckId: string | null) => {
      setReadings((prev) =>
        prev.map((r) => (r.id === id ? { ...r, deck_id: deckId } : r)),
      );
    },
    [],
  );

  // DA — Load metadata for the optional ?batch=... filter banner.
  useEffect(() => {
    if (!batchParam || !user) {
      setBatchMeta(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("import_batches")
        .select("source_format, created_at")
        .eq("id", batchParam)
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        setBatchMeta({
          sourceFormat: (data as { source_format: string }).source_format,
          createdAt: (data as { created_at: string }).created_at,
        });
      } else {
        setBatchMeta(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [batchParam, user]);
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

  return (
    <div className="bg-cosmos relative flex h-dvh flex-col">
      {/* Sticky header — title, search, filter button, tab row.
          Sits OUTSIDE <main> so its glass blends with the route bg
          rather than scrolling content (FU-11). */}
      <div
        className="page-header-glass sticky top-0"
        style={{
          zIndex: "var(--z-sticky-header)",
          paddingTop: "env(safe-area-inset-top, 0px)",
        }}
      >
        <div className="px-5">
        <div
          className="overflow-hidden flex items-center"
          style={{
            paddingTop: `${collapseProgress * 6}px`,
            paddingBottom: `${collapseProgress * 6}px`,
            maxHeight: `${collapseProgress * 32}px`,
            transition: "max-height 150ms ease-out, padding 150ms ease-out",
          }}
        >
          <h1
            className="font-serif italic"
            style={{
              fontSize: "var(--text-heading-sm)",
              color: "var(--color-foreground)",
              opacity: 0.9 * collapseProgress,
              transition: "opacity 150ms ease-out",
              margin: 0,
              lineHeight: 1,
            }}
          >
            Journal
          </h1>
        </div>
        {statsLine ? (
          <p
            className="font-serif italic"
            style={{
              fontSize: "var(--text-caption, 0.72rem)",
              color: "var(--color-foreground)",
              opacity: 0.55,
              margin: "4px 0 0 0",
            }}
          >
            {statsLine}
          </p>
        ) : null}

      {/* Search */}
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder={isOracle ? "Search your practice…" : "Search readings…"}
        className="mt-2"
      />

      {/* FU-3 — Unified filter pattern via GlobalFilterBar. */}
      <GlobalFilterBar
        filters={journalFilters}
        onChange={setJournalFilters}
        sections={["tags", "spreadTypes", "depth", "stories"]}
        userTags={topTags}
        allStories={allStories}
        trailingChips={
          activeDate ? (
            <button
              type="button"
              onClick={() => setActiveDate(null)}
              className="inline-flex items-center gap-1 font-display text-[11px] italic text-muted-foreground"
              style={{ opacity: "var(--ro-plus-20)" }}
            >
              <XIcon size={11} strokeWidth={1.5} />
              {formatDateShort(new Date(activeDate + "T12:00:00").toISOString())}
            </button>
          ) : null
        }
      />

      {/* View tabs — icons only on mobile (< sm), label-only at sm+.
          BO Fix 1 — wrapped in HorizontalScroll so the row gets edge
          fades + chevron affordance when the six tabs overflow. */}
      <HorizontalScroll className="mt-2" contentClassName="items-center gap-5">
        {(
          [
            ["readings", "Readings", BookOpen],
            ["gallery", "Gallery", ImageIcon],
            ["notes", "Notes", StickyNote],
            ["favorites", "Favorites", Heart],
            ["calendar", "Calendar", CalendarDays],
            ["threads", "Stories", Network],
            ["archive", "Archive", ArchiveIcon],
          ] as const
        ).map(([key, label, Icon]) => {
          const active = view === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              aria-label={label}
              className="shrink-0 font-display text-[13px] italic text-gold transition-opacity"
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
      </HorizontalScroll>
        <div className="h-3" />
        </div>
      </div>
      <main ref={scrollRef} className="flex-1 overflow-y-auto px-5 pb-28">

      {/* FU-8 — Large title at top of content (iOS large-to-compact pattern) */}
      <h1
        className="font-serif italic mt-4 mb-2"
        style={{
          fontSize: "var(--text-display, 32px)",
          color: "var(--color-foreground)",
          opacity: 0.9,
          lineHeight: 1.25,
        }}
      >
        Journal
      </h1>

      {/* Body */}
      <div className="mt-4">
        {batchParam && (
          <div
            className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-2"
            style={{
              border:
                "1px solid color-mix(in oklab, var(--gold) 25%, transparent)",
              background:
                "color-mix(in oklab, var(--gold) 6%, transparent)",
            }}
          >
            <span
              className="font-display text-[12px] italic text-foreground"
              style={{ opacity: "var(--ro-plus-30)" }}
            >
              {batchMeta
                ? `Showing ${filtered.length.toLocaleString()} reading${
                    filtered.length === 1 ? "" : "s"
                  } imported from ${batchMeta.sourceFormat} on ${formatDateLong(batchMeta.createdAt)}`
                : "No readings found for this import."}
            </span>
            <button
              type="button"
              onClick={() =>
                void navigate({ to: "/journal", search: { batch: undefined } })
              }
              className="font-display text-[12px] italic text-gold transition-opacity hover:opacity-80"
            >
              Show all readings →
            </button>
          </div>
        )}
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
            patternsById={patternsById}
            onOpen={setOpenId}
            mapsLoading={journalMapsLoading}
            onArchive={(id) => {
              setReadings((prev) => prev.filter((r) => r.id !== id));
              setArchiveCounter((c) => c + 1);
            }}
            emptyCta={{
              label: "Begin a reading",
              onClick: () => navigate({ to: "/" }),
            }}
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
            patternsById={patternsById}
            onOpen={setOpenId}
            mapsLoading={journalMapsLoading}
            onArchive={(id) => {
              setReadings((prev) => prev.filter((r) => r.id !== id));
              setArchiveCounter((c) => c + 1);
            }}
          />
        ) : view === "calendar" ? (
          <CalendarView
            readings={readings}
            activeTags={journalFilters.tags}
            tagMode={journalFilters.tagMode}
            activeDrawTypes={journalFilters.spreadTypes as DrawTypeKey[]}
            activeDate={activeDate}
            onSelectDate={(d) => {
              setActiveDate((cur) => (cur === d ? null : d));
              setView("readings");
            }}
          />
        ) : view === "archive" ? (
          <ArchiveView
            key={`archive-${archiveCounter}`}
            onOpen={(id) => setOpenId(id)}
            onChanged={() => {
              // Restore puts a reading back in the active list — pull
              // a fresh copy so it shows up everywhere.
              if (!user) return;
              void (async () => {
                const { data: rows } = await supabase
                  .from("readings")
                  .select(
                    "id,user_id,spread_type,card_ids,card_orientations,interpretation,created_at,guide_id,lens_id,moon_phase,note,is_favorite,tags,is_deep_reading,deep_reading_lenses,mirror_saved,pattern_id,question,import_batch_id,deck_id,card_deck_ids,tailored_prompt,journal_prompt_used",
                  )
                  .eq("user_id", user.id)
                  .is("archived_at", null)
                  .order("created_at", { ascending: false })
                  .limit(500);
                setReadings((rows ?? []) as ReadingRow[]);
              })();
            }}
          />
        ) : (
          <ThreadsView
            threads={threads}
            patternsById={patternsById}
            readings={filtered}
            onOpenReading={(id) => setOpenId(id)}
          />
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
          onDeckChange={handleReadingDeckChange}
          onArchived={(id) => {
            setReadings((prev) => prev.filter((r) => r.id !== id));
            setOpenId(null);
          }}
          onRestored={() => {
            // ED-2B — refetch active readings so the restored row
            // shows back up in Readings/Favorites/etc.
            if (!user) return;
            void (async () => {
              const { data: rows } = await supabase
                .from("readings")
                .select(
                  "id,user_id,spread_type,card_ids,card_orientations,interpretation,created_at,guide_id,lens_id,moon_phase,note,is_favorite,tags,is_deep_reading,deep_reading_lenses,mirror_saved,pattern_id,question,import_batch_id,deck_id,card_deck_ids,tailored_prompt,journal_prompt_used",
                )
                .eq("user_id", user.id)
                .is("archived_at", null)
                .order("created_at", { ascending: false })
                .limit(500);
              setReadings((rows ?? []) as ReadingRow[]);
            })();
            setOpenOverride(null);
            setOpenId(null);
          }}
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
  photoCounts,
  patternsById,
  onOpen,
  emptyOracle,
  emptyPlain,
  emptyCta,
  onArchive,
  mapsLoading,
}: {
  items: ReadingRow[];
  isOracle: boolean;
  photoCounts: Record<string, number>;
  patternsById: Record<string, PatternRow>;
  onOpen: (id: string) => void;
  emptyOracle?: string;
  emptyPlain?: string;
  emptyCta?: { label: string; onClick: () => void };
  onArchive?: (id: string) => void;
  mapsLoading?: boolean;
}) {
  if (items.length === 0) {
    return (
      <Empty
        oracle={emptyOracle ?? "Your practice awaits its first telling…"}
        plain={emptyPlain ?? "No readings yet. Complete a reading to begin."}
        isOracle={isOracle}
        cta={emptyCta}
      />
    );
  }
  return (
    <ul className="flex flex-col gap-5">
      {items.map((r) => (
        <li key={r.id}>
          <ReadingCard
            reading={r}
            onOpen={onOpen}
            patternsById={patternsById}
            onArchive={onArchive}
            hasPhoto={(photoCounts[r.id] ?? 0) > 0}
            mapsLoading={mapsLoading}
          />
        </li>
      ))}
    </ul>
  );
}

function ReadingCard({
  reading,
  onOpen,
  patternsById,
  onArchive,
  hasPhoto,
  mapsLoading,
}: {
  reading: ReadingRow;
  onOpen: (id: string) => void;
  patternsById: Record<string, PatternRow>;
  onArchive?: (id: string) => void;
  hasPhoto?: boolean;
  mapsLoading?: boolean;
}) {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const visible = reading.card_ids.slice(0, 5);
  const overflow = reading.card_ids.length - visible.length;
  const hasNote = (reading.note ?? "").trim().length > 0;
  const hasQuestion = (reading.question ?? "").trim().length > 0;
  const hasTags = (reading.tags ?? []).length > 0;
  // Q16 Fix 3 — strip the legacy "{spread} — Moonseed reading" prefix
  // from older readings before rendering the row excerpt.
  const interpFirst = stripLegacyMoonseedPrefix(reading.interpretation ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const interpClean = stripMarkdown(interpFirst);
  // EW-4 — Card thumbnails now render through <CardImage deckId> which
  // resolves the per-reading deck art and corner radius internally, so
  // the row no longer needs its own deck hooks.
  const archiveFn = useServerFn(archiveReading);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [swipeX, setSwipeX] = useState(0);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const REVEAL_PX = 44;
  const onTouchStart = (e: React.TouchEvent) => {
    if (!isMobile || !onArchive) return;
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!touchStart.current) return;
    const t = e.touches[0];
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;
    if (Math.abs(dy) > Math.abs(dx)) return; // vertical scroll wins
    const next = Math.max(-REVEAL_PX, Math.min(0, dx));
    setSwipeX(next);
  };
  const onTouchEnd = () => {
    touchStart.current = null;
    if (swipeX <= -REVEAL_PX * 0.6) {
      setSwipeX(-REVEAL_PX);
    } else {
      setSwipeX(0);
    }
  };
  const doArchive = async () => {
    if (archiving || !onArchive) return;
    setArchiving(true);
    const headers = await getAuthHeaders();
    const res = await archiveFn({ data: { readingId: reading.id }, headers });
    setArchiving(false);
    setConfirmOpen(false);
    setSwipeX(0);
    if (!res.ok) {
      toast.error("Couldn't archive reading.");
      return;
    }
    toast.success("Reading archived. Restore from Archive within 30 days.");
    onArchive(reading.id);
  };

  return (
    <div
      className="group/reading relative overflow-hidden rounded-2xl"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {onArchive && (
        <button
          type="button"
          aria-label="Archive reading"
          onClick={(e) => {
            e.stopPropagation();
            setConfirmOpen(true);
          }}
          className={cn(
            "absolute inset-y-0 right-0 z-10 flex items-center justify-center px-4 text-gold transition-opacity",
            // EA-5 — never capture clicks unless actually revealed.
            isMobile
              ? swipeX <= -REVEAL_PX * 0.6
                ? "opacity-100"
                : "opacity-0 pointer-events-none"
              : "opacity-0 pointer-events-none group-hover/reading:opacity-100 group-hover/reading:pointer-events-auto focus:opacity-100 focus:pointer-events-auto",
          )}
          style={{
            width: REVEAL_PX,
            background:
              "color-mix(in oklab, var(--gold) 14%, transparent)",
          }}
          tabIndex={isMobile ? -1 : 0}
        >
          <ArchiveIcon size={18} strokeWidth={1.5} />
        </button>
      )}
      <button
      type="button"
      onClick={() => onOpen(reading.id)}
      className="relative z-0 block w-full rounded-2xl px-4 py-4 text-left transition-[transform,background-color] hover:bg-foreground/[0.04]"
      style={{
        border: "1px solid color-mix(in oklab, var(--gold) 8%, transparent)",
        background: "color-mix(in oklab, var(--surface-overlay) 30%, transparent)",
        transform: `translateX(${swipeX}px)`,
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
              {formatTimeAgo(reading.created_at)}
            </span>
          </div>
        </div>
        {/* Q13 Fix 3 — unified right-edge icon row. */}
        <div className="flex items-center gap-2 shrink-0">
          {hasQuestion && (
            <MessageCircle size={16} strokeWidth={1.5} fill="currentColor"
              style={{ color: "var(--accent)", opacity: 0.7 }} aria-label="Has question">
              <title>Has question</title>
            </MessageCircle>
          )}
          {hasNote && (
            <StickyNote size={16} strokeWidth={1.5} fill="currentColor"
              style={{ color: "var(--accent)", opacity: 0.7 }} aria-label="Has note">
              <title>Has note</title>
            </StickyNote>
          )}
          {reading.is_favorite && (
            <Heart size={16} strokeWidth={1.5} fill="currentColor"
              style={{ color: "var(--accent)", opacity: 0.8 }} aria-label="Favorite">
              <title>Favorite</title>
            </Heart>
          )}
          {reading.mirror_saved && (
            <Bookmark size={16} strokeWidth={1.5} fill="currentColor"
              style={{ color: "var(--accent)", opacity: 0.8 }} aria-label="Bookmarked">
              <title>Bookmarked</title>
            </Bookmark>
          )}
          {reading.is_deep_reading && (
            <Star size={16} strokeWidth={1.5} fill="currentColor"
              style={{ color: "var(--accent)", opacity: 0.8 }} aria-label="Deep reading">
              <title>Deep reading</title>
            </Star>
          )}
          {reading.interpretation && reading.interpretation.trim() !== "" && (
            <Sparkles size={16} strokeWidth={1.5} fill="currentColor"
              style={{ color: "var(--accent)", opacity: 0.7 }} aria-label="AI interpreted">
              <title>AI interpreted</title>
            </Sparkles>
          )}
          {hasTags && (
            <TagIcon size={16} strokeWidth={1.5} fill="currentColor"
              style={{ color: "var(--accent)", opacity: 0.7 }} aria-label="Has tags">
              <title>Has tags</title>
            </TagIcon>
          )}
          {hasPhoto && (
            <Camera size={16} strokeWidth={1.5} fill="currentColor"
              style={{ color: "var(--accent)", opacity: 0.7 }} aria-label="Has photo">
              <title>Has photo</title>
            </Camera>
          )}
          {reading.pattern_id && patternsById[reading.pattern_id] && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                navigate({ to: "/stories", search: { focus: reading.pattern_id! } });
              }}
              aria-label="In Story"
              title={`View Story: ${patternsById[reading.pattern_id].name}`}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--accent)", opacity: 0.85 }}
            >
              <Ghost size={16} strokeWidth={1.5} fill="currentColor" className="animate-glow-breathe" />
            </button>
          )}
        </div>
      </div>

      {/* Card thumbnails */}
      {isMobile ? (
        // DA — Mobile: full swipeable strip with all cards.
        <div
          className="journal-thumb-strip mt-3 flex items-center gap-1.5 overflow-x-auto pb-1"
          style={{
            scrollbarWidth: "none",
            WebkitOverflowScrolling: "touch",
            maskImage:
              reading.card_ids.length > 4
                ? "linear-gradient(to right, black 90%, transparent 100%)"
                : undefined,
            WebkitMaskImage:
              reading.card_ids.length > 4
                ? "linear-gradient(to right, black 90%, transparent 100%)"
                : undefined,
          }}
        >
          {reading.card_ids.map((id, idx) => {
            const isReversed = !!reading.card_orientations?.[idx];
            const perCardDeckId =
              (reading.card_deck_ids?.[idx] ?? reading.deck_id) ?? null;
            return (
              <CardImage
                key={`${id}-${idx}`}
                cardId={id}
                variant="face"
                reversed={isReversed}
                size="thumbnail"
                deckId={perCardDeckId}
                loading={!!mapsLoading && perCardDeckId != null}
                className="flex-shrink-0"
                style={{ opacity: "var(--ro-plus-30)" }}
              />
            );
          })}
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-1.5">
          {visible.map((id) => {
            const idx = reading.card_ids.indexOf(id);
            const isReversed =
              idx >= 0 ? !!reading.card_orientations?.[idx] : false;
            const perCardDeckId =
              (reading.card_deck_ids?.[idx] ?? reading.deck_id) ?? null;
            return (
              <CardImage
                key={id}
                cardId={id}
                variant="face"
                reversed={isReversed}
                size="thumbnail"
                deckId={perCardDeckId}
                loading={!!mapsLoading && perCardDeckId != null}
                style={{ opacity: "var(--ro-plus-30)" }}
              />
            );
          })}
          {overflow > 0 && (
            <span
              className="ml-1 font-display text-[11px] italic text-muted-foreground"
              style={{ opacity: "var(--ro-plus-20)" }}
            >
              +{overflow} more
            </span>
          )}
        </div>
      )}

      {/* Interpretation excerpt */}
      {hasQuestion && (
        <p
          className="mt-3 font-display text-[15px] italic leading-snug text-foreground"
          style={{
            color: "var(--gold)",
            opacity: "var(--ro-plus-10)",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          “{reading.question!.trim()}”
        </p>
      )}
      {interpClean && !hasQuestion && (
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
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this reading?</AlertDialogTitle>
            <AlertDialogDescription>
              It moves to the Archive tab. Restore within 30 days, or it is
              permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archiving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void doArchive();
              }}
              disabled={archiving}
            >
              {archiving ? "Archiving…" : "Archive"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
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
        return (
          <GalleryTile
            key={r.id}
            reading={r}
            photoUrl={photoUrl}
            onOpen={onOpen}
          />
        );
      })}
    </div>
  );
}

/**
 * DB-3.1 — Gallery tile extracted so `useDeckImage` can resolve the
 * fallback card image from THIS reading's saved deck (not the global
 * active deck) without violating Rules of Hooks.
 */
function GalleryTile({
  reading,
  photoUrl,
  onOpen,
}: {
  reading: ReadingRow;
  photoUrl: string | undefined;
  onOpen: (id: string) => void;
}) {
  const getImage = useDeckImage(reading.deck_id ?? null);
  const fallback = getImage(reading.card_ids[0] ?? 0, "thumbnail");
  const deckRadiusPx = useDeckCornerRadius(reading.deck_id ?? null);
  const { ref: tileRef, width: tileW } = useElementWidth<HTMLButtonElement>();
  return (
    <button
      ref={tileRef}
      type="button"
      onClick={() => onOpen(reading.id)}
      className="relative aspect-square overflow-hidden rounded-md"
      style={{
        border:
          "1px solid color-mix(in oklab, var(--gold) 12%, transparent)",
      }}
    >
      <CardThumb
        src={photoUrl ?? fallback}
        alt=""
        loading="lazy"
        className="h-full w-full object-cover"
        style={
          photoUrl
            ? undefined
            : { opacity: "var(--ro-plus-30)" }
        }
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
        <span>{spreadLabel(reading.spread_type)}</span>
        <span>{formatTimeAgo(reading.created_at)}</span>
      </div>
    </button>
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
            className="block w-full rounded-xl px-4 py-3 text-left transition-colors hover:bg-foreground/[0.04]"
          >
            <div className="flex items-baseline gap-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              <span style={{ opacity: "var(--ro-plus-20)" }}>
                {formatTimeAgo(r.created_at)}
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
  cta,
}: {
  oracle: string;
  plain: string;
  isOracle: boolean;
  cta?: { label: string; onClick: () => void };
}) {
  return <EmptyHero title={isOracle ? oracle : plain} cta={cta} />;
}

/* ---------- Threads view (Phase 7) ---------- */

function ThreadsView({
  threads,
  patternsById,
  readings,
  onOpenReading,
}: {
  threads: ThreadRow[];
  patternsById: Record<string, PatternRow>;
  readings: ReadingRow[];
  onOpenReading: (id: string) => void;
}) {
  const [lifecycleFilter, setLifecycleFilter] = useState<string>("all");

  // Build pattern -> readings map.
  const readingsByPattern = new Map<string, ReadingRow[]>();
  const unlinkedReadings: ReadingRow[] = [];
  for (const r of readings) {
    if (r.pattern_id && patternsById[r.pattern_id]) {
      const arr = readingsByPattern.get(r.pattern_id) ?? [];
      arr.push(r);
      readingsByPattern.set(r.pattern_id, arr);
    } else {
      unlinkedReadings.push(r);
    }
  }

  // Lifecycle counts across all known patterns (not just those with readings).
  const lifecycleCounts: Record<string, number> = {};
  for (const p of Object.values(patternsById)) {
    lifecycleCounts[p.lifecycle_state] =
      (lifecycleCounts[p.lifecycle_state] ?? 0) + 1;
  }
  const lifecycleOrder = [
    "emerging",
    "active",
    "reawakened",
    "quieting",
    "retired",
  ];
  const lifecycleEntries = lifecycleOrder
    .filter((s) => (lifecycleCounts[s] ?? 0) > 0)
    .map((s) => [s, lifecycleCounts[s]] as const);

  if (threads.length === 0 && Object.keys(patternsById).length === 0) {
    return (
      <EmptyHero
        title="The stories are listening."
        subtitle="This space fills slowly, and that is by design. Stories are not tags or summaries — they are deeper patterns that emerge only when the same symbolic current has moved through your practice more than once. The cards know. When something is truly recurring, it will surface here on its own."
      />
    );
  }
  // Group threads by pattern_id so patterns surface even when their only
  // signal is a thread (ungrouped threads stay silent in the DB and never
  // render their own UI item — Phase 9 reset).
  const grouped = new Map<string, ThreadRow[]>();
  for (const t of threads) {
    if (t.pattern_id && patternsById[t.pattern_id]) {
      const arr = grouped.get(t.pattern_id) ?? [];
      arr.push(t);
      grouped.set(t.pattern_id, arr);
    }
  }
  // Order patterns: those with readings or threads first, by lifecycle weight then name.
  const lifecycleWeight: Record<string, number> = {
    active: 0,
    reawakened: 1,
    emerging: 2,
    quieting: 3,
    retired: 4,
  };
  const allPatternIds = new Set<string>([
    ...readingsByPattern.keys(),
    ...grouped.keys(),
  ]);
  const orderedPatternIds = Array.from(allPatternIds).sort((a, b) => {
    const pa = patternsById[a];
    const pb = patternsById[b];
    const wa = lifecycleWeight[pa.lifecycle_state] ?? 9;
    const wb = lifecycleWeight[pb.lifecycle_state] ?? 9;
    if (wa !== wb) return wa - wb;
    return pa.name.localeCompare(pb.name);
  });

  const filteredPatternIds =
    lifecycleFilter === "all"
      ? orderedPatternIds
      : orderedPatternIds.filter(
          (pid) => patternsById[pid]?.lifecycle_state === lifecycleFilter,
        );
  const filterOptions: Array<{ value: string; label: string }> = [
    { value: "all", label: "All" },
    { value: "emerging", label: "Emerging" },
    { value: "active", label: "Active" },
    { value: "reawakened", label: "Reawakened" },
    { value: "quieting", label: "Quieting" },
    { value: "retired", label: "Retired" },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div
        className="flex flex-wrap gap-1.5"
        role="tablist"
        aria-label="Filter threads by lifecycle"
      >
        {filterOptions.map((opt) => {
          const active = lifecycleFilter === opt.value;
          const disabled =
            opt.value !== "all" && (lifecycleCounts[opt.value] ?? 0) === 0;
          return (
            <button
              key={opt.value}
              type="button"
              role="tab"
              aria-selected={active}
              disabled={disabled}
              onClick={() => setLifecycleFilter(opt.value)}
              className={cn(
                "rounded-full border px-3 py-1 font-display text-[11px] uppercase tracking-[0.2em] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-gold/40",
                active
                  ? "border-gold/60 bg-gold/10 text-gold"
                  : "border-border/60 text-muted-foreground hover:text-gold",
                disabled && "opacity-30 cursor-not-allowed",
              )}
            >
              {opt.label}
              {opt.value !== "all" && lifecycleCounts[opt.value]
                ? ` · ${lifecycleCounts[opt.value]}`
                : ""}
            </button>
          );
        })}
      </div>
      {lifecycleEntries.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {lifecycleEntries.map(([state, count]) => {
            const op =
              state === "active"
                ? 1
                : state === "reawakened"
                  ? 0.85
                  : state === "emerging"
                    ? 0.6
                    : state === "quieting"
                      ? 0.4
                      : 0.25;
            return (
              <span
                key={state}
                className="rounded-full border border-gold/30 px-3 py-1 font-display text-[11px] uppercase tracking-[0.2em] text-gold"
                style={{ opacity: op }}
              >
                {state} · {count}
              </span>
            );
          })}
        </div>
      )}
      {filteredPatternIds.length === 0 && (
        <EmptyNote text="No stories in this lifecycle stage yet." />
      )}
      {filteredPatternIds.map((pid) => {
        const p = patternsById[pid];
        const patternReadings = readingsByPattern.get(pid) ?? [];
        return (
          <Link
            key={pid}
            to="/stories/$patternId"
            params={{ patternId: pid }}
            style={{
              display: "block",
              padding: "var(--space-4, 16px)",
              borderRadius: "var(--radius-lg, 14px)",
              background: "var(--surface-card, rgba(255,255,255,0.03))",
              border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
              textDecoration: "none",
              color: "inherit",
              cursor: "pointer",
              touchAction: "manipulation",
              WebkitTapHighlightColor: "transparent",
              userSelect: "none",
            }}
          >
            <section className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between gap-3">
                <h3
                  className="m-0 font-display italic"
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontSize: "var(--text-heading-sm, 17px)",
                    color: "var(--color-foreground)",
                  }}
                >
                  {p.name}
                </h3>
                <span
                  className="font-display text-[10px] uppercase tracking-[0.2em]"
                  style={{
                    color: "var(--accent, var(--gold))",
                    opacity: 0.6,
                    whiteSpace: "nowrap",
                  }}
                >
                  {p.lifecycle_state} · {patternReadings.length}{" "}
                  {patternReadings.length === 1 ? "reading" : "readings"}
                </span>
              </div>
            {p.description && p.description.trim() && (
              <p
                className="m-0 font-display whitespace-pre-wrap"
                style={{
                  fontFamily: "var(--font-serif)",
                  fontSize: "var(--text-body-sm)",
                  lineHeight: 1.6,
                  color: "var(--color-foreground)",
                  opacity: 0.8,
                }}
              >
                {p.description}
              </p>
            )}
            {patternReadings.length > 0 && (
              <ul className="flex flex-col gap-1.5">
                {patternReadings.slice(0, 6).map((r) => {
                  const hasQuestion = !!r.question?.trim();
                  const label = hasQuestion
                    ? `"${r.question!.trim()}"`
                    : firstCardName(r.card_ids);
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onOpenReading(r.id);
                        }}
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          justifyContent: "space-between",
                          gap: "var(--space-3, 12px)",
                          width: "100%",
                          padding: "var(--space-2, 8px) var(--space-3, 12px)",
                          background: "transparent",
                          border: "none",
                          borderRadius: "var(--radius-md, 10px)",
                          cursor: "pointer",
                          textAlign: "left",
                          touchAction: "manipulation",
                        }}
                      >
                        <span
                          style={{
                            fontFamily: "var(--font-serif)",
                            fontStyle: hasQuestion ? "italic" : "normal",
                            fontSize: "var(--text-body-sm)",
                            color: "var(--color-foreground)",
                            opacity: 0.85,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {label}
                        </span>
                        <span
                          style={{
                            fontSize: "var(--text-caption)",
                            textTransform: "uppercase",
                            letterSpacing: "0.15em",
                            color: "var(--color-foreground)",
                            opacity: 0.5,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {formatTimeAgo(r.created_at)}
                        </span>
                      </button>
                    </li>
                  );
                })}
                {patternReadings.length > 6 && (
                  <li
                    className="px-2 font-display text-[11px] italic text-muted-foreground"
                    style={{ opacity: "var(--ro-plus-20)" }}
                  >
                    + {patternReadings.length - 6} more
                  </li>
                )}
              </ul>
            )}
            </section>
          </Link>
        );
      })}
      {lifecycleFilter === "all" && unlinkedReadings.length > 0 && orderedPatternIds.length > 0 && (
        <p
          className="font-display text-[11px] italic text-muted-foreground"
          style={{ opacity: "var(--ro-plus-10)" }}
        >
          {unlinkedReadings.length} reading
          {unlinkedReadings.length === 1 ? "" : "s"} not yet woven into a
          pattern.
        </p>
      )}
    </div>
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
  const monthLabel = formatMonthYear(cursor.toISOString());
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
                selected
                  ? "bg-gold/15 text-gold"
                  : isToday
                    ? "bg-gold/10 text-gold"
                    : "text-foreground",
              )}
              style={{
                border: selected
                  ? "1px solid color-mix(in oklab, var(--gold) 50%, transparent)"
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
                    color: "var(--accent-foreground)",
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
  onDeckChange,
  onArchived,
  onRestored,
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
    journal_prompt_used?: boolean;
  }) => void;
  onTagLibraryChange: (next: EnrichmentTag[]) => void;
  onPhotoCountChange: (readingId: string, count: number) => void;
  onDeckChange: (id: string, deckId: string | null) => void;
  onArchived: (id: string) => void;
  onRestored?: () => void;
}) {
  const guide = getGuideById(reading.guide_id);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isPremium } = usePremium(user?.id);
  const positions = isValidSpreadMode(reading.spread_type)
    ? SPREAD_META[reading.spread_type as SpreadMode].positions
    : undefined;
  // Q7 Fix 2: deck-aware card-name resolver so oracle ids (>=1000)
  // show the seeker's custom name from custom_deck_cards.card_name
  // instead of "Card 1024". Uses the reading's saved deck_id for
  // historical accuracy; falls back to the active deck for legacy
  // rows without a deck_id.
  // Q44 Fix 3A — resolve card names per-card so mixed-deck readings
  // pick up each card's own deck override.
  const allDeckIds = useMemo(() => {
    const ids: (string | null | undefined)[] = [];
    if (reading.deck_id) ids.push(reading.deck_id);
    (reading.card_deck_ids ?? []).forEach((id) => {
      if (id) ids.push(id);
    });
    return ids;
  }, [reading.deck_id, reading.card_deck_ids]);
  const activeNameResolve = useActiveDeckCardName();
  const multiNameResolve = useMultiDeckCardName(allDeckIds);
  // Q44 Fix 6 — preload all referenced deck image maps in parallel
  // so oracle/custom cards appear instantly instead of after a roundtrip.
  const { loading: _detailMapsLoading } = useMultiDeckImage(allDeckIds);
  void _detailMapsLoading;
  const resolveCardName = (id: number, idx: number) => {
    const deckId = reading.card_deck_ids?.[idx] ?? reading.deck_id ?? null;
    if (deckId) return multiNameResolve(id, deckId);
    return activeNameResolve(id);
  };
  // CZ Group 4 — mobile gets a horizontally swipeable card strip when a
  // reading has more cards than fit comfortably (>3). Desktop unchanged.
  const isMobile = useIsMobile();
  const swipeMobile = isMobile && reading.card_ids.length > 3;
  const [shareOpen, setShareOpen] = useState(false);
  // DD-4 — tap-to-zoom on saved-reading cards. Reuses the same modal
  // the active draw uses (CZ Group 3) so behavior matches everywhere.
  const [zoomedCard, setZoomedCard] = useState<{ cardId: number; reversed: boolean; idx: number } | null>(null);
  // EZ-5 / FA-2 — Cards in journal reading-detail size to a 3-card-spread
  // baseline. A single-card reading renders at the same physical
  // width as one of three cards (centered, prominent — not full-row).
  // Larger spreads scale down so all cards fit.
  const cardRowRef = useRef<HTMLDivElement | null>(null);
  const [measuredRowWidth, setMeasuredRowWidth] = useState<number>(320);
  useEffect(() => {
    const node = cardRowRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const w = Math.round(entry.contentRect.width);
      if (w > 0) setMeasuredRowWidth(w);
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, []);
  const ezCardCount = reading.card_ids.length;
  const ezGapPx = 8;
  // Q44 Fix 5 — split into 2 rows on desktop when more than 5 cards.
  const useTwoRows = !isMobile && ezCardCount > 5;
  const cardsPerRow = useTwoRows ? Math.ceil(ezCardCount / 2) : ezCardCount;
  const row1Ids = useTwoRows
    ? reading.card_ids.slice(0, cardsPerRow)
    : reading.card_ids;
  const row2Ids = useTwoRows ? reading.card_ids.slice(cardsPerRow) : [];
  // FB-3 — single-card readings get a larger card. Divisor 1.5 makes
  // the card ~2/3 of row width — about 2× the per-card width of a
  // 3-card spread. Multi-card spreads keep proportional sizing.
  const ezBaseDivisor = ezCardCount === 1 ? 1.5 : cardsPerRow;
  // FA-2 — use measured row width instead of hardcoded 320 so
  // single cards actually fill the available space.
  const ezCardWidthRaw = Math.max(
    32,
    Math.floor(
      (measuredRowWidth - ezGapPx * (ezBaseDivisor - 1)) / ezBaseDivisor,
    ),
  );
  // Q44 Fix 4 — cap desktop single-card width so it does not
  // dominate the entire screen. Mobile keeps responsive sizing.
  const ezMaxCardWidth = !isMobile && ezCardCount === 1 ? 380 : 9999;
  const ezCardWidthPx = Math.min(ezCardWidthRaw, ezMaxCardWidth);
  // DB-3.2 — deck override picker.
  const [decks, setDecks] = useState<CustomDeck[]>([]);
  const [deckMenuOpen, setDeckMenuOpen] = useState(false);
  const [deckSaving, setDeckSaving] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await fetchUserDecks(reading.user_id);
        if (!cancelled) setDecks(rows);
      } catch {
        /* non-fatal */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reading.user_id]);
  const currentDeckName = reading.deck_id
    ? decks.find((d) => d.id === reading.deck_id)?.name ?? "Custom deck"
    : "Default";
  const handleSelectDeck = async (newDeckId: string | null) => {
    if (deckSaving) return;
    setDeckSaving(true);
    const { error } = await supabase
      .from("readings")
      .update({ deck_id: newDeckId })
      .eq("id", reading.id)
      .eq("user_id", reading.user_id);
    setDeckSaving(false);
    setDeckMenuOpen(false);
    if (error) {
      toast.error("Couldn't update deck.");
      return;
    }
    onDeckChange(reading.id, newDeckId);
    toast.success("Deck updated");
  };
  const archiveFn = useServerFn(archiveReading);
  const restoreFn = useServerFn(restoreReading);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  // ED-2B — read-only mode when this reading is in the Archive.
  const isArchived = reading.archived_at != null;
  const archivedDays = reading.archived_at
    ? daysUntilPurge(reading.archived_at)
    : 0;
  const [restoring, setRestoring] = useState(false);
  const handleRestore = async () => {
    if (restoring) return;
    setRestoring(true);
    const headers = await getAuthHeaders();
    const res = await restoreFn({ data: { readingId: reading.id }, headers });
    setRestoring(false);
    if (!res.ok) {
      toast.error("Couldn't restore reading.");
      return;
    }
    toast.success("Reading restored.");
    onRestored?.();
    onClose();
  };
  const handleArchive = async () => {
    if (archiving) return;
    setArchiving(true);
    const headers = await getAuthHeaders();
    const res = await archiveFn({ data: { readingId: reading.id }, headers });
    setArchiving(false);
    setArchiveConfirmOpen(false);
    if (!res.ok) {
      toast.error("Couldn't archive reading.");
      return;
    }
    toast.success("Reading archived. Restore from the Archive tab within 30 days.");
    onArchived(reading.id);
  };
  const spreadModeForShare: SpreadMode = isValidSpreadMode(reading.spread_type)
    ? (reading.spread_type as SpreadMode)
    : "single";
  const sharePicks = reading.card_ids.map((id, idx) => ({
    id: idx,
    cardIndex: id,
    isReversed: reading.card_orientations?.[idx] ?? false,
  }));
  const sharePositions =
    positions ?? reading.card_ids.map((id, idx) => resolveCardName(id, idx));

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
    <FullScreenSheet open onClose={onClose} entry="fade" showCloseButton={false}>
      <div className="mx-auto max-w-2xl px-5 pb-24 pt-[calc(env(safe-area-inset-top,0px)+56px)]">
        {isArchived && (
          <div
            role="status"
            className="mb-4 flex items-center justify-between gap-3 rounded-xl px-3 py-2"
            style={{
              border:
                "1px solid color-mix(in oklab, var(--gold) 22%, transparent)",
              background:
                "color-mix(in oklab, var(--gold) 8%, transparent)",
            }}
          >
            <div
              className="font-display text-[12px] italic"
              style={{ color: "var(--gold)", opacity: 0.9 }}
            >
              Archived — restore to edit. Permanently deletes in {archivedDays}{" "}
              {archivedDays === 1 ? "day" : "days"}.
            </div>
            <button
              type="button"
              onClick={() => void handleRestore()}
              disabled={restoring}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-display text-[12px] italic transition-colors disabled:opacity-50"
              style={{
                border:
                  "1px solid color-mix(in oklab, var(--gold) 32%, transparent)",
                color: "var(--gold)",
                background: "transparent",
              }}
            >
              <ArchiveIcon size={12} strokeWidth={1.5} aria-hidden />
              Restore
            </button>
          </div>
        )}
        <header>
          <div className="flex items-start justify-between gap-3">
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              <span style={{ opacity: "var(--ro-plus-30)" }}>
                {spreadLabel(reading.spread_type)}
              </span>
              <span className="mx-2" aria-hidden>
                ·
              </span>
              <span style={{ opacity: "var(--ro-plus-20)" }}>
                {formatDateTime(reading.created_at)}
              </span>
            </div>
            {/* EA-7 — mirror the row's right-cluster indicators at the top of the detail. */}
            <div className="flex items-center gap-1.5 shrink-0">
              {reading.is_favorite && (
                <Heart
                  size={16}
                  strokeWidth={1.5}
                  fill="currentColor"
                  style={{ color: "var(--accent)", opacity: 0.8 }}
                  aria-label="Favorite"
                />
              )}
              {reading.mirror_saved && (
                <Bookmark
                  size={16}
                  strokeWidth={1.5}
                  fill="currentColor"
                  style={{ color: "var(--accent)", opacity: 0.8 }}
                  aria-label="Bookmarked"
                />
              )}
              {reading.pattern_id && (
                <Network
                  size={16}
                  strokeWidth={1.5}
                  fill="currentColor"
                  style={{ color: "var(--accent)", opacity: 0.8 }}
                  aria-label="In Story"
                />
              )}
              {reading.is_deep_reading && (
                <Sparkles
                  size={16}
                  strokeWidth={1.5}
                  fill="currentColor"
                  style={{ color: "var(--accent)", opacity: 0.8 }}
                  aria-label="Deep reading"
                />
              )}
            </div>
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

        {/* Cards — align to top so any reversed-label line break does
            NOT push some cards down (Phase 9.5b Fix 7). The position
            label sits on its own row, the optional "Reversed" tag is a
            separate line whose space is reserved with min-height even
            when absent. */}
        <div
          ref={cardRowRef}
          className={cn(
            "mt-6 flex items-start gap-2",
            swipeMobile
              ? "overflow-x-auto snap-x snap-mandatory -mx-4 px-4 pb-2 justify-start"
              : "justify-center",
          )}
          style={
            swipeMobile
              ? {
                  scrollbarWidth: "none",
                  WebkitOverflowScrolling: "touch",
                  maskImage:
                    "linear-gradient(to right, black 90%, transparent 100%)",
                  WebkitMaskImage:
                    "linear-gradient(to right, black 90%, transparent 100%)",
                }
              : { paddingBottom: 16 /* EZ-4 — room for drop shadow */ }
          }
        >
          {(() => {
            // Q47 — swipeMobile keeps its existing per-card stacking; the
            // scroll-snap row is unaffected by the alignment fix.
            const renderSwipeCard = (id: number, idx: number) => {
              const isReversed = !!reading.card_orientations?.[idx];
              const perCardDeckId =
                (reading.card_deck_ids?.[idx] ?? reading.deck_id) ?? null;
              return (
                <div
                  key={`${id}-${idx}`}
                  className="flex flex-col items-center flex-shrink-0 snap-start"
                >
                  <CardImage
                    cardId={id}
                    reversed={isReversed}
                    size="custom"
                    widthPx={ezCardWidthPx}
                    deckId={perCardDeckId}
                    shadow
                    ariaLabel={`Zoom ${resolveCardName(id, idx)}`}
                    onClick={() =>
                      setZoomedCard({ cardId: id, reversed: isReversed, idx })
                    }
                  />
                  <span
                    className="mt-1 max-w-[120px] text-center font-display italic"
                    style={{
                      color: "var(--gold)",
                      opacity: "var(--ro-plus-30)",
                      fontSize: "var(--text-body-sm, 13px)",
                      lineHeight: 1.2,
                    }}
                  >
                    {resolveCardName(id, idx)}
                  </span>
                  <span
                    className="max-w-[120px] text-center font-display italic text-muted-foreground"
                    style={{
                      opacity: "var(--ro-plus-20)",
                      fontSize: "var(--text-caption, 11px)",
                      letterSpacing: "0.05em",
                    }}
                  >
                    {positions?.[idx] ?? ""}
                  </span>
                  <span
                    className="text-center font-display text-[10px] italic text-muted-foreground"
                    style={{
                      opacity: "var(--ro-plus-10)",
                      minHeight: "1.4em",
                      visibility: isReversed ? "visible" : "hidden",
                    }}
                  >
                    reversed
                  </span>
                </div>
              );
            };
            if (swipeMobile) {
              return reading.card_ids.map((id, idx) =>
                renderSwipeCard(id, idx),
              );
            }
            // Q47 — desktop / non-swipe path: cards anchored to a shared
            // floor in a fixed-height grid; labels in a separate
            // top-aligned grid below. Keeps mixed deck aspect ratios
            // and reversed/wrap label variations from misaligning.
            const cardAreaH = Math.round(ezCardWidthPx * 1.71);
            const renderCardCell = (id: number, idx: number) => {
              const isReversed = !!reading.card_orientations?.[idx];
              const perCardDeckId =
                (reading.card_deck_ids?.[idx] ?? reading.deck_id) ?? null;
              return (
                <div
                  key={`card-${id}-${idx}`}
                  style={{
                    height: cardAreaH,
                    display: "flex",
                    alignItems: "flex-end",
                    justifyContent: "center",
                  }}
                >
                  <CardImage
                    cardId={id}
                    reversed={isReversed}
                    size="custom"
                    widthPx={ezCardWidthPx}
                    deckId={perCardDeckId}
                    shadow
                    ariaLabel={`Zoom ${resolveCardName(id, idx)}`}
                    onClick={() =>
                      setZoomedCard({ cardId: id, reversed: isReversed, idx })
                    }
                  />
                </div>
              );
            };
            const renderLabelCell = (id: number, idx: number) => {
              const isReversed = !!reading.card_orientations?.[idx];
              return (
                <div
                  key={`label-${id}-${idx}`}
                  className="flex flex-col items-center"
                >
                  <span
                    className="mt-1 max-w-[120px] text-center font-display italic"
                    style={{
                      color: "var(--gold)",
                      opacity: "var(--ro-plus-30)",
                      fontSize: "var(--text-body-sm, 13px)",
                      lineHeight: 1.2,
                    }}
                  >
                    {resolveCardName(id, idx)}
                  </span>
                  <span
                    className="max-w-[120px] text-center font-display italic text-muted-foreground"
                    style={{
                      opacity: "var(--ro-plus-20)",
                      fontSize: "var(--text-caption, 11px)",
                      letterSpacing: "0.05em",
                    }}
                  >
                    {positions?.[idx] ?? ""}
                  </span>
                  <span
                    className="text-center font-display text-[10px] italic text-muted-foreground"
                    style={{
                      opacity: "var(--ro-plus-10)",
                      minHeight: "1.4em",
                      visibility: isReversed ? "visible" : "hidden",
                    }}
                  >
                    reversed
                  </span>
                </div>
              );
            };
            const renderRowPair = (
              ids: number[],
              startIdx: number,
              key: string,
            ) => {
              const cols = ids.length;
              return (
                <div key={key}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: `repeat(${cols}, auto)`,
                      justifyContent: "center",
                      alignItems: "end",
                      columnGap: 8,
                    }}
                  >
                    {ids.map((id, i) => renderCardCell(id, startIdx + i))}
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: `repeat(${cols}, auto)`,
                      justifyContent: "center",
                      alignItems: "start",
                      columnGap: 8,
                    }}
                  >
                    {ids.map((id, i) => renderLabelCell(id, startIdx + i))}
                  </div>
                </div>
              );
            };
            if (!useTwoRows) {
              return renderRowPair(reading.card_ids, 0, "row-single");
            }
            return (
              <div className="flex w-full flex-col items-center gap-4">
                {renderRowPair(row1Ids, 0, "row-1")}
                {row2Ids.length > 0 &&
                  renderRowPair(row2Ids, cardsPerRow, "row-2")}
              </div>
            );
          })()}
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
            {stripMarkdown(stripLegacyMoonseedPrefix(reading.interpretation))}
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
                  aria-label="Bookmarked"
                >
                  · bookmarked
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
        {/* DB-3.2 — Deck override picker. */}
        {/* Q13 Fix 4 — "Deck: …" label removed per spec. */}

        <div
          style={
            isArchived
              ? { opacity: 0.45, pointerEvents: "none" }
              : undefined
          }
          aria-disabled={isArchived ? true : undefined}
        >
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
          cardIds={reading.card_ids}
          question={reading.question ?? null}
          tailoredPrompt={reading.tailored_prompt ?? null}
          isPremium={isPremium}
          onTailoredPromptUpdate={(next) =>
            onReadingChange({
              id: reading.id,
              note: reading.note,
              is_favorite: reading.is_favorite,
              tags: reading.tags,
              // tailored_prompt isn't part of the parent's onReadingChange
              // contract; the cached value stays on the row server-side
              // and is re-fetched on next open.
            } as { id: string; note: string | null; is_favorite: boolean; tags: string[] | null })
          }
          onPremiumUpsell={() => navigate({ to: "/settings/moon" })}
          defaultNoteOpen
          journalPromptUsed={!!reading.journal_prompt_used}
          onJournalPromptUsed={() => {
            // Q16 Fix 1 secondary — update local state too so the panel
            // collapses immediately without waiting for a refetch.
            onReadingChange({
              id: reading.id,
              note: reading.note,
              is_favorite: reading.is_favorite,
              tags: reading.tags,
              journal_prompt_used: true,
            });
            void supabase
              .from("readings")
              .update({ journal_prompt_used: true })
              .eq("id", reading.id);
          }}
        />
        </div>

        {/* DV — Archive (soft-delete) action. Confirmed via dialog;
            row stays restorable from the Archive tab for 30 days. */}
        {!isArchived && (
        <div className="mx-auto mt-6 flex max-w-prose justify-center">
          <button
            type="button"
            onClick={() => setArchiveConfirmOpen(true)}
            disabled={archiving}
            className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 font-display text-[12px] italic text-muted-foreground transition-colors hover:text-gold disabled:opacity-50"
            style={{
              border:
                "1px solid color-mix(in oklab, var(--gold) 14%, transparent)",
              opacity: "var(--ro-plus-30)",
            }}
          >
            <ArchiveIcon size={13} strokeWidth={1.5} aria-hidden />
            Archive reading
          </button>
        </div>
        )}
        <AlertDialog open={archiveConfirmOpen} onOpenChange={setArchiveConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Archive this reading?</AlertDialogTitle>
              <AlertDialogDescription>
                It will be hidden from your journal, gallery, notes,
                favorites, calendar, and stories. You can restore it
                from the Archive tab within 30 days, after which it&rsquo;s
                permanently deleted.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => void handleArchive()}
                style={{
                  background: "var(--accent)",
                  color: "var(--accent-foreground, #1a1a1a)",
                }}
              >
                Archive
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

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
      <ShareBuilder
        open={shareOpen}
        onOpenChange={setShareOpen}
        context={{
          spread: spreadModeForShare,
          picks: sharePicks,
          positionLabels: sharePositions,
          interpretation: {
            overview: reading.interpretation ?? "",
            positions: [],
            closing: "",
          },
          guideName: guide.name,
          isOracle,
          deckId: reading.deck_id ?? null,
        }}

        defaultLevel={reading.interpretation?.trim() ? "reading" : "pull"}
      />
      {zoomedCard && (
        <CardZoomModal
          cardId={zoomedCard.cardId}
          reversed={zoomedCard.reversed}
          onClose={() => setZoomedCard(null)}
          deckId={(reading.card_deck_ids?.[zoomedCard.idx] ?? reading.deck_id) ?? null}
        />
      )}
    </FullScreenSheet>
  );
}

