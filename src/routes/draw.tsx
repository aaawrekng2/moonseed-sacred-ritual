import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Tabletop } from "@/components/tabletop/Tabletop";
import { SpreadLayout } from "@/components/tabletop/SpreadLayout";
import { ReadingScreen } from "@/components/reading/ReadingScreen";
import { isValidSpreadMode, type SpreadMode } from "@/lib/spreads";
import { useStreak } from "@/lib/use-streak";

type Search = { spread?: string; question?: string };

export const Route = createFileRoute("/draw")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    spread: typeof s.spread === "string" ? s.spread : undefined,
    question:
      typeof s.question === "string" && s.question.trim().length > 0
        ? s.question
        : undefined,
  }),
  component: DrawPage,
});

function DrawPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const spread: SpreadMode = isValidSpreadMode(search.spread) ? search.spread : "daily";
  const question = search.question;
  const { recordDraw } = useStreak();

  const [picks, setPicks] = useState<{ id: number; cardIndex: number }[] | null>(null);
  // "reveal" = cards already flipped on the tabletop, jump straight to
  // the placeholder reading. "cast" = render the classic spread layout
  // with cards face-down, let the user reveal them there.
  const [phase, setPhase] = useState<"select" | "cast" | "reading">("select");

  const exit = () => {
    void navigate({ to: "/" });
  };

  if (picks && phase === "reading") {
    return (
      <ReadingScreen
        spread={spread}
        picks={picks}
        onExit={exit}
        question={question}
      />
    );
  }

  if (picks && phase === "cast") {
    return (
      <SpreadLayout
        spread={spread}
        picks={picks}
        onExit={exit}
        onContinue={() => setPhase("reading")}
        question={question}
      />
    );
  }

  return (
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
  );
}