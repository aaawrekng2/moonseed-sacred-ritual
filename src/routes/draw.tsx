import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Tabletop } from "@/components/tabletop/Tabletop";
import { SpreadLayout } from "@/components/tabletop/SpreadLayout";
import { ReadingScreen } from "@/components/reading/ReadingScreen";
import { isValidSpreadMode, type SpreadMode } from "@/lib/spreads";
import { useStreak } from "@/lib/use-streak";
import { QuestionPanel } from "@/components/draw/QuestionPanel";

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

  const [picks, setPicks] = useState<{ id: number; cardIndex: number }[] | null>(null);
  // "reveal" = cards already flipped on the tabletop, jump straight to
  // the placeholder reading. "cast" = render the classic spread layout
  // with cards face-down, let the user reveal them there.
  const [phase, setPhase] = useState<"select" | "cast" | "reading">("select");

  // The question now lives on the draw table itself so the seeker can
  // write or revise it without bouncing back to the home screen. We
  // seed from the URL search param when arriving from a legacy entry
  // point that still passes `?question=…`.
  const [question, setQuestion] = useState<string>(search.question ?? "");
  // Question panel starts open so the seeker is greeted by the prompt
  // the moment the table appears; the close (X / Skip / Continue)
  // collapses it to a quill icon they can re-tap any time.
  const [questionOpen, setQuestionOpen] = useState(true);

  const exit = () => {
    void navigate({ to: "/" });
  };

  // The reading screen has its own question-pinning UI, so the
  // floating QuestionPanel only belongs to the select/cast phases.
  if (picks && phase === "reading") {
    return (
      <ReadingScreen spread={spread} picks={picks} onExit={exit} question={question || undefined} />
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
        />
      ) : (
        <Tabletop
          spread={spread}
          onExit={exit}
          onComplete={(p, mode) => {
            setPicks(p);
            setPhase(mode === "cast" ? "cast" : "reading");
            // Reaching reveal/cast counts as today's practice. Fire-and-forget.
            void recordDraw();
          }}
        />
      )}

      {/* Quill / question panel only belongs to the draw table phase.
          Once the seeker advances to "cast" (cards face-down on the
          spread layout) or "reading", the table is gone — and so the
          quill should be too. */}
      {phase === "select" && (
        <QuestionPanel
          open={questionOpen}
          question={question}
          onQuestionChange={setQuestion}
          onClose={() => setQuestionOpen(false)}
          onOpen={() => setQuestionOpen(true)}
        />
      )}
    </div>
  );
}
