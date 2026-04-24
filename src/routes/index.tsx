import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
  const navigate = useNavigate();

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

      {/* Hero gateway card — centered in remaining space */}
      <section className="flex flex-1 flex-col items-center justify-center px-6">
        <div style={{ position: "relative", display: "inline-block" }}>
          <button
            type="button"
            aria-label="Begin today's draw"
            className="animate-breathe-glow transition-transform active:scale-[0.98]"
            onClick={() => navigate({ to: "/draw", search: { spread: "daily" } })}
          >
            <CardBack id={cardBack} width={180} />
          </button>
          <div
            style={{
              position: "absolute",
              bottom: "12px",
              left: "-40px",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
            title="Your practice streak"
            aria-label="Practice streak: 0 days"
          >
            <Flame size={16} style={{ color: "var(--gold)", opacity: restingAlpha }} />
            <span
              style={{
                fontSize: "13px",
                color: "var(--gold)",
                opacity: restingAlpha,
                fontFamily: "var(--font-serif)",
              }}
            >
              0
            </span>
          </div>
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
        <SpreadIconsRow
          onSelect={(spread) =>
            navigate({ to: "/draw", search: { spread } })
          }
        />
      </section>
    </main>
  );
}
