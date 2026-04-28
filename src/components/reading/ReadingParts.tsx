import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import { CheckCheck, ChevronDown, ChevronRight, Copy, Pencil } from "lucide-react";
import { getCardName } from "@/lib/tarot";
import { SPREAD_META, type SpreadMode } from "@/lib/spreads";
import {
  interpretReading,
  type InterpretationPayload,
} from "@/lib/interpret.functions";
import { buildMemorySnapshot, detectThreads } from "@/lib/memory.functions";
import { supabase } from "@/lib/supabase";
import { useActiveGuide } from "@/lib/use-active-guide";
import { useOracleMode } from "@/lib/use-oracle-mode";
import { useAuth } from "@/lib/auth";
import { getCurrentMoonPhase } from "@/lib/moon";
import { FACETS } from "@/lib/guides";
import {
  BUILT_IN_GUIDES,
  getGuideById,
  type CustomGuide,
} from "@/lib/guides";
import {
  READING_FONT_DEFAULT,
  READING_FONT_MAX,
  READING_FONT_MIN,
  useReadingFontSize,
} from "@/lib/use-reading-font-size";
import {
  EnrichmentPanel,
  type EnrichmentTag,
} from "@/components/journal/EnrichmentPanel";
import { TearOffCard } from "@/components/reading/TearOffCard";
import { Scissors } from "lucide-react";

type Pick = { id: number; cardIndex: number };

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; interpretation: InterpretationPayload; readingId: string | null }
  | { kind: "limit" }
  | { kind: "error"; message: string };

/**
 * Headless orchestrator for the reading flow. Drives the interpret
 * server-fn lifecycle and renders ONLY the textual surfaces
 * (actions / body / limit / error / copy link). The cards themselves
 * are owned by the parent (SpreadLayout or ReadingScreen) so this can
 * be embedded inline below an existing card layout without duplicating
 * the spread rendering.
 *
 * Returns an additional `copyText` via the `onCopyTextChange` callback
 * so the parent can hoist a top-bar copy icon into its TopRightControls.
 */
export function InlineReading({
  spread,
  picks,
  onExit,
  onCopyTextChange,
  question,
}: {
  spread: SpreadMode;
  picks: Pick[];
  onExit: () => void;
  onCopyTextChange?: (text: string | null) => void;
  question?: string;
}) {
  const meta = SPREAD_META[spread];
  const { isOracle } = useOracleMode();
  const [state, setState] = useState<LoadState>({ kind: "idle" });
  const [retryNonce, setRetryNonce] = useState(0);
  const overrideRef = useRef(false);
  const { guideId, lensId, facetIds } = useActiveGuide();
  const startedRef = useRef(false);
  const requestSeqRef = useRef(0);
  // Tear-off keepsake modal — opened from the Done row.
  const [tearOpen, setTearOpen] = useState(false);
  const [savedReading, setSavedReading] = useState<{
    id: string;
    user_id: string;
    note: string | null;
    is_favorite: boolean;
    tags: string[] | null;
  } | null>(null);
  const [tagLibrary, setTagLibrary] = useState<EnrichmentTag[]>([]);
  const savedReadingRef = useRef<typeof savedReading>(null);
  savedReadingRef.current = savedReading;

  const beginReading = useCallback(() => {
    if (state.kind !== "idle" && state.kind !== "error") return;
    setState({ kind: "loading" });
  }, [state.kind]);

  useEffect(() => {
    if (state.kind !== "loading") return;
    if (startedRef.current) return;
    startedRef.current = true;
    const requestSeq = ++requestSeqRef.current;
    const isCurrentRequest = () => requestSeqRef.current === requestSeq;

    void (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) {
          if (isCurrentRequest()) {
            setState({
              kind: "error",
              message: "You need to be signed in to receive a reading.",
            });
          }
          return;
        }

        const result = await interpretReading({
          data: {
            spread,
            picks,
            guideId,
            lensId,
            facetIds,
            allowOverride: overrideRef.current,
            question,
          },
          headers: { Authorization: `Bearer ${token}` },
        });
        overrideRef.current = false;

        if (!isCurrentRequest()) return;
        if (result.ok) {
          setState({
            kind: "loaded",
            interpretation: result.interpretation,
            readingId: result.readingId ?? null,
          });
        } else if (result.error === "daily_limit_reached") {
          setState({ kind: "limit" });
        } else {
          setState({ kind: "error", message: result.message });
        }
      } catch (e) {
        if (!isCurrentRequest()) return;
        console.error("InlineReading interpret error:", e);
        setState({
          kind: "error",
          message: isOracle
            ? "The cards could not be heard. Please try again."
            : "The reading could not be completed. Please try again.",
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryNonce, state.kind]);

  const positionLabels =
    meta.positions ?? picks.map((_, i) => `Card ${i + 1}`);

  const copyText =
    state.kind === "loaded"
      ? buildCopyText({
          spreadLabel: meta.label,
          interpretation: state.interpretation,
          picks,
          positionLabels,
        })
      : null;

  // Notify parent of copyText changes so it can wire the top-bar copy icon.
  useEffect(() => {
    onCopyTextChange?.(copyText);
  }, [copyText, onCopyTextChange]);

  useEffect(() => {
    if (state.kind !== "loaded") return;
    if (savedReadingRef.current) return;
    const loadedInterpretation = state.interpretation;
    const serverReadingId = state.readingId;
    let cancelled = false;
    void (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const uid = sessionData.session?.user?.id;
        if (!uid) return;
        const interpretationText = buildCopyText({
          spreadLabel: meta.label,
          interpretation: loadedInterpretation,
          picks,
          positionLabels,
        });
        // The server function `interpretReading` already inserted the row
        // with the AI-generated JSON interpretation. Update that row in
        // place with the formatted plaintext + client-side metadata
        // instead of inserting a duplicate.
        const query = serverReadingId
          ? supabase
              .from("readings")
              .update({
                interpretation: interpretationText,
                guide_id: guideId,
                lens_id: lensId,
                mode: "reveal",
              })
              .eq("id", serverReadingId)
              .eq("user_id", uid)
          : supabase
              .from("readings")
              .insert({
                user_id: uid,
                spread_type: spread,
                card_ids: picks.map((p) => p.cardIndex),
                interpretation: interpretationText,
                guide_id: guideId,
                lens_id: lensId,
                mode: "reveal",
                question: question || null,
              });
        const { data, error } = await query
          .select("id,user_id,note,is_favorite,tags")
          .single();
        if (cancelled) return;
        if (error || !data) {
          if (error) console.error("InlineReading insert error:", error);
          return;
        }
        setSavedReading({
          id: data.id,
          user_id: data.user_id,
          note: data.note,
          is_favorite: data.is_favorite,
          tags: data.tags,
        });
        void detectThreads({ data: { user_id: uid } }).catch((e: unknown) =>
          console.warn("detect-threads failed silently:", e),
        );
        const snapshotType =
          lensId === "recent-echoes"
            ? "recent_echoes"
            : lensId === "full-archive"
              ? "full_archive"
              : "deeper_threads";
        void buildMemorySnapshot({
          data: { user_id: uid, snapshot_type: snapshotType },
        }).catch((e: unknown) =>
          console.warn("build-memory-snapshot failed silently:", e),
        );
        const { data: tagRows } = await supabase
          .from("user_tags")
          .select("id,name,usage_count")
          .eq("user_id", uid)
          .order("usage_count", { ascending: false })
          .limit(20);
        if (cancelled) return;
        setTagLibrary((tagRows ?? []) as EnrichmentTag[]);
      } catch (e) {
        console.error("InlineReading auto-save failed:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind]);

  const handleEnrichReadingChange = useCallback(
    (next: {
      id: string;
      user_id: string;
      note: string | null;
      is_favorite: boolean;
      tags: string[] | null;
    }) => {
      setSavedReading(next);
    },
    [],
  );
  const handleEnrichTagLibraryChange = useCallback((next: EnrichmentTag[]) => {
    setTagLibrary(next);
  }, []);
  const handleEnrichPhotoCountChange = useCallback(
    (_readingId: string, _count: number) => {
      // Inline readings do not render a separate gallery counter.
    },
    [],
  );

  return (
    <>
      {(state.kind === "idle" || state.kind === "loading") && (
        <div className="reading-actions-fade-in flex w-full flex-col items-center gap-3">
          {question && question.trim() && (
            <SeekerQuestion text={question} isOracle={isOracle} />
          )}
          <ReadingActions
            isOracle={isOracle}
            isLoading={state.kind === "loading"}
            onSpeak={beginReading}
            spread={spread}
            picks={picks}
            positionLabels={positionLabels}
            lensId={lensId}
            facetIds={facetIds}
            question={question}
          />
        </div>
      )}

      <section
        className="reading-actions-fade-in w-full"
        aria-live="polite"
        aria-busy={state.kind === "loading"}
      >
        {state.kind === "loaded" && (
          <>
            {question && question.trim() && (
              <div className="mb-4 mx-auto w-full max-w-md">
                <SeekerQuestion text={question} isOracle={isOracle} sticky />
              </div>
            )}
            <ReadingBody
            interpretation={state.interpretation}
            picks={picks}
            positionLabels={positionLabels}
            isOracle={isOracle}
            copyText={copyText ?? ""}
            />
          </>
        )}
        {state.kind === "limit" && (
          <LimitMessage
            onExit={onExit}
            isOracle={isOracle}
            onSubmitAnyway={() => {
              overrideRef.current = true;
              startedRef.current = false;
              setState({ kind: "loading" });
              setRetryNonce((n) => n + 1);
            }}
          />
        )}
        {state.kind === "error" && (
          <ErrorMessage
            message={state.message}
            onRetry={() => {
              startedRef.current = false;
              setState({ kind: "loading" });
              setRetryNonce((n) => n + 1);
            }}
            onExit={onExit}
          />
        )}
      </section>

      {state.kind === "loaded" && (
        <>
          {savedReading && (
            <EnrichmentPanel
              reading={savedReading}
              tagLibrary={tagLibrary}
              isOracle={isOracle}
              onReadingChange={handleEnrichReadingChange}
              onTagLibraryChange={handleEnrichTagLibraryChange}
              onPhotoCountChange={handleEnrichPhotoCountChange}
            />
          )}
          <div className="reading-actions-fade-in mt-2 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => setTearOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/10 px-5 py-3 font-display text-xs uppercase tracking-[0.3em] text-gold transition-colors hover:bg-gold/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
              aria-label={isOracle ? "Tear off a keepsake" : "Tear off card"}
            >
              <Scissors size={13} strokeWidth={1.5} aria-hidden />
              {isOracle ? "Tear off keepsake" : "Tear off card"}
            </button>
            <button
              type="button"
              onClick={onExit}
              className="rounded-full border border-gold/40 bg-gold/10 px-7 py-3 font-display text-xs uppercase tracking-[0.3em] text-gold transition-colors hover:bg-gold/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
            >
              Done
            </button>
          </div>
          <TearOffCard
            open={tearOpen}
            onOpenChange={setTearOpen}
            question={question}
            spread={spread}
            picks={picks}
            positionLabels={positionLabels}
            interpretation={state.interpretation}
            guideName={getGuideById(guideId).name}
            isOracle={isOracle}
          />
        </>
      )}
    </>
  );
}

/* ---------------------------------------------------------------------- */
/*  Reading actions — guide dropdown + "Let Them Speak" button            */
/* ---------------------------------------------------------------------- */

export function SeekerQuestion({
  text,
  isOracle,
  sticky,
  stickyTop,
  onEdit,
}: {
  text: string;
  isOracle: boolean;
  /** When true, the panel pins to the top of the nearest scroll container. */
  sticky?: boolean;
  /** CSS `top` offset used in sticky mode (defaults to the topbar pad). */
  stickyTop?: string;
  /**
   * Optional inline edit handler. When provided, the pencil writes the
   * new value here instead of navigating to the home screen. The host
   * is responsible for re-running the reading with the new question if
   * needed; for the reveal screen we currently only update the visible
   * quote so the seeker can refine the wording in their journal.
   */
  onEdit?: (next: string) => void;
}) {
  const navigate = useNavigate();
  const label = isOracle ? "You whispered" : "Your question";
  const editLabel = isOracle ? "Re-whisper" : "Edit question";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  useEffect(() => {
    setDraft(text);
  }, [text]);
  const commit = () => {
    const v = draft.trim();
    if (v && v !== text.trim() && onEdit) onEdit(v);
    setEditing(false);
  };
  return (
    <figure
      className="w-full max-w-md text-center"
      style={{
        fontFamily: "var(--font-serif)",
        fontStyle: "italic",
        ...(sticky
          ? {
              position: "sticky",
              top: stickyTop ?? "calc(var(--topbar-pad) + 4px)",
              zIndex: 30,
              // Soft veil so interpretation prose doesn't ghost behind
              // the pinned quote when scrolled.
              background:
                "linear-gradient(to bottom, color-mix(in oklab, var(--background) 92%, transparent) 0%, color-mix(in oklab, var(--background) 92%, transparent) 75%, transparent 100%)",
              backdropFilter: "blur(6px)",
              WebkitBackdropFilter: "blur(6px)",
              padding: "10px 12px 14px",
              borderRadius: 12,
            }
          : null),
      }}
    >
      <div
        style={{
          fontSize: "calc(11px * var(--heading-scale, 1))",
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: "var(--gold)",
          opacity: "var(--ro-plus-20)",
          marginBottom: 4,
          fontStyle: "normal",
        }}
      >
        {label}
      </div>
      {editing ? (
        <div className="flex items-center justify-center gap-2 px-3">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setDraft(text);
                setEditing(false);
              }
            }}
            onBlur={commit}
            className="w-full max-w-sm bg-transparent text-center focus:outline-none"
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "calc(15px * var(--heading-scale, 1))",
              lineHeight: 1.7,
              color: "var(--foreground)",
              borderBottom:
                "1px solid color-mix(in oklab, var(--gold) 35%, transparent)",
              padding: "2px 4px",
            }}
          />
        </div>
      ) : (
        <div className="relative inline-flex max-w-full items-baseline justify-center gap-1 px-3">
          <blockquote
            style={{
              fontSize: "calc(15px * var(--heading-scale, 1))",
              lineHeight: 1.7,
              color: "var(--foreground)",
              opacity: "var(--ro-plus-40)",
              margin: 0,
              padding: 0,
            }}
          >
            “{text.trim()}”
          </blockquote>
          <button
            type="button"
            onClick={() => {
              if (onEdit) {
                setEditing(true);
              } else {
                void navigate({ to: "/", search: { question: text.trim() } });
              }
            }}
            aria-label={editLabel}
            title={editLabel}
            className="inline-flex items-center justify-center rounded-full p-1 transition-colors hover:bg-gold/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
            style={{
              color: "var(--gold)",
              opacity: "var(--ro-plus-20)",
              background: "none",
              border: "none",
              cursor: "pointer",
              transform: "translateY(-1px)",
            }}
          >
            <Pencil size={11} strokeWidth={1.75} />
          </button>
        </div>
      )}
    </figure>
  );
}

function ReadingActions({
  isOracle,
  isLoading,
  onSpeak,
  spread,
  picks,
  positionLabels,
  lensId,
  facetIds,
  question,
}: {
  isOracle: boolean;
  isLoading: boolean;
  onSpeak: () => void;
  spread: SpreadMode;
  picks: Pick[];
  positionLabels: string[];
  lensId: string;
  facetIds: string[];
  question?: string;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { guideId, setGuide } = useActiveGuide();
  const [open, setOpen] = useState(false);
  const [customGuides, setCustomGuides] = useState<CustomGuide[]>([]);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => {
          select: (q: string) => {
            eq: (
              col: string,
              val: string,
            ) => {
              order: (
                col: string,
                opts: { ascending: boolean },
              ) => Promise<{ data: CustomGuide[] | null; error: unknown }>;
            };
          };
        };
      })
        .from("custom_guides")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true });
      if (cancelled || error) return;
      setCustomGuides((data as CustomGuide[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!dropdownRef.current) return;
      if (!dropdownRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const activeBuiltIn = getGuideById(guideId);
  const activeCustom = customGuides.find((cg) => cg.id === guideId);
  const activeName = activeCustom ? activeCustom.name : activeBuiltIn.name;
  const activeEmoji = activeCustom ? "✦" : activeBuiltIn.accentEmoji;

  const speakLabel = isOracle ? "Let Them Speak" : "Get Reading";
  const loadingLabel = isOracle ? "The cards are speaking…" : "Reading the cards…";

  return (
    <div className="flex w-full flex-col items-center gap-4">
      <div ref={dropdownRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-gold transition-colors hover:bg-gold/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
          style={{
            opacity: "var(--ro-plus-20)",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
          }}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span aria-hidden>{activeEmoji}</span>
          <span>{activeName}</span>
          <ChevronDown
            className="h-3.5 w-3.5"
            strokeWidth={1.5}
            style={{ opacity: "var(--ro-plus-20)" }}
          />
        </button>
        {open && (
          <div
            role="listbox"
            className="absolute left-1/2 top-full z-50 mt-2 w-[240px] -translate-x-1/2 rounded-xl border border-gold/30 bg-cosmos p-1.5 shadow-2xl"
          >
            {BUILT_IN_GUIDES.map((g) => (
              <button
                key={g.id}
                type="button"
                role="option"
                aria-selected={g.id === guideId}
                onClick={() => {
                  setGuide(g.id);
                  setOpen(false);
                }}
                className={
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors " +
                  (g.id === guideId
                    ? "bg-gold/15 text-gold"
                    : "text-foreground/80 hover:bg-gold/10")
                }
              >
                <span className="text-base" aria-hidden>
                  {g.accentEmoji}
                </span>
                <span style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}>
                  {g.name}
                </span>
              </button>
            ))}
            {customGuides.length > 0 && (
              <div className="my-1 border-t border-border/40" />
            )}
            {customGuides.map((cg) => (
              <button
                key={cg.id}
                type="button"
                role="option"
                aria-selected={cg.id === guideId}
                onClick={() => {
                  setGuide(cg.id);
                  setOpen(false);
                }}
                className={
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors " +
                  (cg.id === guideId
                    ? "bg-gold/15 text-gold"
                    : "text-foreground/80 hover:bg-gold/10")
                }
              >
                <span className="text-base" aria-hidden>
                  ✦
                </span>
                <span style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}>
                  {cg.name}
                </span>
              </button>
            ))}
            <div className="my-1 border-t border-border/40" />
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                void navigate({ to: "/guides" });
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-gold/10"
            >
              Edit Guides…
            </button>
          </div>
        )}
      </div>

      <WhatGuideWillSee
        spread={spread}
        picks={picks}
        positionLabels={positionLabels}
        guideName={activeName}
        lensId={lensId}
        facetIds={facetIds}
        isOracle={isOracle}
        question={question}
      />
      <button
        type="button"
        onClick={onSpeak}
        disabled={isLoading}
        className="reading-mist-button reading-invocation"
        aria-busy={isLoading}
      >
        <span className="reading-mist" aria-hidden />
        <span
          className="relative z-10 block"
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: isLoading ? 20 : 26,
            color: "var(--gold)",
            letterSpacing: "0.02em",
            textShadow: "0 0 18px color-mix(in oklab, var(--gold) 35%, transparent)",
          }}
        >
          {isLoading ? loadingLabel : speakLabel}
        </span>
      </button>
    </div>
  );
}

function AiPromptPreview({
  spread,
  picks,
  positionLabels,
  guideName,
  lensId,
  facetIds,
  isOracle,
  question,
}: {
  spread: SpreadMode;
  picks: Pick[];
  positionLabels: string[];
  guideName: string;
  lensId: string;
  facetIds: string[];
  isOracle: boolean;
  question?: string;
}) {
  const meta = SPREAD_META[spread];
  const moonPhase = getCurrentMoonPhase().phase;

  const cardLines = picks
    .map((p, i) => {
      const name = getCardName(p.cardIndex);
      const pos = positionLabels[i] ?? `Card ${i + 1}`;
      return `${pos}: ${name}`;
    })
    .join("\n");

  const lensDescription =
    lensId === "recent-echoes"
      ? "drawing only from the recent echoes of your practice"
      : lensId === "full-archive"
        ? "drawing from the full archive of your practice"
        : "drawing from the deeper threads of your practice";

  const facetNames = FACETS.filter((f) => facetIds.includes(f.id)).map(
    (f) => f.name,
  );
  const facetLine =
    facetNames.length > 0
      ? `\nFocusing through: ${facetNames.join(", ")}.`
      : "";

  const voiceLine = isOracle
    ? `${guideName} will whisper the reading,`
    : `${guideName} will speak the reading,`;

  const text = `${question && question.trim() ? `"${question.trim()}"\n\n` : ""}${voiceLine} ${lensDescription}.${facetLine}

${meta.label} spread — moon in ${moonPhase}.

${cardLines}`;

  return <>{text}</>;
}

function WhatGuideWillSee({
  spread,
  picks,
  positionLabels,
  guideName,
  lensId,
  facetIds,
  isOracle,
  question,
}: {
  spread: SpreadMode;
  picks: Pick[];
  positionLabels: string[];
  guideName: string;
  lensId: string;
  facetIds: string[];
  isOracle: boolean;
  question?: string;
}) {
  const [open, setOpen] = useState(false);
  const label = isOracle
    ? "What will be whispered to the guide"
    : "What the guide will see";

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
        <span>{label}</span>
      </button>
      {open && (
        <div
          className="mx-auto mt-2 rounded-lg border border-gold/30 bg-gold/[0.04] px-4 py-3"
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: 12,
            lineHeight: 1.8,
            color: "color-mix(in oklab, var(--foreground) 78%, transparent)",
            whiteSpace: "pre-wrap",
          }}
        >
          <AiPromptPreview
            spread={spread}
            picks={picks}
            positionLabels={positionLabels}
            guideName={guideName}
            lensId={lensId}
            facetIds={facetIds}
            isOracle={isOracle}
            question={question}
          />
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Interpretation body — supports long-press text-size slider            */
/* ---------------------------------------------------------------------- */

function ReadingBody({
  interpretation,
  picks,
  positionLabels,
  isOracle,
  copyText,
}: {
  interpretation: InterpretationPayload;
  picks: Pick[];
  positionLabels: string[];
  isOracle: boolean;
  copyText: string;
}) {
  const { size, setSize } = useReadingFontSize();
  const [showSlider, setShowSlider] = useState(false);
  const longPressTimer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);

  const positions = useMemo(
    () =>
      interpretation.positions.length
        ? interpretation.positions
        : picks.map((p, i) => ({
            position: positionLabels[i] ?? `Card ${i + 1}`,
            card: getCardName(p.cardIndex),
            interpretation: "",
          })),
    [interpretation.positions, picks, positionLabels],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => {
      setShowSlider(true);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    }, 550);
  };
  const cancelLongPress = () => {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };
  const scheduleHide = () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setShowSlider(false), 1000);
  };

  useEffect(
    () => () => {
      if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    },
    [],
  );

  const bodySize = size ?? READING_FONT_DEFAULT;

  return (
    <div
      className="reading-fade flex flex-col gap-7"
      onPointerDown={onPointerDown}
      onPointerUp={cancelLongPress}
      onPointerCancel={cancelLongPress}
      onPointerLeave={cancelLongPress}
    >
      <p
        className="text-center"
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: bodySize + 1,
          lineHeight: 1.65,
          color: "color-mix(in oklab, var(--foreground) 92%, transparent)",
          transition: "font-size 200ms ease",
        }}
      >
        {interpretation.overview}
      </p>

      <ul className="flex flex-col gap-5">
        {positions.map((p, i) => (
          <li key={i} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <span
                className="font-display"
                style={{
                  fontSize: 14,
                  color: "var(--gold)",
                  letterSpacing: "0.04em",
                }}
              >
                {p.card}
              </span>
              <span
                className="font-display italic"
                style={{
                  fontSize: 10,
                  color: "var(--gold)",
                  opacity: 0.6,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                }}
              >
                {p.position}
              </span>
            </div>
            <p
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: bodySize,
                lineHeight: 1.65,
                color: "color-mix(in oklab, var(--foreground) 85%, transparent)",
                transition: "font-size 200ms ease",
              }}
            >
              {p.interpretation}
            </p>
          </li>
        ))}
      </ul>

      <p
        className="text-center"
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: bodySize,
          lineHeight: 1.65,
          color: "color-mix(in oklab, var(--foreground) 80%, transparent)",
          transition: "font-size 200ms ease",
        }}
      >
        {interpretation.closing}
      </p>

      {showSlider && (
        <TextSizeSlider
          value={size}
          onChange={setSize}
          onRelease={scheduleHide}
          onClose={() => setShowSlider(false)}
        />
      )}

      <CopyTextLink text={copyText} isOracle={isOracle} />
    </div>
  );
}

function TextSizeSlider({
  value,
  onChange,
  onRelease,
  onClose,
}: {
  value: number;
  onChange: (n: number) => void;
  onRelease: () => void;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-label="Text size"
      className="fixed left-1/2 top-1/2 z-[60] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-gold/30 bg-cosmos px-5 py-4 shadow-2xl"
      style={{ animation: "reading-fade 200ms ease forwards" }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex items-center justify-between gap-4">
        <span className="text-[11px] uppercase tracking-[0.2em] text-gold/80">
          Text Size
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] text-muted-foreground hover:text-gold"
        >
          Done
        </button>
      </div>
      <input
        type="range"
        min={READING_FONT_MIN}
        max={READING_FONT_MAX}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onRelease}
        onTouchEnd={onRelease}
        className="w-56 accent-[color:var(--gold)]"
        aria-label="Reading text size"
      />
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{READING_FONT_MIN}px</span>
        <span>{value}px</span>
        <span>{READING_FONT_MAX}px</span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Limit / error states                                                  */
/* ---------------------------------------------------------------------- */

function LimitMessage({
  onExit,
  isOracle,
  onSubmitAnyway,
}: {
  onExit: () => void;
  isOracle: boolean;
  onSubmitAnyway: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-5 py-6 text-center">
      <p
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: 15.5,
          lineHeight: 1.6,
          color: "color-mix(in oklab, var(--foreground) 85%, transparent)",
          maxWidth: 320,
        }}
      >
        {isOracle
          ? "You have drawn once today. The cards rest until tomorrow."
          : "You\u2019ve completed your reading for today. Return tomorrow for more guidance."}
      </p>
      <button
        type="button"
        onClick={onExit}
        className="rounded-full border border-gold/40 bg-gold/10 px-7 py-3 font-display text-xs uppercase tracking-[0.3em] text-gold transition-colors hover:bg-gold/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
      >
        Done
      </button>
      <button
        type="button"
        onClick={onSubmitAnyway}
        style={{
          background: "transparent",
          border: "none",
          padding: "4px 8px",
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: 12,
          color: "var(--gold)",
          opacity: "var(--ro-plus-10)",
          cursor: "pointer",
        }}
        className="hover:!opacity-100 focus:!opacity-100 focus:outline-none"
      >
        Submit Anyway
      </button>
    </div>
  );
}

function ErrorMessage({
  message,
  onRetry,
  onExit,
}: {
  message: string;
  onRetry: () => void;
  onExit: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-5 py-6 text-center">
      <p
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: 15.5,
          lineHeight: 1.6,
          color: "color-mix(in oklab, var(--foreground) 85%, transparent)",
          maxWidth: 320,
        }}
      >
        {message}
      </p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onRetry}
          className="rounded-full border border-gold/50 bg-gold/15 px-6 py-3 font-display text-xs uppercase tracking-[0.3em] text-gold transition-colors hover:bg-gold/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={onExit}
          className="rounded-full border border-gold/30 px-6 py-3 font-display text-xs uppercase tracking-[0.3em] text-gold/80 transition-colors hover:bg-gold/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
        >
          Done
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Clipboard helpers                                                     */
/* ---------------------------------------------------------------------- */

export function buildCopyText({
  spreadLabel,
  interpretation,
  picks,
  positionLabels,
}: {
  spreadLabel: string;
  interpretation: InterpretationPayload;
  picks: Pick[];
  positionLabels: string[];
}): string {
  const lines: string[] = [];
  lines.push(`${spreadLabel} — Moonseed reading`);
  lines.push("");
  lines.push(interpretation.overview.trim());
  lines.push("");
  const positions = interpretation.positions.length
    ? interpretation.positions
    : picks.map((p, i) => ({
        position: positionLabels[i] ?? `Card ${i + 1}`,
        card: getCardName(p.cardIndex),
        interpretation: "",
      }));
  positions.forEach((p) => {
    lines.push(`${p.position} — ${p.card}`);
    if (p.interpretation) lines.push(p.interpretation.trim());
    lines.push("");
  });
  if (interpretation.closing) {
    lines.push(interpretation.closing.trim());
  }
  return lines.join("\n").trim() + "\n";
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === "undefined") return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to legacy path
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Top-bar copy icon — exported so SpreadLayout / ReadingScreen can hoist
 * it into the TopRightControls' `extraFirst` slot once a reading has loaded.
 */
export function CopyIconButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );
  const handle = async () => {
    const ok = await copyToClipboard(text);
    if (!ok) return;
    setCopied(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      type="button"
      aria-label={copied ? "Reading copied" : "Copy reading to clipboard"}
      onClick={() => void handle()}
      style={{ opacity: "var(--ro-plus-0)" }}
      className="inline-flex h-11 w-11 items-center justify-center rounded-full text-gold transition-opacity touch-manipulation [-webkit-tap-highlight-color:transparent] hover:!opacity-100 focus:!opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
    >
      {copied ? (
        <CheckCheck size={18} strokeWidth={1.5} />
      ) : (
        <Copy size={18} strokeWidth={1.5} />
      )}
    </button>
  );
}

function CopyTextLink({
  text,
  isOracle,
}: {
  text: string;
  isOracle: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );
  const handle = async () => {
    const ok = await copyToClipboard(text);
    if (!ok) return;
    setCopied(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1500);
  };
  const idleLabel = isOracle ? "Carry These Words" : "Copy Reading";
  const doneLabel = isOracle ? "Held in your hand" : "Copied";
  return (
    <div className="flex justify-center pt-2">
      <button
        type="button"
        onClick={() => void handle()}
        aria-label={copied ? doneLabel : idleLabel}
        className="group inline-flex items-center gap-2 bg-transparent px-2 py-1 text-gold transition-opacity hover:opacity-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-gold/60"
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: 14,
          letterSpacing: "0.04em",
          opacity: "var(--ro-plus-20)",
          textShadow:
            "0 0 12px color-mix(in oklab, var(--gold) 25%, transparent)",
        }}
      >
        {copied ? (
          <CheckCheck size={14} strokeWidth={1.5} aria-hidden />
        ) : (
          <Copy size={14} strokeWidth={1.5} aria-hidden />
        )}
        <span
          style={{
            borderBottom: "1px solid color-mix(in oklab, var(--gold) 40%, transparent)",
            paddingBottom: 1,
          }}
        >
          {copied ? doneLabel : idleLabel}
        </span>
      </button>
    </div>
  );
}