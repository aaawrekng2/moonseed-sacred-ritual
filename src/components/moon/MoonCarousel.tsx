import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import {
  findNextPhaseOccurrence,
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
  const [ready, setReady] = useState(false);
  const [shimmerKey, setShimmerKey] = useState(0);
  const prevOffsetRef = useRef(0);

  // Trigger a brief luminous shimmer whenever offset shifts by more than one
  // day (i.e. a phase-ladder jump or a "Today" return). Single-day steps and
  // swipes feel calm enough already and don't need the flourish.
  useEffect(() => {
    const prev = prevOffsetRef.current;
    if (Math.abs(offset - prev) > 1) {
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

  const [retryNonce, setRetryNonce] = useState(0);
  const { days, todayMoonSign, error } = useMemo(() => {
    try {
      const out: DayCell[] = [];
      for (let i = -2; i <= 2; i++) {
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
  }, [offset, today, retryNonce]);

  const [recomputing, setRecomputing] = useState(false);
  const recomputeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleRetry = () => {
    setOffset(0);
    setExpandedRel(null);
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

  const shift = (dir: -1 | 1) => { setOffset((o) => o + dir); setExpandedRel(null); };
  const goToToday = () => { setOffset(0); setExpandedRel(null); };
  const toggleExpand = (rel: number) => { setExpandedRel((cur) => (cur === rel ? null : rel)); };

  // Jump to the next/previous occurrence of a tapped phase, relative to TODAY
  // (not the currently-viewed day) so the ladder is predictable.
  const jumpToPhase = (phase: MoonPhaseName, direction: "next" | "previous") => {
    const delta = findNextPhaseOccurrence(phase, new Date(), direction);
    if (delta === 0) return;
    setOffset(delta);
    setExpandedRel(null);
  };

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

  // The currently-viewed day sits in the middle of the 5-day window. Use its
  // phase to highlight the matching rung in both ladders so the user sees
  // exactly where they are in the lunar cycle.
  const viewedPhase = days[2]?.info.phase ?? null;

  return (
    <section
      aria-label="Moon phase calendar"
      className="relative animate-in fade-in slide-in-from-top-2 duration-500"
      style={{ minHeight: 280 }}
    >
      {/* Fixed-height row so cards never reflow as the user swipes between
          days. The today card is the tallest element; sizing here is set so
          it never clips and the chevrons never shift vertically. */}
      <div
        className="flex items-start justify-center gap-1 sm:gap-4 touch-pan-y overflow-visible"
        style={{ height: 220 }}
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

        <PhaseLadder
          side="left"
          restingAlpha={restingAlpha}
          activePhase={viewedPhase}
          offset={offset}
          onJump={(p) => jumpToPhase(p, "previous")}
          onStep={() => shift(-1)}
        />

        <div className="flex flex-1 items-start justify-center gap-1.5 sm:gap-3 max-w-2xl">
          {days.map((d) => {
            const isExpanded = expandedRel === d.relative;
            const absRel = Math.abs(d.relative);
            const stepOffset = absRel === 0 ? 0 : absRel === 1 ? 16 : 32;
            return (
              <div
                key={d.info.date.toDateString()}
                style={{ marginTop: `${stepOffset}px` }}
                className={cn(
                  "flex flex-col items-center transition-all duration-300 ease-out",
                  d.isToday ? "z-10 opacity-100" : isExpanded ? "z-10 opacity-100" : "opacity-70",
                )}
              >
                {d.isToday ? (
                  <TodayCard info={d.info} moonSign={todayMoonSign} />
                ) : (
                  <AdjacentCard
                    info={d.info}
                    sign={d.sign}
                    expanded={isExpanded}
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
          onJump={(p) => jumpToPhase(p, "next")}
          onStep={() => shift(1)}
        />
      </div>

      <p className="mt-1 text-center text-[10px] uppercase tracking-[0.25em] text-muted-foreground/60 sm:hidden">
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

function TodayCard({ info, moonSign }: { info: MoonInfo; moonSign: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5" style={{ minWidth: 120, maxWidth: 160 }}>
      <span className="text-[10px] font-medium uppercase tracking-[0.3em] text-gold">Today</span>
      <div className="w-full rounded-2xl border border-gold/30 bg-card/60 px-3 py-4 sm:px-4 shadow-[0_8px_30px_-12px_rgba(212,175,55,0.4)] backdrop-blur-sm">
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
    </div>
  );
}

function AdjacentCard({ info, sign, expanded, onToggle, size = "medium" }: {
  info: MoonInfo; sign: string; expanded: boolean; onToggle: () => void; size?: "medium" | "small";
}) {
  const iconSize = expanded ? 52 : size === "medium" ? 44 : 32;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-label={`${formatShortDate(info.date)}, ${info.phase}, ${info.illumination}% illuminated. Tap for details.`}
      className={cn(
        "flex flex-col items-center gap-1 rounded-xl px-2 py-2 transition-all duration-300 ease-out cursor-pointer",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60",
        expanded
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
    <section aria-label={label ?? "Loading moon phase calendar"} aria-busy="true" role="status" className="relative">
      <div className="mx-auto flex max-w-2xl items-end justify-center gap-1.5 sm:gap-3">
        {[0, 1, 2, 3, 4].map((i) => {
          const isCenter = i === 2;
          return (
            <div key={i} className={cn("flex flex-col items-center gap-2", isCenter ? "opacity-100" : "opacity-50")}>
              {isCenter && <div className="h-3 w-12 rounded bg-muted/40 animate-pulse" />}
              <div className={cn("rounded-full bg-muted/40 animate-pulse", isCenter ? "h-[72px] w-[72px]" : "h-10 w-10")} />
              <div className={cn("rounded bg-muted/40 animate-pulse", isCenter ? "h-3 w-20" : "h-2 w-12")} />
              <div className={cn("rounded bg-muted/30 animate-pulse", isCenter ? "h-3 w-24" : "h-2 w-14")} />
            </div>
          );
        })}
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
  { label: "New Moon",        phase: "New Moon",        size: 14, inset: 16 },
  { label: "Waxing Crescent", phase: "Waxing Crescent", size: 18, inset: 8 },
  { label: "Full Moon",       phase: "Full Moon",       size: 26, inset: 0 },
  { label: "Waning Gibbous",  phase: "Waning Gibbous",  size: 18, inset: 8 },
  // "Dark Moon" rung — calculated as New Moon, displayed as the same dark glyph.
  { label: "Dark Moon",       phase: "New Moon",        size: 14, inset: 16 },
];

function PhaseLadder({
  side,
  restingAlpha,
  onJump,
  onStep,
}: {
  side: "left" | "right";
  restingAlpha: number;
  onJump: (phase: MoonPhaseName) => void;
  onStep: () => void;
}) {
  const isLeft = side === "left";
  const Chevron = isLeft ? ChevronLeft : ChevronRight;
  const stepLabel = isLeft ? "Previous day" : "Next day";
  const jumpVerb = isLeft ? "Previous" : "Next";

  return (
    <div
      className={cn(
        "hidden sm:flex shrink-0 self-center flex-col items-stretch gap-[6px] py-1",
        // Anchor icons to the outer edge so they grow inward.
        isLeft ? "items-start" : "items-end",
      )}
      aria-label={`${jumpVerb} phase navigator`}
    >
      {LADDER_RUNGS.map((r, i) => (
        <button
          key={`${r.label}-${i}`}
          type="button"
          onClick={() => onJump(r.phase)}
          aria-label={`${jumpVerb} ${r.label}`}
          title={`${jumpVerb} ${r.label}`}
          style={{
            opacity: restingAlpha,
            [isLeft ? "marginLeft" : "marginRight"]: r.inset,
          }}
          className={cn(
            "group cursor-pointer rounded-full bg-transparent border-0 p-0",
            "transition-all duration-200 ease-out",
            "hover:!opacity-100 hover:scale-110",
            "focus:outline-none focus-visible:!opacity-100 focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          )}
        >
          <MoonPhaseIcon phase={r.phase} size={r.size} />
        </button>
      ))}
      <button
        type="button"
        onClick={onStep}
        aria-label={stepLabel}
        className={cn(
          "mt-1 inline-flex items-center justify-center rounded-full bg-transparent border-0 p-0 cursor-pointer",
          "text-muted-foreground transition-colors duration-200",
          "hover:text-gold focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60",
          "self-center",
        )}
      >
        <Chevron className="h-7 w-7" />
      </button>
    </div>
  );
}
