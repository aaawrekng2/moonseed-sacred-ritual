import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Flame } from "lucide-react";
import { MoonCarousel } from "@/components/moon/MoonCarousel";
import { CardBack } from "@/components/cards/CardBack";
import { SpreadIconsRow } from "@/components/spreads/SpreadIconsRow";
import { useBgGradient } from "@/lib/use-bg-gradient";
import { useRestingOpacity } from "@/lib/use-resting-opacity";
import { getStoredCardBack, type CardBackId } from "@/lib/card-backs";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  // Initialize gradient + opacity systems on first mount.
  useBgGradient();
  const { opacity } = useRestingOpacity();
  const restingAlpha = opacity / 100;
  const [cardBack, setCardBack] = useState<CardBackId>("celestial");

  useEffect(() => {
    setCardBack(getStoredCardBack());
  }, []);

  return (
    <main className="relative flex min-h-screen flex-col pb-24">
      {/* Moon strip */}
      <header className="px-2">
        <MoonCarousel />
      </header>

      {/* Streak */}
      <div className="mt-4 flex items-center justify-end px-5">
        <div
          className="flex items-center gap-1.5 text-gold"
          style={{ opacity: restingAlpha }}
        >
          <Flame size={16} strokeWidth={1.6} />
          <span className="font-display text-sm">0</span>
        </div>
      </div>

      {/* Hero gateway card */}
      <section className="flex flex-1 flex-col items-center justify-center px-6">
        <button
          type="button"
          aria-label="Begin today's draw"
          className="animate-pulse-gold rounded-[12px] shadow-glow transition-transform active:scale-[0.98]"
        >
          <CardBack id={cardBack} width={170} />
        </button>
        <p
          className="mt-6 font-display text-base italic text-muted-foreground"
          style={{ opacity: restingAlpha }}
        >
          Tap to begin today's draw
        </p>
      </section>

      {/* Spread icons */}
      <section className="mb-6 mt-2">
        <SpreadIconsRow />
      </section>
    </main>
  );
}
