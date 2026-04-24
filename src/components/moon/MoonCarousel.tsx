import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getCurrentMoonPhase, getMoonSign } from "@/lib/moon";
import { useRestingOpacity } from "@/lib/use-resting-opacity";
import { MoonPhaseIcon } from "./MoonPhaseIcon";
import { cn } from "@/lib/utils";

function dayOffsetDate(offset: number): Date {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
}

function shortDate(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
}

const RELATIVES = [-2, -1, 0, 1, 2] as const;

export function MoonCarousel() {
  const [offset, setOffset] = useState(0);
  const [expandedRel, setExpandedRel] = useState<number | null>(0);
  const [ready, setReady] = useState(false);
  const { opacity } = useRestingOpacity();
  const restingAlpha = opacity / 100;

  const touch = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setReady(true);
  }, []);

  const cells = useMemo(
    () =>
      RELATIVES.map((rel) => {
        const d = dayOffsetDate(offset + rel);
        const info = getCurrentMoonPhase(d);
        const sign = getMoonSign(d);
        return { rel, date: d, info, sign };
      }),
    [offset],
  );

  const shift = (delta: number) => {
    setOffset((o) => o + delta);
    setExpandedRel(0);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!touch.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.current.x;
    const dy = t.clientY - touch.current.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
      shift(dx > 0 ? -1 : 1);
    }
    touch.current = null;
  };

  const cellAlpha = (rel: number) => {
    if (rel === 0) return 1;
    if (Math.abs(rel) === 1) return restingAlpha + (1 - restingAlpha) * 0.5;
    return restingAlpha;
  };

  return (
    <div
      className={cn(
        "w-full select-none transition-opacity duration-700",
        ready ? "opacity-100" : "opacity-0",
      )}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="flex items-center justify-center gap-1 px-2 pt-3 sm:gap-2">
        <button
          aria-label="Previous day"
          onClick={() => shift(-1)}
          className="hidden h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:text-gold sm:flex"
        >
          <ChevronLeft size={18} />
        </button>

        <div className="flex flex-1 items-end justify-center gap-2">
          {cells.map(({ rel, date, info, sign }) => {
            const isToday = rel === 0;
            const expanded = isToday || expandedRel === rel;
            const alpha = cellAlpha(rel);
            const iconSize = isToday ? 52 : Math.abs(rel) === 1 ? 36 : 28;

            return (
              <button
                key={rel}
                onClick={() => setExpandedRel(expanded ? (isToday ? 0 : null) : rel)}
                style={{ opacity: alpha }}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-center transition-all",
                  isToday &&
                    "border border-[color:var(--border)] bg-[oklch(0.20_0.045_282_/_0.4)] backdrop-blur-md px-3 py-3",
                  !isToday && "hover:opacity-100",
                )}
              >
                {isToday && (
                  <span className="text-[10px] uppercase tracking-[0.2em] text-gold/80">
                    Today
                  </span>
                )}
                <span className="text-[11px] font-medium text-muted-foreground-strong">
                  {shortDate(date)}
                </span>
                <MoonPhaseIcon phase={info.phase} size={iconSize} />
                {expanded && (
                  <>
                    <span className="font-display text-sm leading-tight text-foreground">
                      {info.phase}
                    </span>
                    {isToday && (
                      <span className="text-[10px] text-muted-foreground">
                        {info.illumination}% illuminated
                      </span>
                    )}
                    <span className="text-[10px] italic text-muted-foreground">
                      Moon in {sign}
                    </span>
                  </>
                )}
              </button>
            );
          })}
        </div>

        <button
          aria-label="Next day"
          onClick={() => shift(1)}
          className="hidden h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:text-gold sm:flex"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="mt-1 flex items-center justify-center gap-3 text-[10px] text-muted-foreground">
        <span>Swipe to browse · Tap a day for details</span>
        {offset !== 0 && (
          <button
            onClick={() => {
              setOffset(0);
              setExpandedRel(0);
            }}
            className="text-gold underline-offset-2 hover:underline"
          >
            ↩ Today
          </button>
        )}
      </div>
    </div>
  );
}