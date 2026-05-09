/**
 * FQ-2 — Calendar showing a stalker's appearance dates highlighted.
 * Wraps the shared shadcn Calendar (react-day-picker) in read-only mode.
 */
import { useEffect, useMemo, useState } from "react";
import { Calendar } from "@/components/ui/calendar";

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

  const [month, setMonth] = useState<Date>(() => {
    if (appearances.length === 0) return new Date();
    const sorted = [...appearances].sort((a, b) => (a.date < b.date ? 1 : -1));
    const d = new Date(sorted[0].date);
    // 26-05-08-M — Fix 8: start one month earlier so when we render
    // two months side-by-side, both the penultimate and most recent
    // appearance months are visible.
    return new Date(d.getFullYear(), d.getMonth() - 1, 1);
  });

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