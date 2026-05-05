/**
 * FQ-2 — Calendar showing a stalker's appearance dates highlighted.
 * Wraps the shared shadcn Calendar (react-day-picker) in read-only mode.
 */
import { useMemo, useState } from "react";
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
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  return (
    <div
      className="rounded-lg p-2 inline-block"
      style={{ background: "var(--surface-card)" }}
    >
      <Calendar
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