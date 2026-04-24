import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Flame } from "lucide-react";
import { MoonCarousel } from "@/components/moon/MoonCarousel";
import { CardBack } from "@/components/cards/CardBack";
import { SpreadIconsRow } from "@/components/spreads/SpreadIconsRow";
import { TopRightControls } from "@/components/nav/TopRightControls";
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
    <main
      className="relative flex h-[100dvh] flex-col overflow-hidden pb-24"
      style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
    >
      {/* Top-right controls (fixed overlay) */}
      <TopRightControls />

      {/* Moon strip */}
      <header className="px-2">
        <MoonCarousel />
      </header>

      {/* Streak — quiet, left-aligned, in normal flow between moon strip and card */}
      <div className="my-2 px-6">
        <div
          className="inline-flex items-center gap-1.5 text-gold"
          style={{ opacity: restingAlpha }}
          title="Your practice streak"
          aria-label="Practice streak: 0 days"
        >
          <Flame size={16} strokeWidth={1.6} />
          <span className="font-display text-[13px] leading-none">0</span>
        </div>
      </div>

      {/* Hero gateway card — centered in remaining space */}
      <section className="flex flex-1 flex-col items-center justify-center px-6">
        <div className="relative">
          <button
            type="button"
            aria-label="Begin today's draw"
            className="animate-breathe-glow transition-transform active:scale-[0.98]"
          >
            <CardBack id={cardBack} width={180} />
          </button>
        </div>
        <p
          className="mt-4 font-display text-[13px] italic"
          style={{ color: "rgba(255,255,255,0.5)" }}
        >
          Tap to begin today's draw
        </p>
      </section>

      {/* Spread icons — sit just above bottom nav */}
      <section>
        <SpreadIconsRow />
      </section>
    </main>
  );
}
