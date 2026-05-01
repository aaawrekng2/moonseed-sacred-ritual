import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Tabletop } from "@/components/tabletop/Tabletop";
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

type Search = { spread?: string; question?: string };

export const Route = createFileRoute("/draw")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    spread: typeof s.spread === "string" ? s.spread : undefined,
    question:
      typeof s.question === "string" && s.question.trim().length > 0 ? s.question : undefined,
  }),
  component: DrawPage,
});

function DrawPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const spread: SpreadMode = isValidSpreadMode(search.spread) ? search.spread : "daily";
  const { recordDraw } = useStreak();

  const [picks, setPicks] = useState<
    { id: number; cardIndex: number; isReversed: boolean }[] | null
  >(null);
  // Phase 9.5b — track how the picks were produced so we can persist
  // `entry_mode` ('digital' | 'manual') alongside the saved reading.
  const [entryMode, setEntryMode] = useState<"digital" | "manual">("digital");
  // "reveal" = cards already flipped on the tabletop, jump straight to
  // the placeholder reading. "cast" = render the classic spread layout
  // with cards face-down, let the user reveal them there.
  const [phase, setPhase] = useState<"select" | "cast" | "reading">("select");

  // The question now lives on the draw table itself so the seeker can
  // write or revise it without bouncing back to the home screen. We
  // seed from the URL search param when arriving from a legacy entry
  // point that still passes `?question=…`.
  const [question, setQuestion] = useState<string>(search.question ?? "");
  const { user } = useAuth();
  // Gate the entire QuestionPanel on the seeker's preference. We must
  // wait for the preference to load before mounting anything — otherwise
  // the card flashes open for users who have turned it off. Once loaded:
  //   - showQuestionPrompt === true  → render the expanded card
  //   - showQuestionPrompt === false → render nothing (no quill either)
  // "Skip" / "Don't ask again" within the session also hide the panel
  // entirely so the quill can't reappear after the seeker dismissed it.
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [showQuestionPrompt, setShowQuestionPrompt] = useState(false);
  const [questionOpen, setQuestionOpen] = useState(false);
  const [sessionDismissed, setSessionDismissed] = useState(false);
  // Phase 9.55 — opt-in reversed cards. Default false (upright-only) so
  // beginners are never thrown into reversal complexity unprompted.
  const [allowReversed, setAllowReversed] = useState(false);
  // Phase 9.5b — the seeker's currently active custom deck (if any).
  // Threaded into saved readings as `deck_id` so historical readings
  // always render with the artwork they were created from (Stamp AV).
  const { activeDeck } = useActiveDeck();
  const activeDeckId = activeDeck?.id ?? null;

  useEffect(() => {
    if (!user) {
      // Anonymous: default to the prompt being on.
      setShowQuestionPrompt(true);
      setQuestionOpen(true);
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
      // Only open if the seeker has explicitly opted in. Default
      // (missing row, null, or false) keeps the card closed so it
      // never flashes for users who turned it off.
      const enabled = data?.show_question_prompt === true;
      setShowQuestionPrompt(enabled);
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

  return (
    <div className="relative h-[100dvh] w-full">
      {picks && phase === "cast" ? (
        <SpreadLayout
          spread={spread}
          picks={picks}
          onExit={exit}
          onContinue={() => setPhase("reading")}
          question={question || undefined}
          entryMode={entryMode}
          deckId={activeDeckId}
        />
      ) : (
        <Tabletop
          spread={spread}
          onExit={exit}
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
              p.map((pick, i) => ({ ...pick, isReversed: orientations[i] })),
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
      {phase === "select" && prefsLoaded && showQuestionPrompt && !sessionDismissed && (
        <QuestionPanel
          open={questionOpen}
          question={question}
          onQuestionChange={setQuestion}
          onClose={() => {
            setQuestionOpen(false);
            // A close (X / Skip / Continue) hides the quill for the
            // session — it should not reappear until the seeker
            // returns to the table.
            setSessionDismissed(true);
          }}
          onOpen={() => setQuestionOpen(true)}
          onDontAskAgain={
            user
              ? () => {
                  void updateUserPreferences(user.id, {
                    show_question_prompt: false,
                  });
                  setShowQuestionPrompt(false);
                  setSessionDismissed(true);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
