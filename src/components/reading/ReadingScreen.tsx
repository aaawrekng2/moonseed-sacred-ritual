import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, CheckCheck, ChevronDown, ChevronRight, Copy, Share2 } from "lucide-react";
import { getCardName } from "@/lib/tarot";
import { useActiveDeckImage } from "@/lib/active-deck";
import { SPREAD_META, type SpreadMode } from "@/lib/spreads";
import {
  interpretReading,
  type InterpretationPayload,
} from "@/lib/interpret.functions";
import { buildMemorySnapshot, detectThreads } from "@/lib/memory.functions";
import { supabase } from "@/lib/supabase";
import { useActiveGuide } from "@/lib/use-active-guide";
import { useOracleMode } from "@/lib/use-oracle-mode";
import { useUIDensity } from "@/lib/use-ui-density";
import { useAuth } from "@/lib/auth";
import { getCurrentMoonPhase } from "@/lib/moon";
import { FACETS, LENSES } from "@/lib/guides";
import {
  useRegisterCloseHandler,
  useRegisterCopyText,
} from "@/lib/floating-menu-context";
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
import { SeekerQuestion } from "@/components/reading/ReadingParts";
import { stripMarkdown } from "@/lib/strip-markdown";
import { DeepReadingPanel } from "@/components/reading/DeepReadingPanel";
import { ShareBuilder } from "@/components/share/ShareBuilder";

type Pick = { id: number; cardIndex: number; isReversed?: boolean };

type Props = {
  spread: SpreadMode;
  picks: Pick[];
  onExit: () => void;
  question?: string;
  /** Phase 9.5b — see {@link SpreadLayout} for semantics. */
  entryMode?: "digital" | "manual";
  deckId?: string | null;
};

type LoadState =
  | { kind: "idle" } // cards revealed, awaiting "Let Them Speak" tap
  | { kind: "loading" }
  | { kind: "loaded"; interpretation: InterpretationPayload; readingId: string | null }
  | { kind: "limit" }
  | { kind: "error"; message: string };

/**
 * Unified reading screen. After the cards are revealed elsewhere we
 * land here in the `idle` state with the cards already showing. The
 * user picks (or accepts) their guide via an inline dropdown, then
 * taps "Let Them Speak" to trigger the AI interpretation. Everything
 * stays on a single scrollable surface — no separate Guide Selector.
 */
export function ReadingScreen({
  spread,
  picks,
  onExit,
  question,
  entryMode,
  deckId,
}: Props) {
  const meta = SPREAD_META[spread];
  const { isOracle } = useOracleMode();
  const [state, setState] = useState<LoadState>({ kind: "idle" });
  const [retryNonce, setRetryNonce] = useState(0);
  // Dev override: when true, the next interpret call sets allowOverride
  // so the server bypasses the daily-quota check. Reset back to false
  // after the call so subsequent normal retries still see the cap.
  const overrideRef = useRef(false);
  const { guideId, lensId, facetIds } = useActiveGuide();
  const startedRef = useRef(false);
  const requestSeqRef = useRef(0);

  // Auto-saved reading + supporting tag library for the inline
  // enrichment panel that appears once the interpretation has loaded.
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

  // Reset savedReading whenever a new reading begins. Without this,
  // savedReadingRef.current stays set from the prior reading, causing
  // the auto-save effect to early-return and the mist to show stale
  // data (or never appear) on the second reading of a session.
  useEffect(() => {
    if (state.kind === "idle" || state.kind === "loading") {
      setSavedReading(null);
    }
  }, [state.kind]);

  // Register screen-specific affordances with the global floating menu.
  useRegisterCloseHandler(onExit);

  // Allow landscape on the Reading screen ONLY (matches prior behaviour).
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.setAttribute("data-allow-landscape", "true");
    return () => {
      document.body.removeAttribute("data-allow-landscape");
    };
  }, []);

  const beginReading = useCallback(() => {
    if (state.kind !== "idle" && state.kind !== "error") return;
    setState({ kind: "loading" });
  }, [state.kind]);

  // Fire the interpretation request once we leave `idle`.
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
        // Reset override after sending so a future retry doesn't
        // accidentally inherit the bypass.
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
        console.error("ReadingScreen interpret error:", e);
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

  // Build the plain-text version of the reading for clipboard copy.
  // Only available once the interpretation has loaded.
  const copyText =
    state.kind === "loaded"
      ? buildCopyText({
          spreadLabel: meta.label,
          interpretation: state.interpretation,
          picks,
          positionLabels,
        })
      : null;

  // Surface the copy text to the global FloatingMenu — it conditionally
  // renders the Copy icon only while a reading is loaded.
  useRegisterCopyText(copyText);

  // Once the interpretation loads, persist the reading to Supabase so the
  // user can favorite / annotate / photograph it directly from this screen
  // via the inline EnrichmentPanel rendered below. Stored once per loaded
  // interpretation; subsequent retries replace it.
  useEffect(() => {
    if (state.kind !== "loaded") return;
    if (savedReadingRef.current) return; // already saved for this load
    // Snapshot the loaded interpretation so the closure doesn't depend
    // on the derived `copyText` (which can momentarily be null between
    // renders even though state.kind === "loaded").
    const loadedInterpretation = state.interpretation;
    const serverReadingId = state.readingId;
    let cancelled = false;
    void (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const uid = sessionData.session?.user?.id;
        if (!uid) return;
        const token = sessionData.session?.access_token;
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
                card_orientations: picks.map((p) => p.isReversed ?? false),
                interpretation: interpretationText,
                guide_id: guideId,
                lens_id: lensId,
                mode: "reveal",
                question: question || null,
                entry_mode: entryMode ?? "digital",
                deck_id: deckId ?? null,
              });
        const { data, error } = await query
          .select("id,user_id,note,is_favorite,tags")
          .single();
        if (cancelled) return;
        if (error || !data) {
          console.error("[ReadingScreen] Supabase save failed — mist will not render:", error, data);
          return;
        }
        setSavedReading({
          id: data.id,
          user_id: data.user_id,
          note: data.note,
          is_favorite: data.is_favorite,
          tags: data.tags,
        });
        // Phase 7: fire-and-forget thread detection. Must NOT block or
        // surface errors to the reading UI.
        void detectThreads({
          data: { user_id: uid },
          ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
        }).catch((e: unknown) =>
          console.warn("detect-threads failed silently:", e),
        );
        // Phase 7: also refresh the memory snapshot for the lens the
        // user is currently reading under so the *next* reading has
        // current symbolic context. Gated server-side by
        // memory_ai_permission; failures are silent.
        const snapshotType =
          lensId === "recent-echoes"
            ? "recent_echoes"
            : lensId === "full-archive"
              ? "full_archive"
              : "deeper_threads";
        void buildMemorySnapshot({
          data: { user_id: uid, snapshot_type: snapshotType },
          ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
        }).catch((e: unknown) =>
          console.warn("build-memory-snapshot failed silently:", e),
        );
        // Load the user's tag library so the suggestion row works.
        const { data: tagRows } = await supabase
          .from("user_tags")
          .select("id,name,usage_count")
          .eq("user_id", uid)
          .order("usage_count", { ascending: false })
          .limit(20);
        if (cancelled) return;
        setTagLibrary((tagRows ?? []) as EnrichmentTag[]);
      } catch (e) {
        console.error("ReadingScreen auto-save failed:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind]);

  // Stable callbacks for EnrichmentPanel.
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
      // No gallery on this screen — nothing to sync.
    },
    [],
  );

  // Single share trigger per screen — opened from the EnrichmentPanel
  // Share2 icon (Phase BE).
  const [shareOpen, setShareOpen] = useState(false);

  return (
    <main
      className="fixed inset-0 z-40 flex h-[100dvh] w-full flex-col overflow-y-auto bg-[radial-gradient(ellipse_at_50%_25%,rgba(60,40,90,0.35),transparent_70%)]"
      aria-label={`${meta.label} reading`}
    >
      {/*
        Subtle back affordance — sits at the very top-left of the
        reading surface so the seeker can always return to the previous
        screen. Styled in muted gold to match the cosmic aesthetic.
      */}
      <button
        type="button"
        onClick={onExit}
        aria-label="Back"
        className="fixed z-50 flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-gold/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
        style={{
          top: "calc(env(safe-area-inset-top, 0px) + 6px)",
          left: "calc(env(safe-area-inset-left, 0px) + 8px)",
          color: "var(--gold)",
          opacity: "var(--ro-plus-10)",
          background: "transparent",
          border: "none",
        }}
      >
        <ArrowLeft size={16} strokeWidth={1.5} />
      </button>
      <div
        className="mx-auto flex w-full max-w-2xl flex-col items-center gap-6 px-5"
        style={{
          paddingTop: "calc(var(--topbar-pad) + 16px)",
          // Reserve enough room above the 64px BottomNav so the share
          // card, share button, and Done CTA are never clipped.
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 140px)",
        }}
      >
        {question && question.trim() && (
          <div className="mx-auto w-full max-w-md">
            {/* Tarot-style invocation that sits above the question on
                the reveal page — small, italic, gold-tinted, sets a
                sacred tone before the seeker re-reads what they asked. */}
            <p
              className="text-center"
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: "var(--text-caption)",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "var(--gold)",
                opacity: "var(--ro-plus-10)",
                marginBottom: 8,
              }}
            >
              ✦ The cards have heard you ✦
            </p>
            <SeekerQuestion
              text={question}
              isOracle={isOracle}
              sticky
              stickyTop="calc(var(--topbar-pad) + 8px)"
            />
          </div>
        )}
        <header className="flex flex-col items-center gap-1.5 text-center">
          <span className="text-[10px] uppercase tracking-[0.3em] text-gold/70">
            {meta.label}
          </span>
        </header>

        <CardStrip
          picks={picks}
          positionLabels={positionLabels}
          spread={spread}
        />

        {/* Idle / loading actions. Once interpretation has loaded, these
            collapse so the prose can breathe. */}
        {(state.kind === "idle" || state.kind === "loading") && (
          <div className="reading-actions-fade-in flex w-full justify-center">
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
            <ReadingBody
              interpretation={state.interpretation}
              picks={picks}
              positionLabels={positionLabels}
              isOracle={isOracle}
              copyText={copyText ?? ""}
            />
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
                copyText={copyText ?? undefined}
                onShare={() => setShareOpen(true)}
              />
            )}
          {(savedReading || (state.kind === "loaded" && state.readingId)) && (
            <DeepReadingPanel
              readingId={
                savedReading?.id ??
                (state.kind === "loaded" ? state.readingId ?? "" : "")
              }
              guideId={guideId}
              lensId={lensId}
              facetIds={facetIds}
            />
          )}
          <button
            type="button"
            onClick={onExit}
            className="reading-actions-fade-in mt-2 bg-transparent px-2 py-2 font-display text-xs uppercase tracking-[0.3em] text-gold transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
          >
            Done
          </button>
          </>
        )}
      </div>
      {state.kind === "loaded" && (
        <ShareBuilder
          open={shareOpen}
          onOpenChange={setShareOpen}
          context={{
            question,
            spread,
            picks,
            positionLabels,
            interpretation: state.interpretation,
            guideName: getGuideById(guideId).name,
            isOracle,
          }}
          defaultLevel="reading"
          availableLevels={["pull", "reading", "position"]}
        />
      )}
    </main>
  );
}

/* ---------------------------------------------------------------------- */
/*  Card strip — uses Clarity to show/hide position labels under cards.   */
/* ---------------------------------------------------------------------- */

function CardStrip({
  picks,
  positionLabels,
  spread,
}: {
  picks: Pick[];
  positionLabels: string[];
  spread: SpreadMode;
}) {
  const { level } = useUIDensity();
  const cardImg = useActiveDeckImage();
  const showLabels = level === 1; // Glimpse + Veiled hide the labels
  const labelOpacity = level === 1 ? 0.7 : 0;
  const [vp, setVp] = useState(() =>
    typeof window !== "undefined"
      ? { w: window.innerWidth, h: window.innerHeight }
      : { w: 0, h: 0 },
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () =>
      setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);
  const isDesktop = vp.w >= 768;


  if (spread === "celtic") {
    // Celtic Cross: preserve the cross+staff layout. Use fixed sizing
    // that matches SpreadLayout so there is no visual jump on transition.
    const cw = isDesktop ? 56 : 48;
    const ch = Math.round(cw * 1.75);
    const colGap = Math.round(cw * 0.35);
    const rowGap = Math.round(ch * 0.18);

    const card = (i: number) => (
      <div key={picks[i]?.id ?? i} className="flex flex-col items-center gap-1">
        <div
          className="reading-card-frame overflow-hidden rounded-[6px] border border-border/40 bg-card"
          style={{ width: cw, height: ch, boxShadow: "0 4px 14px rgba(0,0,0,0.45)" }}
        >
          {picks[i] && (
            <img
              src={cardImg(picks[i].cardIndex)}
              alt={getCardName(picks[i].cardIndex)}
              className="h-full w-full object-cover"
              loading="eager"
              style={{
                transform: picks[i].isReversed ? "rotate(180deg)" : undefined,
                transition: "transform 600ms ease-out",
              }}
            />
          )}
        </div>
        {showLabels && (
          <span
            className="font-display italic"
            style={{
              fontSize: "var(--text-body)",
              color: "var(--gold)",
              opacity: labelOpacity,
              letterSpacing: "0.05em",
              whiteSpace: "nowrap",
              textAlign: "center",
              transition: "opacity 250ms ease",
            }}
          >
            {positionLabels[i] ?? `Card ${i + 1}`}
          </span>
        )}
      </div>
    );

    const staff = [6, 7, 8, 9];

    return (
      <div className="reading-cards-nudge flex items-center" style={{ gap: colGap * 1.4 }}>
        {/* Cross block */}
        <div className="flex items-center" style={{ gap: colGap }}>
          {/* Past (index 3) */}
          {card(3)}
          {/* Center column */}
          <div className="flex flex-col items-center" style={{ gap: rowGap }}>
            {/* Future (index 5) */}
            {card(5)}
            {/* Present + Obstacle stacked */}
            <div className="relative flex items-center justify-center" style={{ width: cw, height: ch }}>
              <div className="absolute inset-0 flex items-center justify-center">
                {picks[0] && (
                  <div className="reading-card-frame overflow-hidden rounded-[6px] border border-border/40 bg-card" style={{ width: cw, height: ch }}>
                    <img src={cardImg(picks[0].cardIndex)} alt={getCardName(picks[0].cardIndex)} className="h-full w-full object-cover" loading="eager" style={{ transform: picks[0].isReversed ? "rotate(180deg)" : undefined, transition: "transform 600ms ease-out" }} />
                  </div>
                )}
              </div>
              <div className="absolute inset-0 flex items-center justify-center" style={{ transform: "rotate(90deg)" }}>
                {picks[1] && (
                  <div className="reading-card-frame overflow-hidden rounded-[6px] border border-border/40 bg-card" style={{ width: cw, height: ch }}>
                    <img src={cardImg(picks[1].cardIndex)} alt={getCardName(picks[1].cardIndex)} className="h-full w-full object-cover" loading="eager" style={{ transform: picks[1].isReversed ? "rotate(180deg)" : undefined, transition: "transform 600ms ease-out" }} />
                  </div>
                )}
              </div>
            </div>
            {/* Root (index 2) */}
            {card(2)}
          </div>
          {/* Potential (index 4) */}
          {card(4)}
        </div>
        {/* Staff column */}
        <div className="flex flex-col" style={{ gap: rowGap * 0.6 }}>
          {staff.map((i) => card(i))}
        </div>
      </div>
    );
  }

  // All other spreads: math-driven sizing, locked for 3-card to match SpreadLayout.
  const cardCount = picks.length;
  const sidePadding = isDesktop ? 24 : 12;
  const horizGap = isDesktop ? 12 : 8;

  let w: number;
  let h: number;

  if (cardCount === 3) {
    // Matches SpreadLayout's spreadSizing exactly — no resize on transition
    w = isDesktop ? 112 : 100;
    h = isDesktop ? 196 : 175;
  } else if (cardCount === 1) {
    // Single card: fill generously but cap so it doesn't dominate
    const availableW = Math.max(0, vp.w - 2 * sidePadding);
    w = Math.min(isDesktop ? 264 : 240, availableW);
    const reservedV = isDesktop ? 260 : 280;
    const maxByHeight = Math.floor(Math.max(140, vp.h - reservedV) / 1.75);
    if (w > maxByHeight) w = maxByHeight;
    h = Math.round(w * 1.75);
  } else {
    // Any other spread count: mathematical single-row layout
    const availableW = Math.max(0, vp.w - 2 * sidePadding - (cardCount - 1) * horizGap);
    w = Math.max(28, Math.floor(availableW / Math.max(1, cardCount)));
    const reservedV = isDesktop ? 260 : 280;
    const maxByHeight = Math.floor(Math.max(140, vp.h - reservedV) / 1.75);
    if (w > maxByHeight) w = maxByHeight;
    h = Math.round(w * 1.75);
  }

  // Position labels (Past / Present / Future) are the most important
  // text on the reveal screen — bump them significantly so they read
  // clearly at a glance. Keep them proportional to the card width on
  // narrow phones so they don't overflow.
  const labelFontSize = w < 80 ? 36 : w < 120 ? 44 : 52;
  const labelMaxWidth = Math.max(w + 32, 110);

  return (
    <div
      className="reading-cards-nudge flex flex-nowrap items-end justify-center"
      style={{
        columnGap: `${horizGap}px`,
      }}
      role="list"
    >
      {picks.map((pick, i) => (
        <div
          key={pick.id}
          role="listitem"
          className="flex flex-col items-center gap-1"
        >
          <div
            className="reading-card-frame overflow-hidden rounded-[6px] border border-border/40 bg-card"
            style={{
              width: w,
              height: h,
              boxShadow: "0 4px 14px rgba(0,0,0,0.45)",
            }}
          >
            <img
              src={cardImg(pick.cardIndex)}
              alt={getCardName(pick.cardIndex)}
              className="h-full w-full object-cover"
              loading="eager"
              style={{
                transform: pick.isReversed ? "rotate(180deg)" : undefined,
                transition: "transform 600ms ease-out",
              }}
            />
          </div>
          <span
            className="font-display italic"
            style={{
              fontSize: `calc(${labelFontSize}px * var(--heading-scale, 1))`,
              color: "var(--gold)",
              opacity: showLabels ? labelOpacity : 0,
              letterSpacing: "0.06em",
              maxWidth: labelMaxWidth,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              textAlign: "center",
              transition: "opacity 250ms ease",
              minHeight: labelFontSize + 8,
              marginTop: 6,
              fontWeight: 500,
            }}
          >
            {positionLabels[i] ?? `Card ${i + 1}`}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Reading actions — guide dropdown + "Let Them Speak" button            */
/* ---------------------------------------------------------------------- */

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

  // Load the user's custom guides for the dropdown.
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

  // Close on outside click.
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
      {/* Guide dropdown */}
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

      {/* "Let Them Speak" — flowing-text invocation. No pill, no fill.
          The mist breathes behind the words so the call still feels
          alive without becoming a UI button. */}
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
            fontSize: isLoading ? "var(--text-body-lg)" : "var(--text-heading-md)",
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

/* ---------------------------------------------------------------------- */
/*  Interpretation body — supports long-press text-size slider            */
/* ---------------------------------------------------------------------- */

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
  const meta = SPREAD_META[spread];
  const lensName =
    LENSES.find((l) => l.id === lensId)?.[isOracle ? "oracleName" : "name"] ??
    lensId;
  const facetNames = FACETS.filter((f) => facetIds.includes(f.id)).map(
    (f) => f.name,
  );
  const moonPhase = getCurrentMoonPhase().phase;
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
            fontSize: "var(--text-body-sm)",
            lineHeight: 1.7,
            color: "color-mix(in oklab, var(--foreground) 75%, transparent)",
          }}
        >
          {question && question.trim() && (
            <DisclosureRow label="Question" value={question.trim()} />
          )}
          <DisclosureRow label="Spread" value={meta.label} />
          <DisclosureRow
            label="Cards"
            value={picks
              .map((p, i) => {
                const pos = positionLabels[i] ?? `Card ${i + 1}`;
                return `${getCardName(p.cardIndex)} (${pos})`;
              })
              .join("; ")}
          />
          <DisclosureRow label="Guide" value={guideName} />
          <DisclosureRow label="Lens" value={lensName} />
          {facetNames.length > 0 && (
            <DisclosureRow label="Facets" value={facetNames.join(", ")} />
          )}
          <DisclosureRow label="Moon" value={moonPhase} />
          <DisclosureRow
            label="Memory"
            value="Symbolic threads and patterns (if memory is enabled)"
          />
        </div>
      )}
    </div>
  );
}

function DisclosureRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 py-0.5">
      <span
        className="shrink-0 uppercase not-italic tracking-[0.18em] text-gold/70"
        style={{ fontSize: "var(--text-caption)", letterSpacing: "0.18em", lineHeight: 1.9 }}
      >
        {label}
      </span>
      <span className="flex-1">{value}</span>
    </div>
  );
}

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

  // Body text size scales with the slider; headings stay constant for rhythm.
  const bodySize = size ?? READING_FONT_DEFAULT;

  return (
    <div
      className="reading-fade flex flex-col gap-4"
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
          lineHeight: 1.8,
          color: "var(--foreground)",
        }}
      >
        {stripMarkdown(interpretation.overview)}
      </p>

      <ul className="flex flex-col gap-5">
        {positions.map((p, i) => (
          <li key={i} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <span
                className="font-display"
                style={{
                  fontSize: "var(--text-body)",
                  color: "var(--gold)",
                  letterSpacing: "0.04em",
                }}
              >
                {p.card}
              </span>
              <span
                className="font-display italic"
                style={{
                  fontSize: "var(--text-body)",
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
                lineHeight: 1.8,
                color: "var(--foreground)",
              }}
            >
              {stripMarkdown(p.interpretation)}
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
          lineHeight: 1.8,
          color: "color-mix(in oklab, var(--foreground) 88%, transparent)",
        }}
      >
        {stripMarkdown(interpretation.closing)}
      </p>

      {showSlider && (
        <TextSizeSlider
          value={size}
          onChange={setSize}
          onRelease={scheduleHide}
          onClose={() => setShowSlider(false)}
        />
      )}
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
          fontSize: "var(--text-body)",
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
        className="px-3 py-2 font-display text-xs uppercase tracking-[0.3em] text-gold transition-opacity hover:opacity-80 focus:outline-none focus-visible:underline"
      >
        Done
      </button>
      {/* Dev override — unobtrusive italic link beneath the Done button.
          Bypasses the daily limit on the next interpret call. */}
      <button
        type="button"
        onClick={onSubmitAnyway}
        style={{
          background: "transparent",
          border: "none",
          padding: "4px 8px",
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-body)",
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
          fontSize: "var(--text-body)",
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

function buildCopyText({
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
 * Top-bar copy icon — sits inside TopRightControls' extraStart slot.
 * Briefly flips to a checkmark for 1.5s after a successful copy.
 */
function CopyIconButton({ text }: { text: string }) {
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

/**
 * Bottom copy link — visible flowing-text invitation rendered after the
 * interpretation body. Same copy + checkmark behaviour as the top icon.
 */
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
          fontSize: "var(--text-body)",
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
/* ---------------------------------------------------------------------- */
/*  Share button — uses the Web Share API when available, falls back to   */
/*  clipboard so the seeker always has a way to send the reading out.     */
/* ---------------------------------------------------------------------- */

function ShareReadingButton({
  text,
  isOracle,
}: {
  text: string;
  isOracle: boolean;
}) {
  const [done, setDone] = useState<null | "shared" | "copied" | "error">(null);

  const onShare = async () => {
    if (!text) return;
    try {
      if (
        typeof navigator !== "undefined" &&
        typeof navigator.share === "function"
      ) {
        await navigator.share({
          title: isOracle ? "A reading from Moonseed" : "My tarot reading",
          text,
        });
        setDone("shared");
      } else if (
        typeof navigator !== "undefined" &&
        navigator.clipboard?.writeText
      ) {
        await navigator.clipboard.writeText(text);
        setDone("copied");
      } else {
        setDone("error");
      }
    } catch (e) {
      // User-cancel on Web Share rejects with AbortError — treat as a no-op.
      const name = (e as { name?: string })?.name;
      if (name !== "AbortError") setDone("error");
    } finally {
      window.setTimeout(() => setDone(null), 1800);
    }
  };

  const label = !done
    ? isOracle
      ? "Share this telling"
      : "Share reading"
    : done === "shared"
      ? "Shared"
      : done === "copied"
        ? "Copied to clipboard"
        : "Couldn't share";

  return (
    <button
      type="button"
      onClick={() => void onShare()}
      className="reading-actions-fade-in mt-3 inline-flex items-center justify-center gap-2 self-center font-display text-[12px] italic text-gold transition-opacity"
      style={{
        opacity: "var(--ro-plus-30)",
        background: "transparent",
        border: "none",
        padding: "6px 10px",
      }}
      aria-label={label}
    >
      <Share2 size={14} strokeWidth={1.5} />
      <span>{label}</span>
    </button>
  );
}
