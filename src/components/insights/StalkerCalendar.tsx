/**
 * FQ-2 — Calendar showing a stalker's appearance dates highlighted.
 * Wraps the shared shadcn Calendar (react-day-picker) in read-only mode.
 */
import { useEffect, useMemo, useState } from "react";
import { Calendar, CalendarDayButton } from "@/components/ui/calendar";
import { getCurrentMoonPhase } from "@/lib/moon";

function mostRecent(appearances: Array<{ date: string }>): Date {
  if (appearances.length === 0) return new Date();
  const sorted = [...appearances].sort((a, b) => (a.date < b.date ? 1 : -1));
  return new Date(sorted[0].date);
}

/** Span (in months) between earliest and latest appearance, inclusive. */
function monthSpan(appearances: Array<{ date: string }>): number {
  if (appearances.length === 0) return 0;
  let min = Infinity;
  let max = -Infinity;
  for (const a of appearances) {
    const d = new Date(a.date);
    const k = d.getFullYear() * 12 + d.getMonth();
    if (k < min) min = k;
    if (k > max) max = k;
  }
  return max - min + 1;
}

function initialMonth(
  appearances: Array<{ readingId: string; date: string }>,
  monthsShown: number,
): Date {
  if (appearances.length === 0) return new Date();
  const recent = mostRecent(appearances);
  // Anchor so the most recent activity is always visible: subtract
  // (monthsShown - 1) so `month` is the leftmost displayed month.
  return new Date(recent.getFullYear(), recent.getMonth() - (monthsShown - 1), 1);
}

export function StalkerCalendar({
  appearances,
}: {
  appearances: Array<{ readingId: string; date: string }>;
}) {
  const appearanceDates = useMemo(
    () =>
      appearances.map((a) => {
        const d = new Date(a.date);
        return new Date(d.getFullYear(), d.getMonth(), d.getDate());
      }),
    [appearances],
  );
  const appearanceKeys = useMemo(
    () => new Set(appearanceDates.map((d) => d.toDateString())),
    [appearanceDates],
  );

  // Q34 Fix 4 — smart 1 / 2 / 4 month layout based on viewport AND data span.
  const [viewportWide, setViewportWide] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(min-width: 400px)");
    const update = () => setViewportWide(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  const span = useMemo(() => monthSpan(appearances), [appearances]);
  const monthsShown: 1 | 2 | 4 =
    span <= 1 ? 1 : span >= 4 && viewportWide ? 4 : 2;

  const [month, setMonth] = useState<Date>(() =>
    initialMonth(appearances, monthsShown),
  );
  // Re-anchor when the stalker changes OR layout mode changes.
  useEffect(() => {
    setMonth(initialMonth(appearances, monthsShown));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appearances, monthsShown]);

  const dayButton = (props: any) => {
    const isAppearance = appearanceKeys.has(props.day.date.toDateString());
    const glyph = isAppearance ? getCurrentMoonPhase(props.day.date).glyph : null;
    return (
      <CalendarDayButton {...props}>
        <span className="leading-none">{props.day.date.getDate()}</span>
        {glyph && <span className="text-[9px] leading-none">{glyph}</span>}
      </CalendarDayButton>
    );
  };

  if (monthsShown === 4) {
    // Two stacked Calendar instances, each showing 2 consecutive months,
    // arranged in a 2×2 grid. The second row begins 2 months after `month`.
    const secondRowMonth = new Date(month.getFullYear(), month.getMonth() + 2, 1);
    const handleTopMonthChange = (next: Date) => setMonth(next);
    const handleBottomMonthChange = (next: Date) =>
      setMonth(new Date(next.getFullYear(), next.getMonth() - 2, 1));
    return (
      <div
        className="block rounded-lg p-2 max-w-full"
        style={{
          background: "var(--surface-card)",
          display: "grid",
          gridTemplateRows: "auto auto",
          gap: 8,
        }}
      >
        <Calendar
          numberOfMonths={2}
          mode="multiple"
          selected={appearanceDates}
          month={month}
          onMonthChange={handleTopMonthChange}
          showOutsideDays={false}
          onSelect={() => {}}
          components={{ DayButton: dayButton }}
        />
        <Calendar
          numberOfMonths={2}
          mode="multiple"
          selected={appearanceDates}
          month={secondRowMonth}
          onMonthChange={handleBottomMonthChange}
          showOutsideDays={false}
          onSelect={() => {}}
          components={{ DayButton: dayButton }}
        />
      </div>
    );
  }

  return (
    <div
      className="block rounded-lg p-2 max-w-full"
      style={{ background: "var(--surface-card)" }}
    >
      <Calendar
        numberOfMonths={monthsShown}
        mode="multiple"
        selected={appearanceDates}
        month={month}
        onMonthChange={setMonth}
        showOutsideDays={false}
        onSelect={() => {}}
        components={{ DayButton: dayButton }}
      />
    </div>
  );
}