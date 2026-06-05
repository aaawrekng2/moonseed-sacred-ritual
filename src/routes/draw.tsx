import { createFileRoute, useNavigate, ClientOnly } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Tabletop } from "@/components/tabletop/Tabletop";
import { ManualEntryBuilder, type ManualPick } from "@/components/tabletop/ManualEntryBuilder";
import { ConstellationPage } from "@/components/constellation/ConstellationPage";
import { RotatePrompt } from "@/components/tabletop/RotatePrompt";
import { useViewport } from "@/lib/use-viewport";
import { SpreadLayout } from "@/components/tabletop/SpreadLayout";
import { ReadingScreen } from "@/components/reading/ReadingScreen";
import { isValidSpreadMode, getSpreadCount, type SpreadMode } from "@/lib/spreads";
import { useStreak } from "@/lib/use-streak";
import { QuestionPanel } from "@/components/draw/QuestionPanel";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { updateUserPreferences } from "@/lib/user-preferences-write";
import { generateOrientations } from "@/lib/tarot-mechanics";
import { useActiveDeck } from "@/lib/active-deck";
import { fetchDeckProcessingStatus, type DeckProcessingStatus } from "@/lib/custom-decks";
import {
  useSpreadEntryModes,
  resolveModeFromMap,
  resolveCountFromMap,
  type EntryMode,
} from "@/lib/use-spread-entry-modes";
import {
  clearTabletopSession,
  readTabletopSession,
  writeTabletopSession,
} from "@/components/tabletop/config";
import type { TabletopSession } from "@/components/tabletop/types";
import { useFloatingMenu } from "@/lib/floating-menu-context";
import { useShowLabels } from "@/lib/use-show-labels";

type Search = { spread?: string; question?: string; n?: number; entry?: EntryMode };

export const Route = createFileRoute("/draw")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    spread: typeof s.spread === "string" ? s.spread : undefined,
    question:
      typeof s.question === "string" && s.question.trim().length > 0 ? s.question : undefined,
    n: typeof s.n === "number" && s.n >= 1 && s.n <= 10 ? Math.round(s.n) : undefined,
    // EJ63 — Optional ?entry=table|manual hint passed by Home (and any
    // other surface that wants to force the initial entry mode). When
    // present, overrides the seeker's saved per-spread preference for
    // THIS arrival. Subsequent toggle clicks still flip the mode
    // normally and persist back to user_preferences.
    entry: s.entry === "table" || s.entry === "manual" ? (s.entry as EntryMode) : undefined,
  }),
  component: DrawPage,
});

function DrawPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const spread: SpreadMode = isValidSpreadMode(search.spread) ? search.spread : "daily";
  const { recordDraw, recomputeStreak } = useStreak();
  const { user } = useAuth();

  // Q19 — per-spread entry-mode + custom-count memory. Hydrates from
  // localStorage immediately and from user_preferences once authed.
  const {
    modes,
    loaded: modesLoaded,
    setMode,
    setCustomCount,
  } = useSpreadEntryModes(user?.id ?? null);

  // Custom-count: URL `?n=` wins on initial mount; otherwise hydrate
  // from the persisted memory so home → /draw routes land on the
  // seeker's last-used count.
  const [customCount, setCustomCountLocal] = useState<number | undefined>(() =>
    spread === "custom"
      ? Math.max(1, Math.min(10, search.n ?? resolveCountFromMap(modes)))
      : undefined,
  );
  useEffect(() => {
    if (spread !== "custom") return;
    if (search.n !== undefined) return; // explicit URL wins
    if (!modesLoaded) return;
    const next = resolveCountFromMap(modes);
    setCustomCountLocal((cur) => (cur === next ? cur : next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modesLoaded, spread]);

  // Q19 — entry mode (table | manual) lifted out of Tabletop so the
  // toggle can flip surfaces mid-draw without losing state.
  // EJ63 — `?entry=table|manual` search param overrides the saved
  // per-spread mode on initial mount. Used by Home to force the table
  // surface as the canonical landing for fresh draws. Once mounted,
  // the toggle still flips and persists normally.
  const [entrySurface, setEntrySurface] = useState<EntryMode>(() =>
    search.entry ?? resolveModeFromMap(modes, spread),
  );
  useEffect(() => {
    if (!modesLoaded) return;
    // After modes load, honor the URL hint if present; otherwise the
    // saved mode wins.
    setEntrySurface(search.entry ?? resolveModeFromMap(modes, spread));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modesLoaded, spread, search.entry]);

  // Q19 Fix 8 — cache in-progress manual picks at the route level so
  // toggling Manual → Table → Manual preserves the seeker's selections.
  const [manualPicksCache, setManualPicksCache] = useState<(ManualPick | null)[] | undefined>(
    undefined,
  );

  const viewport = useViewport();

  const [picks, setPicks] = useState<
    { id: number; cardIndex: number; isReversed: boolean; deckId?: string | null }[] | null
  >(null);
  // Phase 9.5b — track how the picks were produced so we can persist
  // `entry_mode` ('digital' | 'manual') alongside the saved reading.
  const [entryMode, setEntryMode] = useState<"digital" | "manual">("digital");
  // Q79 — optional backdate set via ManualEntryBuilder; threaded into
  // ReadingScreen so the inserted readings row + interpret call carry
  // the chosen created_at.
  const [backdatedAt, setBackdatedAt] = useState<string | undefined>(undefined);
  // "reveal" = cards already flipped on the tabletop, jump straight to
  // the placeholder reading. "cast" = render the classic spread layout
  // with cards face-down, let the user reveal them there.
  const [phase, setPhase] = useState<"select" | "cast" | "reading">("select");
  // EK16 — Slot-origin rects captured by Tabletop at handoff. Threaded
  // into SpreadLayout so its cards animate FROM the slot positions TO
  // their final spread positions, instead of teleport-emerging from
  // screen center. Null for manual entry (no slot phase) or any code
  // path that doesn't capture them — SpreadLayout falls back to the
  // pre-EK16 center-emerge animation in that case.
  const [castOriginRects, setCastOriginRects] = useState<
    { x: number; y: number; width: number; height: number }[] | null
  >(null);

  // Q24 Fix 2 — register an exit-to-home X in the FloatingMenu while
  // the seeker is in the card-selection phase. Cleared once cards
  // are cast / revealed so the seeker stays in the reading.
  const { setCloseHandler } = useFloatingMenu();
  useEffect(() => {
    console.log("[draw] close handler effect", { phase });
    // Q27 Fix 5 — register close handler for ANY draw phase except
    // "reading" (which has its own X via ReadingScreen). Previous
    // gate on phase==="select" caused the X to disappear when
    // Custom remounted intermediate components.
    if (phase === "reading") {
      console.log("[draw] clearing close handler (phase=reading)");
      setCloseHandler(null);
      return;
    }
    console.log("[draw] registering exit-to-home close handler");
    setCloseHandler(() => () => {
      console.log("[draw] close handler invoked");
      void navigate({ to: "/" });
    });
    return () => {
      console.log("[draw] cleanup: clearing close handler");
      setCloseHandler(null);
    };
  }, [phase, setCloseHandler, navigate]);

  // The question now lives on the draw table itself so the seeker can
  // write or revise it without bouncing back to the home screen. We
  // seed from the URL search param when arriving from a legacy entry
  // point that still passes `?question=…`.
  const [question, setQuestion] = useState<string>(search.question ?? "");

  // Phase 20 Fix 13 — accept handoff from /constellation. Seed manual picks,
  // question, and backdate so the seeker lands in the manual surface ready
  // to hit "Get Reading" again with the same cards already in place.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.sessionStorage.getItem("tarotseed:constellation-handoff");
      if (!raw) return;
      window.sessionStorage.removeItem("tarotseed:constellation-handoff");
      const payload = JSON.parse(raw) as {
        picks: ManualPick[];
        question?: string;
        backdateISO?: string | null;
      };
      if (Array.isArray(payload.picks) && payload.picks.length > 0) {
        setManualPicksCache(payload.picks);
        setEntrySurface("manual");
      }
      if (payload.question) setQuestion(payload.question);
      if (payload.backdateISO) setBackdatedAt(payload.backdateISO);
    } catch {
      /* malformed payload — ignore */
    }
  }, []);
  // Gate the entire QuestionPanel on the seeker's preference. We must
  // wait for the preference to load before mounting anything — otherwise
  // the card flashes open for users who have turned it off. Once loaded:
  //   - showQuestionPrompt === true  → render the expanded card
  //   - showQuestionPrompt === false → render nothing (no quill either)
  // "Skip" / "Don't ask again" within the session also hide the panel
  // entirely so the quill can't reappear after the seeker dismissed it.
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [questionOpen, setQuestionOpen] = useState(false);
  const [sessionDismissed, setSessionDismissed] = useState(false);
  // Phase 9.55 — opt-in reversed cards. Default false (upright-only) so
  // beginners are never thrown into reversal complexity unprompted.
  const [allowReversed, setAllowReversed] = useState(false);
  // EJ47 — per-seeker reversal probability (1..99). Default 50.
  const [reversalChancePct, setReversalChancePct] = useState<number>(50);
  // Phase 9.5b — the seeker's currently active custom deck (if any).
  // Threaded into saved readings as `deck_id` so historical readings
  // always render with the artwork they were created from (Stamp AV).
  const { activeDeck, refresh: refreshActiveDeck } = useActiveDeck();
  const activeDeckId = activeDeck?.id ?? null;

  // 26-05-08-L — Fix 4: re-sign deck image URLs on draw mount so the
  // seeker never lands on a draw screen with stale/expired URLs.
  useEffect(() => {
    void refreshActiveDeck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 26-05-08-M — Fix 4: non-blocking warning when active custom deck
  // is still processing (some images may render blank).
  const [procStatus, setProcStatus] = useState<DeckProcessingStatus | null>(null);
  useEffect(() => {
    if (!activeDeck) {
      setProcStatus(null);
      return;
    }
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    const tick = async () => {
      const expected = activeDeck.deck_type === "oracle" ? 0 : 78;
      if (expected === 0) return;
      const s = await fetchDeckProcessingStatus(activeDeck.id, expected);
      if (cancelled) return;
      setProcStatus(s);
      if (s.isComplete && interval) {
        clearInterval(interval);
        interval = null;
      }
    };
    void tick();
    interval = setInterval(tick, 8000);
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [activeDeck]);
  const showProcessingBanner =
    activeDeck !== null &&
    procStatus !== null &&
    !procStatus.isComplete &&
    (procStatus.pending > 0 || procStatus.saved < procStatus.total - procStatus.failed);

  useEffect(() => {
    if (!user) {
      // CL Group 6 — Anonymous: quill is always available (Fix 3); do
      // NOT auto-open the expanded box. The seeker taps the quill.
      setQuestionOpen(false);
      setPrefsLoaded(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("user_preferences")
        .select("show_question_prompt, allow_reversed_cards, reversal_chance_pct")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      // 26-05-08-N — Fix 3: show_question_prompt only controls the
      // AUTO-OPEN behaviour. The quill icon is always available so
      // the seeker can write or edit a question on the table.
      const enabled = data?.show_question_prompt === true;
      setQuestionOpen(enabled);
      setAllowReversed(data?.allow_reversed_cards === true);
      // EJ47 — read the seeker's reversal-chance preference (1..99).
      // Default 50 if unset or invalid. Passed to generateOrientations
      // below.
      const rcRaw = (data as { reversal_chance_pct?: number | null } | null)?.reversal_chance_pct;
      const rc =
        typeof rcRaw === "number" && Number.isFinite(rcRaw)
          ? Math.max(1, Math.min(99, Math.round(rcRaw)))
          : 50;
      setReversalChancePct(rc);
      setPrefsLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const exit = () => {
    void navigate({ to: "/" });
  };

  // The reading screen has its own question-pinning UI, so the
  // floating QuestionPanel only belongs to the select/cast phases.
  if (picks && phase === "reading") {
    return (
      <ReadingScreen
        spread={spread}
        picks={picks}
        onExit={exit}
        question={question || undefined}
        entryMode={entryMode}
        deckId={activeDeckId}
        createdAt={backdatedAt}
      />
    );
  }

  // Q19 — surface toggles. Manual ↔ Table swaps the rendered builder
  // and persists the choice for next time. Table cards keep their
  // session via the existing tabletopSessions map; manual picks
  // survive via the route-level cache below.
  const switchToManual = () => {
    setEntrySurface("manual");
    setMode(spread, "manual");
  };
  const switchToTable = () => {
    // Q33b Fix 4 — defer entrySurface flip a frame so Tabletop mounts
    // into a settled DOM and its RAF measurement loop sees real sizes.
    setMode(spread, "table");
    if (typeof window !== "undefined") {
      requestAnimationFrame(() => setEntrySurface("table"));
    } else {
      setEntrySurface("table");
    }
  };
  const handleCustomCountChange = (next: number) => {
    setCustomCountLocal(next);
    setCustomCount(next);
  };

  // EJ69/EJ70 — Spread picker handler. Called by the SpreadPicker
  // dropdown on the Tabletop. "none" hides position labels without
  // changing the slot count. A named spread navigates to /draw with the
  // new spread. EJ70: picks are PRESERVED across the switch — the current
  // spread's session is carried into the new spread's key, with selections
  // beyond the new slot count trimmed back to the scatter (so growing
  // keeps everything, shrinking drops only the overflow after the
  // SpreadPicker's confirm dialog).
  const { setShowLabels } = useShowLabels();
  const handleSpreadChange = (next: SpreadMode | "none") => {
    if (next === "none") {
      // Keep slot count; just hide labels. Picks remain in place.
      setShowLabels(false);
      return;
    }
    // Any named spread restores label visibility.
    setShowLabels(true);
    if (next === spread) return;
    // Carry the current spread's session into the new spread so picks
    // survive the navigation. Trim selections that exceed the new slot
    // count back into the scatter (selectionOrder cleared).
    const prevSession = readTabletopSession(spread);
    if (prevSession) {
      const nextCount =
        next === "custom" ? customCount : getSpreadCount(next);
      const carried: TabletopSession = {
        cards: prevSession.cards.map((c) =>
          c.selectionOrder !== null && c.selectionOrder > nextCount
            ? { ...c, selectionOrder: null }
            : c,
        ),
        // Undo/redo history doesn't map cleanly across spread shapes;
        // start fresh so an undo can't restore a slot that no longer
        // exists.
        undoStack: [],
        redoStack: [],
      };
      writeTabletopSession(next, carried);
    }
    navigate({
      to: "/draw",
      search: {
        spread: next,
        entry: "table" as EntryMode,
        ...(question ? { question } : {}),
      },
    });
  };

  return (
    <div className="bg-cosmos relative h-[100dvh] w-full">
      {/* EK36 — bg-cosmos on the route wrapper, not just Tabletop. The
          wrapper sits behind both Tabletop (fixed inset-0 z-30) and
          SpreadLayout (fixed inset-0 z-40, max-width 1280px centered).
          When Tabletop unmounts during phase change to "cast", there
          was a brief frame where neither wrapper covered the viewport
          and the body's dark background showed through (manifesting as
          a black flash). Then SpreadLayout mounted with its 1280px
          constraint, leaving the sides of wide monitors uncovered (the
          "narrower width" Cori reported). With bg-cosmos on this
          wrapper, the gradient never disappears: it shows during the
          phase swap AND in the side gutters on wide viewports. */}
      {showProcessingBanner && phase === "select" && (
        <div
          className="pointer-events-none absolute left-1/2 top-2 z-40 max-w-[92%] -translate-x-1/2 px-3 py-2 text-center"
          style={{
            background: "var(--surface-card)",
            borderLeft: "3px solid var(--gold)",
            borderRadius: 8,
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-caption, 0.75rem)",
            color: "var(--color-foreground)",
            opacity: 0.9,
          }}
        >
          Your deck is still processing. Some cards may appear blank until complete.
        </div>
      )}
      {picks && phase === "cast" ? (
        <SpreadLayout
          spread={spread}
          picks={picks}
          onExit={exit}
          onContinue={() => setPhase("reading")}
          question={question || undefined}
          entryMode={entryMode}
          deckId={activeDeckId}
          customCount={customCount}
          // EK16 — Origin rects for the shared-element transition. When
          // present, SpreadLayout animates each card FROM its slot
          // position to its spread position instead of using the
          // center-emerge default.
          fromSlotRects={castOriginRects}
        />
      ) : entrySurface === "manual" && phase === "select" ? (
        (() => {
          const sharedProps = {
            spread,
            customCount,
            question,
            onQuestionChange: setQuestion,
            initialPicks: manualPicksCache,
            onPicksChange: setManualPicksCache,
            onSwitchToTable: switchToTable,
            onCustomCountChange: spread === "custom" ? handleCustomCountChange : undefined,
            // EK05 — Surface spread switching in manual entry too. Same
            // handler the Tabletop uses; the inline SpreadPicker chevron
            // appears alongside the count display.
            onSpreadChange: handleSpreadChange,
            onCancel: exit,
            onComplete: (manualPicks: ManualPick[], meta?: { createdAt?: string }) => {
              clearTabletopSession(spread);
              setManualPicksCache(undefined);
              const mapped = manualPicks.map((p) => ({
                id: p.id,
                cardIndex: p.cardIndex,
                isReversed: p.isReversed,
                deckId: p.deckId ?? null,
              }));
              setPicks(mapped);
              setEntryMode("manual");
              setBackdatedAt(meta?.createdAt);
              setPhase("reading");
              // Q93 #7 — Backdated entries can't be modelled by recordDraw
              // (which assumes today); replay full timeline instead.
              if (meta?.createdAt) {
                void recomputeStreak();
              } else {
                void recordDraw();
              }
            },
          };
          // ED — gate the viewport-based branch on viewport.mounted.
          // Before mount, server-render and client-pre-effect both see
          // the same placeholder state, so React renders ManualEntryBuilder
          // on both sides → no hydration mismatch. After the first effect
          // fires, viewport.mounted flips true and the correct branch
          // re-renders in a regular update (not hydration). This
          // eliminates the React error #418 that was cascading into a
          // ReferenceError in ConstellationPage's bundled chunk.
          if (!viewport.mounted) return <ManualEntryBuilder {...sharedProps} />;
          const isDesktopLandscape = viewport.width >= 1024 && viewport.isLandscape;
          const isDesktopPortrait = viewport.width >= 1024 && !viewport.isLandscape;
          // EJ63 — Pass `onSwitchToTable` so the EntryModeToggle
          // (Draw button upper-left) actually flips entrySurface
          // instead of trying to navigate to /draw (where we already
          // are). Without this prop, ConstellationPage falls back to
          // a navigate() that becomes a no-op because the route
          // doesn't change.
          if (isDesktopLandscape)
            return <ConstellationPage onSwitchToTable={switchToTable} />;
          if (isDesktopPortrait) return <RotatePrompt />;
          return <ManualEntryBuilder {...sharedProps} />;
        })()
      ) : (
        <ClientOnly fallback={null}>
          {/* EK11 — Wrap Tabletop in TanStack Router's ClientOnly to
              suppress ALL SSR rendering of this subtree. EK09's
              `webShareAvailable` useMemo was one source of hydration
              mismatch (fixed in EK10), but the React #418 error persisted
              after EK10 — meaning Tabletop has at least one OTHER
              SSR-mismatch source we haven't pinned down (could be in
              TopNav, FloatingMenu, the scatter geometry, any browser-
              only state read at render time, etc.). Each round of
              hydration failure caused React to discard the tree and
              re-render fresh on the client, which kept tearing down
              the snapshot effect's lifecycle — the in-flight
              generation was cancelled by the cleanup on each remount,
              so the snapshot never completed and the popup never
              appeared.

              TanStack Start's official guidance for this exact
              situation is "Wrap unstable UI in <ClientOnly> to avoid
              SSR and mismatches" (per tanstack.com/start docs,
              "Hydration Errors" page). The fallback={null} means the
              server emits empty HTML for this subtree; the client
              hydrates that as empty too (matching, no mismatch); then
              the effect-driven hydration check inside ClientOnly flips
              true and the full Tabletop renders fresh, exactly once,
              client-side only. The snapshot effect now runs on a
              stable mount with no churn. */}
          <Tabletop
            spread={spread}
            onExit={exit}
            customCount={customCount}
            question={question}
            onQuestionChange={setQuestion}
            onSwitchToManual={switchToManual}
            onSpreadChange={handleSpreadChange}
            onOpenQuestion={() => setQuestionOpen(true)}
            onCustomCountChange={spread === "custom" ? handleCustomCountChange : undefined}
            onComplete={(p, mode, meta) => {
              // Phase 9.55 — assign orientation per card based on the
              // seeker's preference. `generateOrientations` returns
              // all-false when reversals are disabled, so this is safe to
              // call unconditionally.
              // For manually-entered readings the seeker has already
              // declared each card's orientation (via the picker's
              // 'Reversed?' toggle), so we honor `pick.isReversed`
              // verbatim and skip the random generator.
              const isManual = meta?.entryMode === "manual";
              const orientations = isManual
                ? p.map((pp) => pp.isReversed ?? false)
                : generateOrientations(p.length, allowReversed, reversalChancePct);
              setPicks(
                p.map((pick, i) => ({
                  ...pick,
                  isReversed: orientations[i],
                  deckId: pick.deckId ?? null,
                })),
              );
              setEntryMode(isManual ? "manual" : "digital");
              // EK16 — Capture slot rects for shared-element transition.
              // Manual entry sends meta without slotOrigins → null,
              // SpreadLayout falls back to its default emerge animation.
              setCastOriginRects(meta?.slotOrigins ?? null);
              setPhase(mode === "cast" ? "cast" : "reading");
              // Reaching reveal/cast counts as today's practice. Fire-and-forget.
              void recordDraw();
            }}
          />
        </ClientOnly>
      )}

      {/* Quill / question panel only belongs to the draw table phase.
          Once the seeker advances to "cast" or "reading", the table is
          gone — and so the quill should be too. We also gate on the
          loaded preference so the card never flashes for users who have
          it disabled, and on `sessionDismissed` so Skip / "Don't ask
          again" hides the quill for the rest of the session. */}
      {phase === "select" && prefsLoaded && !sessionDismissed && (
        <QuestionPanel
          open={questionOpen}
          question={question}
          onQuestionChange={setQuestion}
          onClose={() => {
            setQuestionOpen(false);
            // 26-05-08-N — Fix 3: closing collapses the panel back to
            // the quill icon so the seeker can re-open it any time.
            // Only "Don't ask again" hides the quill for this session.
            // DY-4 — fire chained-trigger event for the manual-draw hint.
            try {
              window.dispatchEvent(new CustomEvent("tarotseed:question-modal-closed"));
            } catch {
              /* SSR / CustomEvent unavailable */
            }
          }}
          onOpen={() => setQuestionOpen(true)}
          onDontAskAgain={
            user
              ? () => {
                  void updateUserPreferences(user.id, {
                    show_question_prompt: false,
                  });
                  setSessionDismissed(true);
                  try {
                    window.dispatchEvent(new CustomEvent("tarotseed:question-modal-closed"));
                  } catch {
                    /* ignore */
                  }
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
