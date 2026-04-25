import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Tabletop } from "@/components/tabletop/Tabletop";
import { SpreadLayout } from "@/components/tabletop/SpreadLayout";
import { isValidSpreadMode, SPREAD_META, type SpreadMode } from "@/lib/spreads";
import { getCardName } from "@/lib/tarot";
import { useStreak } from "@/lib/use-streak";

type Search = { spread?: string };

export const Route = createFileRoute("/draw")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    spread: typeof s.spread === "string" ? s.spread : undefined,
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

  const exit = () => {
    void navigate({ to: "/" });
  };

  if (picks && phase === "reading") {
    return <PlaceholderReading spread={spread} picks={picks} onExit={exit} />;
  }

  if (picks && phase === "cast") {
    return (
      <SpreadLayout
        spread={spread}
        picks={picks}
        onExit={exit}
        onContinue={() => setPhase("reading")}
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

function PlaceholderReading({
  spread,
  picks,
  onExit,
}: {
  spread: SpreadMode;
  picks: { id: number; cardIndex: number }[];
  onExit: () => void;
}) {
  const meta = SPREAD_META[spread];
  return (
    <main className="fixed inset-0 z-40 flex h-[100dvh] w-full flex-col items-center justify-center px-6 text-center">
      <span className="text-[10px] uppercase tracking-[0.3em] text-gold/80">
        {meta.label}
      </span>
      <h1 className="mt-2 font-display text-2xl text-foreground">
        Reading would appear here
      </h1>
      <p className="mt-2 max-w-xs text-sm text-muted-foreground">
        Phase 4 will turn these cards into a full interpretation.
      </p>
      <ul className="mt-8 flex flex-col items-center gap-1.5">
        {picks.map((p, i) => (
          <li key={p.id} className="font-display text-base text-gold">
            <span className="mr-2 text-xs text-gold/60">{i + 1}.</span>
            {getCardName(p.cardIndex)}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onExit}
        className="mt-10 rounded-full border border-gold/50 bg-gold/10 px-6 py-3 font-display text-sm uppercase tracking-[0.25em] text-gold transition-colors hover:bg-gold/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
      >
        Return Home
      </button>
    </main>
  );
}