/**
 * FQ-2 — Calendar showing a stalker's appearance dates highlighted.
 * Wraps the shared shadcn Calendar (react-day-picker) in read-only mode.
 */
import { useMemo } from "react";
import { Calendar, CalendarDayButton } from "@/components/ui/calendar";

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
  // Q57 Fix 5C — count draws per date, X-badge displayed when >1.
  const appearanceCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const d of appearanceDates) {
      const k = d.toDateString();
      m[k] = (m[k] ?? 0) + 1;
    }
    return m;
  }, [appearanceDates]);

  // Q60 Fix 7 — render every month in the appearance span individually
  // and let an auto-fit grid pack as many as comfortably fit. Cell-size
  // is now derived from each grid cell's own width (not the viewport),
  // so months scale correctly inside their allocated track.
  const span = useMemo(() => monthSpan(appearances), [appearances]);
  // Cap months rendered so a long history (years) doesn't generate a
  // wall of calendars. Anchor to most recent activity.
  const MAX_MONTHS = 12;
  const monthsShown = Math.min(Math.max(span, 1), MAX_MONTHS);
  const months = useMemo(() => {
    const anchor = initialMonth(appearances, monthsShown);
    return Array.from({ length: monthsShown }, (_, i) => {
      const d = new Date(anchor.getFullYear(), anchor.getMonth() + i, 1);
      return { iso: `${d.getFullYear()}-${d.getMonth()}`, month: d };
    });
  }, [appearances, monthsShown]);

  const dayButton = (props: any) => {
    const key = props.day.date.toDateString();
    const count = appearanceCounts[key] ?? 0;
    void appearanceKeys;
    return (
      <CalendarDayButton {...props}>
        <span className="leading-none">{props.day.date.getDate()}</span>
        {count > 1 && (
          <span
            className="leading-none"
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "0.65em",
              color: "var(--gold)",
            }}
          >
            ×{count}
          </span>
        )}
      </CalendarDayButton>
    );
  };

  return (
    <div
      className="block rounded-lg p-2 max-w-full"
      style={{
        background: "var(--surface-card)",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: 16,
      }}
    >
      {months.map((m) => (
        <div
          key={m.iso}
          style={{
            // Cell-size derives from each grid track's own width.
            ["--cell-size" as never]:
              "clamp(28px, calc((100% - 16px) / 8), 40px)",
          }}
        >
          <Calendar
            numberOfMonths={1}
            mode="multiple"
            selected={appearanceDates}
            month={m.month}
            showOutsideDays={false}
            onSelect={() => {}}
            components={{ DayButton: dayButton }}
          />
        </div>
      ))}
    </div>
  );
}