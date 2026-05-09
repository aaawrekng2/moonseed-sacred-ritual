/**
 * FQ-2 — Calendar showing a stalker's appearance dates highlighted.
 * Wraps the shared shadcn Calendar (react-day-picker) in read-only mode.
 */
import { useEffect, useMemo, useState } from "react";
import { Calendar } from "@/components/ui/calendar";

function initialMonth(
  appearances: Array<{ readingId: string; date: string }>,
): Date {
  if (appearances.length === 0) return new Date();
  const sorted = [...appearances].sort((a, b) => (a.date < b.date ? 1 : -1));
  const d = new Date(sorted[0].date);
  return new Date(d.getFullYear(), d.getMonth() - 1, 1);
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

  const [month, setMonth] = useState<Date>(() => initialMonth(appearances));
  // Q10 Fix 8 — re-anchor the visible month when the seeker switches
  // to a different stalker. Without this the calendar stays parked on
  // the previously-selected stalker's most recent appearance month.
  useEffect(() => {
    setMonth(initialMonth(appearances));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appearances]);

  // 26-05-08-M — Fix 8: 2 months side by side on screens ≥ 400px.
  const [numberOfMonths, setNumberOfMonths] = useState(1);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(min-width: 400px)");
    const update = () => setNumberOfMonths(mql.matches ? 2 : 1);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  return (
    <div
      className="rounded-lg p-2 inline-block overflow-x-auto max-w-full"
      style={{ background: "var(--surface-card)" }}
    >
      <Calendar
        numberOfMonths={numberOfMonths}
        mode="multiple"
        selected={appearanceDates}
        month={month}
        onMonthChange={setMonth}
        showOutsideDays={false}
        // Read-only: don't allow user to change selection by clicking dates.
        onSelect={() => {}}
      />
    </div>
  );
}