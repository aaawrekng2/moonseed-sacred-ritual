import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Tabletop } from "@/components/tabletop/Tabletop";
import { ManualEntryBuilder, type ManualPick } from "@/components/tabletop/ManualEntryBuilder";
import { SpreadLayout } from "@/components/tabletop/SpreadLayout";
import { ReadingScreen } from "@/components/reading/ReadingScreen";
import { isValidSpreadMode, type SpreadMode } from "@/lib/spreads";
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
import { clearTabletopSession } from "@/components/tabletop/config";
import { useFloatingMenu } from "@/lib/floating-menu-context";

type Search = { spread?: string; question?: string; n?: number };

export const Route = createFileRoute("/draw")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    spread: typeof s.spread === "string" ? s.spread : undefined,
    question:
      typeof s.question === "string" && s.question.trim().length > 0 ? s.question : undefined,
    n:
      typeof s.n === "number" && s.n >= 1 && s.n <= 10
        ? Math.round(s.n)
        : undefined,
  }),
  component: DrawPage,
});

function DrawPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const spread: SpreadMode = isValidSpreadMode(search.spread) ? search.spread : "daily";
  const { recordDraw } = useStreak();
  const { user } = useAuth();

  // Q19 — per-spread entry-mode + custom-count memory. Hydrates from
  // localStorage immediately and from user_preferences once authed.
  const { modes, loaded: modesLoaded, setMode, setCustomCount } =
    useSpreadEntryModes(user?.id ?? null);

  // Custom-count: URL `?n=` wins on initial mount; otherwise hydrate
  // from the persisted memory so home → /draw routes land on the
  // seeker's last-used count.
  const [customCount, setCustomCountLocal] = useState<number | undefined>(
    () =>
      spread === "custom"
        ? Math.max(
            1,
            Math.min(10, search.n ?? resolveCountFromMap(modes)),
          )
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
  const [entrySurface, setEntrySurface] = useState<EntryMode>(() =>
    resolveModeFromMap(modes, spread),
  );
  useEffect(() => {
    if (!modesLoaded) return;
    setEntrySurface(resolveModeFromMap(modes, spread));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modesLoaded, spread]);

  // Q19 Fix 8 — cache in-progress manual picks at the route level so
  // toggling Manual → Table → Manual preserves the seeker's selections.
  const [manualPicksCache, setManualPicksCache] = useState<
    (ManualPick | null)[] | undefined
  >(undefined);

  const [picks, setPicks] = useState<
    { id: number; cardIndex: number; isReversed: boolean; deckId?: string | null }[] | null
  >(null);
  // Phase 9.5b — track how the picks were produced so we can persist
  // `entry_mode` ('digital' | 'manual') alongside the saved reading.
  const [entryMode, setEntryMode] = useState<"digital" | "manual">("digital");
  // "reveal" = cards already flipped on the tabletop, jump straight to
  // the placeholder reading. "cast" = render the classic spread layout
  // with cards face-down, let the user reveal them there.
  const [phase, setPhase] = useState<"select" | "cast" | "reading">("select");

  // Q24 Fix 2 — register an exit-to-home X in the FloatingMenu while
  // the seeker is in the card-selection phase. Cleared once cards
  // are cast / revealed so the seeker stays in the reading.
  const { setCloseHandler } = useFloatingMenu();
  useEffect(() => {
    console.log("[draw] close handler effect", { phase });
    if (phase !== "select") {
      console.log("[draw] clearing close handler (phase != select)");
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
  const [procStatus, setProcStatus] = useState<DeckProcessingStatus | null>(
    null,
  );
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
    (procStatus.pending > 0 ||
      procStatus.saved < procStatus.total - procStatus.failed);

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
        .select("show_question_prompt, allow_reversed_cards")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      // 26-05-08-N — Fix 3: show_question_prompt only controls the
      // AUTO-OPEN behaviour. The quill icon is always available so
      // the seeker can write or edit a question on the table.
      const enabled = data?.show_question_prompt === true;
      setQuestionOpen(enabled);
      setAllowReversed(data?.allow_reversed_cards === true);
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
    setEntrySurface("table");
    setMode(spread, "table");
  };
  const handleCustomCountChange = (next: number) => {
    setCustomCountLocal(next);
    setCustomCount(next);
  };

  return (
    <div className="relative h-[100dvh] w-full">
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
          Your deck is still processing. Some cards may appear blank until
          complete.
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
        />
      ) : entrySurface === "manual" && phase === "select" ? (
        <ManualEntryBuilder
          spread={spread}
          customCount={customCount}
          question={question}
          onQuestionChange={setQuestion}
          initialPicks={manualPicksCache}
          onPicksChange={setManualPicksCache}
          onSwitchToTable={switchToTable}
          onCustomCountChange={
            spread === "custom" ? handleCustomCountChange : undefined
          }
          onCancel={exit}
          onComplete={(manualPicks) => {
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
            setPhase("reading");
            void recordDraw();
          }}
        />
      ) : (
        <Tabletop
          spread={spread}
          onExit={exit}
          customCount={customCount}
          question={question}
          onQuestionChange={setQuestion}
          onSwitchToManual={switchToManual}
          onCustomCountChange={
            spread === "custom" ? handleCustomCountChange : undefined
          }
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
              : generateOrientations(p.length, allowReversed);
            setPicks(
              p.map((pick, i) => ({
                ...pick,
                isReversed: orientations[i],
                deckId: pick.deckId ?? null,
              })),
            );
            setEntryMode(isManual ? "manual" : "digital");
            setPhase(mode === "cast" ? "cast" : "reading");
            // Reaching reveal/cast counts as today's practice. Fire-and-forget.
            void recordDraw();
          }}
        />
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
              window.dispatchEvent(new CustomEvent("moonseed:question-modal-closed"));
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
                    window.dispatchEvent(new CustomEvent("moonseed:question-modal-closed"));
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
