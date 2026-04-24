import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import {
  findNearestPhaseOccurrence,
  getCurrentMoonPhase,
  getMoonSign,
  type MoonInfo,
  type MoonPhaseName,
} from "@/lib/moon";
import { MoonPhaseIcon } from "./MoonPhaseIcon";
import { cn } from "@/lib/utils";
import { useRestingOpacity } from "@/lib/use-resting-opacity";

// Moonseed-native accent resolver — reads --gold from active CSS theme.
// Replaces Arcana's useReadingModeColorResolver until Phase 3 theme system is wired.
function useMoonseedAccent(): string {
  const [accent, setAccent] = useState("#f1ba4b");
  useEffect(() => {
    const update = () => {
      const v = getComputedStyle(document.documentElement)
        .getPropertyValue("--gold").trim();
      if (v) setAccent(v.startsWith("#") ? v : `oklch(${v})`);
    };
    update();
    window.addEventListener("arcana:bg-gradient-changed", update);
    return () => window.removeEventListener("arcana:bg-gradient-changed", update);
  }, []);
  return accent;
}

type DayCell = {
  info: MoonInfo;
  isToday: boolean;
  relative: number;
  sign: string;
};

export function MoonCarousel() {
  const [offset, setOffset] = useState(0);
  const [expandedRel, setExpandedRel] = useState<number | null>(null);
  // Day card the user has explicitly tapped to "select". Stored as the
  // absolute relative-day value (matches `d.relative`) so it survives swipes
  // until the day scrolls out of the visible 5-day window.
  const [selectedRel, setSelectedRel] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [shimmerKey, setShimmerKey] = useState(0);
  const prevOffsetRef = useRef(0);
  const tweenRafRef = useRef<number | null>(null);

  // Trigger a brief luminous shimmer whenever offset shifts by more than one
  // day (i.e. a phase-ladder jump or a "Today" return). Single-day steps and
  // swipes feel calm enough already and don't need the flourish. Skipped
  // while a tween is running so it only fires once at the start of a jump.
  useEffect(() => {
    const prev = prevOffsetRef.current;
    if (!tweenRafRef.current && Math.abs(offset - prev) > 1) {
      setShimmerKey((k) => k + 1);
    }
    prevOffsetRef.current = offset;
  }, [offset]);

  const accent = useMoonseedAccent();
  const { opacity } = useRestingOpacity();
  const restingAlpha = Math.max(0, Math.min(1, opacity / 100));

  useEffect(() => {
    const t = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(t);
  }, []);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    return d;
  }, []);

  // Currently-viewed center date — used so phase jumps anchor on what the
  // user is looking at, not on real-world today.
  const viewedDate = useMemo(() => {
    const d = new Date(today);
    d.setDate(today.getDate() + offset);
    d.setHours(12, 0, 0, 0);
    return d;
  }, [today, offset]);

  // Mobile shows a 3-day window (-1, 0, +1); desktop shows 5 (-2..+2).
  const isMobile =
    typeof window !== "undefined" && window.innerWidth < 640;
  const dayRange = isMobile ? 1 : 2;

  // True while a multi-day tween is animating. Used to suppress per-cell
  // layout transitions that would otherwise fight the position tween.
  const [transitioning, setTransitioning] = useState(false);

  const [retryNonce, setRetryNonce] = useState(0);
  const { days, todayMoonSign, error } = useMemo(() => {
    try {
      const out: DayCell[] = [];
      for (let i = -dayRange; i <= dayRange; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() + offset + i);
        const info = getCurrentMoonPhase(d);
        out.push({ info, isToday: offset + i === 0, relative: offset + i, sign: getMoonSign(d) });
      }
      return { days: out, todayMoonSign: getMoonSign(new Date()), error: null as string | null };
    } catch (e) {
      console.error("[MoonCarousel] calculation failed", e);
      return { days: [] as DayCell[], todayMoonSign: "", error: e instanceof Error ? e.message : "Unknown error" };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset, today, retryNonce, dayRange]);

  const [recomputing, setRecomputing] = useState(false);
  const recomputeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleRetry = () => {
    setOffset(0);
    setExpandedRel(null);
    setSelectedRel(null);
    setRecomputing(true);
    if (recomputeTimer.current) clearTimeout(recomputeTimer.current);
    requestAnimationFrame(() => {
      setRetryNonce((n) => n + 1);
      recomputeTimer.current = setTimeout(() => setRecomputing(false), 450);
    });
  };

  useEffect(() => {
    return () => { if (recomputeTimer.current) clearTimeout(recomputeTimer.current); };
  }, []);

  const shift = (dir: -1 | 1) => {
    setOffset((o) => o + dir);
    setExpandedRel(null);
    setSelectedRel(null);
  };
  const goToToday = () => {
    setOffset(0);
    setExpandedRel(null);
    setSelectedRel(null);
  };
  const toggleExpand = (rel: number) => {
    setExpandedRel((cur) => (cur === rel ? null : rel));
    // Tapping a card also selects it (toggles off if already selected).
    setSelectedRel((cur) => (cur === rel ? null : rel));
  };
  const selectCenter = (rel: number) => {
    setSelectedRel((cur) => (cur === rel ? null : rel));
  };

  // Smoothly tween the offset from its current value to `target` so the
  // carousel feels like it scrolls through intermediate days rather than
  // snap-jumping. Cancels any in-flight tween before starting a new one.
  const tweenOffsetTo = (target: number) => {
    if (tweenRafRef.current) cancelAnimationFrame(tweenRafRef.current);
    setExpandedRel(null);
    setSelectedRel(null);

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    setOffset((start) => {
      const distance = target - start;
      if (distance === 0) return start;
      // Fire the shimmer once at the start of any multi-day jump.
      if (Math.abs(distance) > 1) setShimmerKey((k) => k + 1);
      if (reduceMotion) return target;

      setTransitioning(true);

      // 60ms per step, capped so very long jumps still feel snappy.
      const duration = Math.min(900, Math.max(280, Math.abs(distance) * 60));
      const startTime = performance.now();
      const ease = (t: number) => 1 - Math.pow(1 - t, 3); // easeOutCubic

      const tick = (now: number) => {
        const t = Math.min(1, (now - startTime) / duration);
        const next = Math.round(start + distance * ease(t));
        setOffset(next);
        if (t < 1) {
          tweenRafRef.current = requestAnimationFrame(tick);
        } else {
          tweenRafRef.current = null;
          setTransitioning(false);
        }
      };
      tweenRafRef.current = requestAnimationFrame(tick);
      return start;
    });
  };

  // Tap a ladder rung → jump to the *nearest* occurrence of that phase in
  // either direction. Side-specific arrows (chevrons) still step ±1 day.
  const jumpToPhase = (phase: MoonPhaseName) => {
    const delta = findNearestPhaseOccurrence(phase, viewedDate);
    if (delta === 0) return;
    tweenOffsetTo(offset + delta);
  };

  useEffect(() => {
    return () => { if (tweenRafRef.current) cancelAnimationFrame(tweenRafRef.current); };
  }, []);

  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!touchStart.current) return;
    const dx = e.changedTouches[0].clientX - touchStart.current.x;
    const dy = e.changedTouches[0].clientY - touchStart.current.y;
    touchStart.current = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.2) shift(dx > 0 ? -1 : 1);
  };

  if (recomputing) return <MoonSkeleton label="Recomputing moon data…" />;
  if (error) return <MoonErrorFallback message={error} onRetry={handleRetry} />;
  if (!ready || days.length === 0) return <MoonSkeleton />;

  // Prefer the explicitly-selected day's phase for ladder highlighting; fall
  // back to the centered (middle) day when nothing is selected. If the
  // selected day has scrolled out of the visible window we ignore it.
  const selectedDay =
    selectedRel !== null ? days.find((d) => d.relative === selectedRel) : undefined;
  const centerDay = days.find((d) => d.relative === offset);
  const viewedPhase = (selectedDay ?? centerDay)?.info.phase ?? null;

  return (
    <section
      aria-label="Moon phase calendar"
      aria-roledescription="carousel"
      className="relative animate-in fade-in slide-in-from-top-2 duration-500"
      style={{ minHeight: 280 }}
    >
      {/* Screen-reader-only live status describing the currently centered day. */}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {centerDay
          ? `Viewing ${centerDay.isToday ? "today" : formatShortDate(centerDay.info.date)}, ${centerDay.info.phase}, ${centerDay.info.illumination}% illuminated, Moon in ${centerDay.isToday ? todayMoonSign : centerDay.sign}.`
          : ""}
      </p>

      {/* Mobile phase ladders — fixed to screen edges, visible on mobile only */}
      <MobilePhaseLadder side="left" restingAlpha={restingAlpha} onJump={jumpToPhase} />
      <MobilePhaseLadder side="right" restingAlpha={restingAlpha} onJump={jumpToPhase} />

      {/* Fixed-height row so cards never reflow as the user swipes between
          days. The today card is the tallest element; sizing here is set so
          it never clips and the chevrons never shift vertically. */}
      <div
        className="relative flex items-start justify-center gap-1 sm:gap-4 touch-pan-y overflow-visible px-8 sm:px-0"
        style={{ height: 260 }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {shimmerKey > 0 && (
          <span
            key={shimmerKey}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-20 overflow-hidden rounded-2xl"
          >
            <span
              className="absolute inset-y-0 -left-1/3 w-1/3 moon-shimmer-sweep"
              style={{
                background: `linear-gradient(100deg, transparent 0%, ${accent}00 20%, ${accent}55 50%, ${accent}00 80%, transparent 100%)`,
                filter: "blur(8px)",
              }}
            />
            <span
              className="absolute inset-0 moon-shimmer-glow"
              style={{
                background: `radial-gradient(ellipse at center, ${accent}22 0%, transparent 60%)`,
              }}
            />
          </span>
        )}

        {/* Mobile ladder — left side, visible on mobile only */}
        <PhaseLadder
          side="left"
          restingAlpha={restingAlpha}
          activePhase={viewedPhase}
          offset={offset}
          onJump={(p) => jumpToPhase(p)}
          onStep={() => shift(-1)}
        />

        <div
          className="flex flex-1 items-start justify-center gap-1.5 sm:gap-3 max-w-2xl overflow-visible"
          role="group"
          aria-label={`Day strip, ${days.length} days`}
        >
          {days.map((d) => {
            const isExpanded = expandedRel === d.relative;
            const rel = d.relative - offset; // -2..+2 within current window
            const absRel = Math.abs(rel);    // window position, NOT distance from today
            // Compensate for the CenterCard's "Today/date" header so the moon
            // GRAPHIC tops cascade correctly — not just the cell tops.
            const topOffset = absRel === 0 ? 0 : absRel === 1 ? 52 : 68;
            const isCenter = rel === 0;
            const isSelected = selectedRel === d.relative;
            return (
              <div
                key={d.info.date.toDateString()}
                role="group"
                aria-roledescription="day"
                aria-label={`${d.isToday ? "Today" : formatShortDate(d.info.date)}, ${d.info.phase}`}
                style={{
                  alignSelf: "flex-start",
                  marginTop: `${topOffset}px`,
                  // Shrink ±2 cards slightly on mobile so they fit beside the
                  // mobile ladders without clipping at the screen edges.
                  transform: absRel === 2 ? "scale(0.85)" : undefined,
                  transformOrigin: "top center",
                }}
                className={cn(
                  "flex flex-col items-center",
                  !transitioning && "transition-all duration-300 ease-out",
                  isCenter || isSelected
                    ? "z-10 opacity-100"
                    : isExpanded
                      ? "z-10 opacity-100"
                      : "opacity-70",
                )}
              >
                {isCenter ? (
                  <CenterCard
                    info={d.info}
                    moonSign={d.isToday ? todayMoonSign : d.sign}
                    isToday={d.isToday}
                    selected={isSelected}
                    onToggle={() => selectCenter(d.relative)}
                  />
                ) : (
                  <AdjacentCard
                    info={d.info}
                    sign={d.sign}
                    expanded={isExpanded}
                    selected={isSelected}
                    onToggle={() => toggleExpand(d.relative)}
                    size={absRel === 1 ? "medium" : "small"}
                  />
                )}
              </div>
            );
          })}
        </div>

        <PhaseLadder
          side="right"
          restingAlpha={restingAlpha}
          activePhase={viewedPhase}
          offset={offset}
          onJump={(p) => jumpToPhase(p)}
          onStep={() => shift(1)}
        />
      </div>

      <p
        className="mt-1 text-center text-[9px] uppercase tracking-[0.25em] text-muted-foreground sm:hidden"
        style={{ opacity: restingAlpha * 0.6 }}
      >
        Swipe to browse · Tap a day for details
      </p>

      {offset !== 0 && (
        <div className="mt-2 flex w-full justify-center animate-in fade-in duration-300">
          <button
            type="button"
            onClick={goToToday}
            aria-label="Return to today"
            className={cn(
              "inline-flex items-center gap-1 cursor-pointer border-0 m-0",
              "px-2 py-1 rounded-full bg-transparent text-xs",
              "transition-opacity duration-150",
              "hover:opacity-100 focus-visible:opacity-100",
              "outline-none focus-visible:outline-none",
              "focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            )}
            style={{ color: accent, opacity: restingAlpha }}
          >
            <span aria-hidden="true">↩</span>
            <span>Today</span>
          </button>
        </div>
      )}

    </section>
  );
}

function CenterCard({
  info,
  moonSign,
  isToday,
  selected,
  onToggle,
}: {
  info: MoonInfo;
  moonSign: string;
  isToday: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      aria-label={`${isToday ? "Today" : formatShortDate(info.date)}, ${info.phase}. Tap to ${selected ? "deselect" : "select"}.`}
      className="flex flex-col items-center gap-1.5 cursor-pointer bg-transparent border-0 p-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 rounded-2xl"
      style={{ minWidth: 120, maxWidth: 160 }}
    >
      <span className="text-[10px] font-medium uppercase tracking-[0.3em] text-gold">
        {isToday ? "Today" : formatShortDate(info.date)}
      </span>
      <div
        className={cn(
          "w-full rounded-2xl bg-card/60 px-3 py-4 sm:px-4 backdrop-blur-sm transition-all duration-200",
          selected
            ? "border-2 border-gold shadow-[0_0_24px_-4px_rgba(212,175,55,0.65)]"
            : "border border-gold/30 shadow-[0_8px_30px_-12px_rgba(212,175,55,0.4)]",
        )}
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <MoonPhaseIcon phase={info.phase} size={72} />
          <p className="whitespace-nowrap text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {formatShortDate(info.date)}
          </p>
          <p className="whitespace-nowrap font-display text-sm text-gold">{info.phase}</p>
          <p className="whitespace-nowrap text-xs text-gold/80">{info.illumination}% illuminated</p>
          <p className="whitespace-nowrap text-[11px] uppercase tracking-wider text-muted-foreground">Moon in {moonSign}</p>
        </div>
      </div>
    </button>
  );
}

function AdjacentCard({ info, sign, expanded, selected, onToggle, size = "medium" }: {
  info: MoonInfo; sign: string; expanded: boolean; selected: boolean; onToggle: () => void; size?: "medium" | "small";
}) {
  const iconSize = expanded ? 52 : size === "medium" ? 44 : 32;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-pressed={selected}
      aria-label={`${formatShortDate(info.date)}, ${info.phase}, ${info.illumination}% illuminated. Tap for details.`}
      className={cn(
        "flex flex-col items-center gap-1 rounded-xl px-2 py-2 transition-all duration-300 ease-out cursor-pointer",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60",
        selected
          ? "border-2 border-gold bg-card/60 shadow-[0_0_18px_-4px_rgba(212,175,55,0.6)] backdrop-blur-sm"
          : expanded
          ? "border border-gold/25 bg-card/50 shadow-[0_4px_20px_-12px_rgba(212,175,55,0.35)] backdrop-blur-sm"
          : "border border-transparent hover:border-gold/15 hover:bg-card/30 hover:opacity-100 active:scale-95",
      )}
    >
      <MoonPhaseIcon phase={info.phase} size={iconSize} />
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{formatShortDate(info.date)}</p>
      <p className="text-[11px] text-muted-foreground">{info.phase}</p>
      <p className="text-[10px] text-gold/80">{info.illumination}% illuminated</p>
      {expanded && (
        <div className="mt-1 flex flex-col items-center gap-0.5 animate-in fade-in slide-in-from-top-1 duration-200 sm:hidden">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Moon in {sign}</p>
        </div>
      )}
    </button>
  );
}

function formatShortDate(d: Date) {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function MoonSkeleton({ label }: { label?: string } = {}) {
  return (
    <section
      aria-label={label ?? "Loading moon phase calendar"}
      aria-busy="true"
      role="status"
      className="relative animate-in fade-in duration-300"
      style={{ minHeight: 280 }}
    >
      {/* Mirror the live carousel layout (ladder + 5-day cascade + ladder)
          so the transition into the real component is calm and intentional. */}
      <div
        className="relative flex items-start justify-center gap-1 sm:gap-4 overflow-hidden rounded-2xl"
        style={{ height: 260 }}
      >
        <SkeletonLadder side="left" />

        <div className="relative flex-1 max-w-2xl" style={{ height: 260 }}>
          {[-2, -1, 0, 1, 2].map((rel) => {
            const absRel = Math.abs(rel);
            const topOffset = absRel === 0 ? 0 : absRel === 1 ? 28 : 52;
            const leftPercent =
              rel === -2 ? 10 : rel === -1 ? 28 : rel === 0 ? 50 : rel === 1 ? 72 : 90;
            const isCenter = rel === 0;
            const iconSize = isCenter ? 72 : absRel === 1 ? 44 : 32;
            return (
              <div
                key={rel}
                style={{
                  position: "absolute",
                  top: `${topOffset}px`,
                  left: `${leftPercent}%`,
                  transform: "translateX(-50%)",
                }}
                className={cn(
                  "flex flex-col items-center gap-2",
                  isCenter ? "opacity-100" : "opacity-60",
                )}
              >
                {isCenter && <div className="h-3 w-12 rounded bg-muted/30" />}
                <div
                  className={cn(
                    "rounded-full bg-muted/30",
                    isCenter && "border border-gold/20",
                  )}
                  style={{ width: iconSize, height: iconSize }}
                />
                <div className={cn("rounded bg-muted/30", isCenter ? "h-3 w-20" : "h-2 w-12")} />
                <div className={cn("rounded bg-muted/20", isCenter ? "h-3 w-24" : "h-2 w-14")} />
              </div>
            );
          })}
        </div>

        <SkeletonLadder side="right" />

        {/* Soft gold shimmer sweep across the entire skeleton — calmer than
            an aggressive pulse. Hidden under prefers-reduced-motion. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl"
        >
          <span className="moon-skeleton-sweep absolute inset-y-0 -left-1/3 w-1/3" />
        </span>
      </div>

      {label && (
        <div className="mt-3 flex items-center justify-center gap-2 text-[11px] uppercase tracking-[0.25em] text-gold/80">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>{label}</span>
        </div>
      )}
    </section>
  );
}

function SkeletonLadder({ side }: { side: "left" | "right" }) {
  const isLeft = side === "left";
  return (
    <div
      className="hidden sm:block relative shrink-0 self-center"
      style={{ width: 60 }}
      aria-hidden="true"
    >
      <div
        className={cn(
          "flex flex-col gap-[2px] py-0",
          isLeft ? "items-start" : "items-end",
        )}
        style={{ maxHeight: 100 }}
      >
        {[14, 18, 26, 18, 14].map((size, i) => {
          const inset = i === 2 ? 0 : i === 1 || i === 3 ? 14 : 28;
          return (
            <div
              key={i}
              className="rounded-full bg-muted/30"
              style={{
                width: size,
                height: size,
                [isLeft ? "marginLeft" : "marginRight"]: inset,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function MoonErrorFallback({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section role="alert" aria-label="Moon phase calendar unavailable" className="mx-auto max-w-md rounded-xl border border-border/40 bg-card/30 px-4 py-3 text-center">
      <p className="text-xs text-muted-foreground">🌙 Moon phase data is unavailable right now.</p>
      <p className="mt-1 text-[10px] text-muted-foreground/70">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 inline-flex items-center gap-1 rounded-full border border-gold/30 bg-gold/[0.06] px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-gold transition-colors hover:bg-gold/[0.12] focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
      >
        <RefreshCw className="h-3 w-3" />
        Try again
      </button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// PhaseLadder — vertical stack of jump-to-phase buttons + a chevron stepper.
// Visible on sm+ only; mobile relies on swipe.
// ---------------------------------------------------------------------------

type LadderRung = {
  label: string;            // accessible label
  phase: MoonPhaseName;     // phase to search for
  size: number;             // icon px
  inset: number;            // edge inset px (margin-left for "left", margin-right for "right")
};

const LADDER_RUNGS: LadderRung[] = [
  { label: "New Moon",        phase: "New Moon",        size: 14, inset: 28 },
  { label: "Waxing Crescent", phase: "Waxing Crescent", size: 18, inset: 14 },
  { label: "Full Moon",       phase: "Full Moon",       size: 26, inset: 0 },
  { label: "Waning Gibbous",  phase: "Waning Gibbous",  size: 18, inset: 14 },
  // "Dark Moon" rung — calculated as New Moon, displayed as the same dark glyph.
  { label: "Dark Moon",       phase: "New Moon",        size: 14, inset: 28 },
];

// ---------------------------------------------------------------------------
// MobilePhaseLadder — compact vertical phase navigator for mobile only.
// No chevrons, no inset — icons are flush to the screen edge so the 5-day
// cascade has maximum room. Tapping a rung jumps to the nearest occurrence.
// ---------------------------------------------------------------------------
function MobilePhaseLadder({
  side,
  restingAlpha,
  onJump,
}: {
  side: "left" | "right";
  restingAlpha: number;
  onJump: (phase: MoonPhaseName) => void;
}) {
  const isLeft = side === "left";
  // Smaller, edge-pinned cascade — sized down from the desktop ladder so it
  // sits comfortably on the very edge of mobile viewports.
  const RUNG_SIZES = [12, 15, 22, 15, 12];
  return (
    <div
      className="fixed sm:hidden flex flex-col gap-[2px] z-10"
      style={{
        top: "70px",
        transform: "none",
        alignItems: isLeft ? "flex-start" : "flex-end",
        [isLeft ? "left" : "right"]: 0,
        [isLeft ? "paddingLeft" : "paddingRight"]: 8,
      }}
      aria-label={`${isLeft ? "Previous" : "Next"} phase navigator`}
    >
      {LADDER_RUNGS.map((r, i) => (
        <button
          key={`mobile-${r.label}-${i}`}
          type="button"
          onClick={() => onJump(r.phase)}
          aria-label={`${isLeft ? "Previous" : "Next"} ${r.label}`}
          style={{ opacity: restingAlpha }}
          className="cursor-pointer rounded-full border-0 bg-transparent p-0 transition-all duration-200 hover:opacity-100 hover:scale-110 focus:outline-none"
        >
          <span
            style={{
              background:
                "radial-gradient(circle, rgba(212,175,55,0.60) 0%, transparent 70%)",
              borderRadius: "50%",
              padding: "3px",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <MoonPhaseIcon phase={r.phase} size={RUNG_SIZES[i]} />
          </span>
        </button>
      ))}
    </div>
  );
}

function PhaseLadder({
  side,
  restingAlpha,
  activePhase,
  offset,
  onJump,
  onStep,
}: {
  side: "left" | "right";
  restingAlpha: number;
  activePhase: MoonPhaseName | null;
  offset: number;
  onJump: (phase: MoonPhaseName) => void;
  onStep: () => void;
}) {
  const isLeft = side === "left";
  const Chevron = isLeft ? ChevronLeft : ChevronRight;
  const stepLabel = isLeft ? "Previous day" : "Next day";
  const jumpVerb = isLeft ? "Previous" : "Next";

  // Find which rung (if any) is currently "active" — the first rung whose
  // phase matches the viewed day. Note: New Moon appears twice (top + Dark
  // Moon at bottom); we only highlight the first match for visual clarity.
  const activeIdx = activePhase
    ? LADDER_RUNGS.findIndex((r) => r.phase === activePhase)
    : -1;

  // Re-fire the glow/scale animation whenever the offset changes while a
  // rung is active. Keying on `${offset}-${activeIdx}` resets the animation.
  const pulseKey = `${offset}-${activeIdx}`;

  const ladderColumn = (
    <div
      className={cn(
        "flex flex-col gap-[2px] py-0",
        // Anchor icons to the outer edge so they grow inward.
        isLeft ? "items-start" : "items-end",
      )}
    >
      {LADDER_RUNGS.map((r, i) => (
        <button
          key={`${r.label}-${i}`}
          type="button"
          onClick={() => onJump(r.phase)}
          aria-label={`${jumpVerb} ${r.label}`}
          title={`${jumpVerb} ${r.label}`}
          aria-current={i === activeIdx ? "true" : undefined}
          style={{
            opacity: i === activeIdx ? 1 : restingAlpha,
            [isLeft ? "marginLeft" : "marginRight"]: r.inset,
          }}
          className={cn(
            "group cursor-pointer rounded-full bg-transparent border-0 p-0",
            "transition-all duration-200 ease-out",
            "hover:!opacity-100 hover:scale-110",
            "focus:outline-none focus-visible:!opacity-100 focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            i === activeIdx && "moon-rung-active",
          )}
        >
          <span
            // Re-mount the inner span on offset change so the pulse animation
            // restarts cleanly — pure CSS animations don't otherwise replay.
            key={i === activeIdx ? pulseKey : "idle"}
            className={cn(
              "moon-rung-halo inline-flex items-center justify-center rounded-full transition-all duration-200 ease-out",
              i === activeIdx && "moon-rung-pulse",
            )}
          >
            <span
              className="moon-rung-glow inline-flex items-center justify-center rounded-full group-hover:[background:radial-gradient(circle,rgba(212,175,55,0.80)_0%,transparent_70%)]"
              style={{
                background:
                  "radial-gradient(circle, rgba(212,175,55,0.55) 0%, transparent 70%)",
                padding: "4px",
                transition: "background 200ms ease",
              }}
            >
              <MoonPhaseIcon phase={r.phase} size={r.size} />
            </span>
          </span>
        </button>
      ))}
    </div>
  );

  const chevronButton = (
    <button
      type="button"
      onClick={onStep}
      aria-label={stepLabel}
      style={{ opacity: restingAlpha }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-transparent border-0 p-0 cursor-pointer",
        "text-muted-foreground transition-all duration-200",
        "hover:text-gold hover:!opacity-100 focus:outline-none focus-visible:!opacity-100 focus-visible:ring-2 focus-visible:ring-gold/60",
      )}
    >
      {/* Match the chevron's visual weight to the Full Moon rung (26px) so
          it reads as a sibling control, not a smaller satellite. Scales
          modestly across breakpoints to keep parity with the rung sizes. */}
      <Chevron className="h-[22px] w-[22px] md:h-[26px] md:w-[26px]" strokeWidth={1.75} />
    </button>
  );

  return (
    <div
      className="hidden sm:flex shrink-0 self-start flex-row items-start gap-1.5 md:gap-2"
      style={{ marginTop: 8 }}
      aria-label={`${jumpVerb} phase navigator`}
    >
      {isLeft ? (
        <>
          <div style={{ marginTop: 52 }}>{chevronButton}</div>
          {ladderColumn}
        </>
      ) : (
        <>
          {ladderColumn}
          <div style={{ marginTop: 52 }}>{chevronButton}</div>
        </>
      )}
    </div>
  );
}
