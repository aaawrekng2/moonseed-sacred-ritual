import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Flame, Loader2 } from "lucide-react";
import { MoonCarousel } from "@/components/moon/MoonCarousel";
import { CardBack } from "@/components/cards/CardBack";
import { SpreadIconsRow } from "@/components/spreads/SpreadIconsRow";
import { TopRightControls } from "@/components/nav/TopRightControls";
import { useBgGradient } from "@/lib/use-bg-gradient";
import {
  useRestingOpacity,
  MIN_RESTING_OPACITY,
  MAX_RESTING_OPACITY,
} from "@/lib/use-resting-opacity";
import { getStoredCardBack, type CardBackId } from "@/lib/card-backs";
import { useStreak } from "@/lib/use-streak";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  // Initialize gradient + opacity systems on first mount.
  useBgGradient();
  const { opacity, setOpacity } = useRestingOpacity();
  const restingAlpha = opacity / 100;
  const [cardBack, setCardBack] = useState<CardBackId>("celestial");
  const navigate = useNavigate();
  const { currentStreak } = useStreak();

  useEffect(() => {
    setCardBack(getStoredCardBack());
  }, []);

  // Pull-to-refresh: track a vertical drag that starts at the very top of
  // the screen and reload once the user pulls past the threshold.
  const PULL_THRESHOLD = 80;
  const pullStartY = useRef<number | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // Hard latch — flips true the instant a refresh is committed and never
  // resets. Guards against re-entrancy from queued touch events, repeated
  // taps, or React batching the `refreshing` state update one frame late.
  const refreshLatchedRef = useRef(false);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    };
  }, []);

  const onTouchStart = (e: React.TouchEvent) => {
    if (refreshing || refreshLatchedRef.current) return;
    const t = e.touches[0];
    // Only arm a pull if the touch starts near the very top edge.
    if (t.clientY <= 40) {
      pullStartY.current = t.clientY;
    } else {
      pullStartY.current = null;
    }
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (pullStartY.current == null || refreshing || refreshLatchedRef.current) return;
    const dy = e.touches[0].clientY - pullStartY.current;
    if (dy > 0) {
      // Resistance curve so it feels rubbery.
      setPullDistance(Math.min(120, dy * 0.5));
    }
  };
  const onTouchEnd = () => {
    if (pullStartY.current == null) return;
    pullStartY.current = null;
    if (refreshLatchedRef.current) {
      setPullDistance(0);
      return;
    }
    if (pullDistance >= PULL_THRESHOLD) {
      // Latch synchronously — any touch event already queued behind this
      // one will see the latch and bail before re-entering.
      refreshLatchedRef.current = true;
      setRefreshing(true);
      setPullDistance(60);
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = setTimeout(() => {
        if (typeof window !== "undefined") window.location.reload();
      }, 400);
    } else {
      setPullDistance(0);
    }
  };

  return (
    <main
      className="relative flex h-[100dvh] flex-col overflow-hidden bg-cosmos pb-24"
      style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Pull-to-refresh indicator */}
      {(pullDistance > 0 || refreshing) && (
        <div
          aria-hidden={!refreshing}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            height: pullDistance,
            pointerEvents: "none",
            zIndex: 30,
            transition: pullStartY.current == null ? "height 200ms ease" : undefined,
          }}
        >
          <Loader2
            size={20}
            style={{
              color: "var(--gold)",
              opacity: Math.min(1, pullDistance / PULL_THRESHOLD),
              animation: refreshing ? "spin 1s linear infinite" : undefined,
              transform: refreshing
                ? undefined
                : `rotate(${(pullDistance / PULL_THRESHOLD) * 360}deg)`,
            }}
          />
        </div>
      )}

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
            className="gateway-card-frame animate-breathe-glow overflow-hidden rounded-[12px] transition-transform active:scale-[0.98]"
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
            aria-label={`Practice streak: ${currentStreak} day${currentStreak === 1 ? "" : "s"}`}
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
        {/* Temporary resting-opacity test slider */}
        <div
          style={{
            position: "absolute",
            left: 12,
            bottom: 110,
            display: "flex",
            flexDirection: "column",
            gap: 4,
            width: 140,
            zIndex: 20,
          }}
        >
          <label
            htmlFor="resting-opacity-slider"
            style={{
              fontSize: 10,
              color: "var(--gold)",
              opacity: 0.7,
              fontFamily: "var(--font-serif)",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            Opacity {opacity}
          </label>
          <input
            id="resting-opacity-slider"
            type="range"
            min={MIN_RESTING_OPACITY}
            max={MAX_RESTING_OPACITY}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
            style={{ width: "100%", accentColor: "var(--gold)" }}
          />
        </div>
        <SpreadIconsRow
          onSelect={(spread) =>
            navigate({ to: "/draw", search: { spread } })
          }
        />
      </section>
    </main>
  );
}
