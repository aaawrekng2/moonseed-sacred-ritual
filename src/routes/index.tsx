import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Flame, RotateCw } from "lucide-react";
import { MoonCarousel } from "@/components/moon/MoonCarousel";
import { CardBack } from "@/components/cards/CardBack";
import { SpreadIconsRow } from "@/components/spreads/SpreadIconsRow";
import { TopRightControls } from "@/components/nav/TopRightControls";
import { useBgGradient } from "@/lib/use-bg-gradient";
import { useRestingOpacity } from "@/lib/use-resting-opacity";
import { getStoredCardBack, type CardBackId } from "@/lib/card-backs";
import { useStreak } from "@/lib/use-streak";

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
  const { currentStreak } = useStreak();

  useEffect(() => {
    setCardBack(getStoredCardBack());
  }, []);

  // Tap-to-refresh: pull-to-refresh was conflicting with the global
  // tap-to-peek gesture (peek wins). A small RotateCw button in the top
  // bar replaces the pull. The icon spins for at least 500ms so the
  // action feels acknowledged before the reload commits.
  const [refreshing, setRefreshing] = useState(false);
  const triggerRefresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    // Minimum spin time so users get visual confirmation.
    setTimeout(() => {
      if (typeof window !== "undefined") window.location.reload();
    }, 500);
  };

  return (
    <main
      className="relative flex h-[100dvh] flex-col overflow-hidden bg-cosmos pb-24"
      style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
    >
      {/* Top-right controls (fixed overlay). Refresh icon injected as the
          first extraStart slot so it sits in the unified row. */}
      <TopRightControls
        extraStart={
          <button
            type="button"
            onClick={triggerRefresh}
            aria-label="Refresh moon and streak"
            disabled={refreshing}
            style={{ opacity: "var(--ro-plus-10)" }}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full text-gold transition-opacity touch-manipulation [-webkit-tap-highlight-color:transparent] hover:!opacity-100 focus:!opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 disabled:cursor-wait"
          >
            <RotateCw
              size={18}
              strokeWidth={1.5}
              aria-hidden="true"
              style={{
                animation: refreshing ? "spin 1s linear infinite" : undefined,
              }}
            />
          </button>
        }
      />

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
            className="gateway-card-frame animate-breathe-glow overflow-hidden rounded-[12px] transition-transform active:scale-[0.98]"
            onClick={() =>
              navigate({ to: "/draw", search: { spread: "daily" } })
            }
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
            aria-label={`Practice streak: ${currentStreak} day${currentStreak === 1 ? "" : "s"}`}
          >
            <Flame
              size={16}
              style={{ color: "var(--gold)", opacity: "var(--ro-plus-20)" }}
            />
            <span
              style={{
                fontSize: "13px",
                color: "var(--gold)",
                opacity: "var(--ro-plus-20)",
                fontFamily: "var(--font-serif)",
              }}
            >
              {currentStreak}
            </span>
          </div>
        </div>
        <p
          className="mt-4 font-display text-[13px] italic"
          style={{ color: "rgba(255,255,255,0.5)", opacity: restingAlpha }}
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
