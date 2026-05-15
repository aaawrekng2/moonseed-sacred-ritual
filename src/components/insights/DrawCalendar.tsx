/**
 * Q61 — Canonical draw calendar.
 * Renders one or more months in a responsive auto-fit grid, with
 * draw dates highlighted via .rdp-drawn and an "×N" mini-badge on
 * days with 2+ draws. No moon glyphs. Cell size scales with grid
 * track width.
 */
import { useMemo } from "react";
import { Calendar, CalendarDayButton } from "@/components/ui/calendar";

export type DrawCalendarAppearance = {
  readingId?: string;
  date: string;
  isReversed?: boolean;
};

export function DrawCalendar({
  appearances,
  monthsBack = 1,
}: {
  appearances: DrawCalendarAppearance[];
  monthsBack?: number;
}) {
  const appearanceDates = useMemo(
    () =>
      appearances.map((a) => {
        const d = new Date(a.date);
        return new Date(d.getFullYear(), d.getMonth(), d.getDate());
      }),
    [appearances],
  );

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const d of appearanceDates) {
      const k = d.toDateString();
      m[k] = (m[k] ?? 0) + 1;
    }
    return m;
  }, [appearanceDates]);

  const months = useMemo(() => {
    const now = new Date();
    const arr: Date[] = [];
    for (let i = monthsBack; i >= 0; i--) {
      arr.push(new Date(now.getFullYear(), now.getMonth() - i, 1));
    }
    return arr;
  }, [monthsBack]);

  const dayButton = (props: any) => {
    const k = props.day.date.toDateString();
    const c = counts[k] ?? 0;
    return (
      <CalendarDayButton {...props}>
        <span className="leading-none">{props.day.date.getDate()}</span>
        {c > 1 && (
          <span
            className="leading-none"
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "0.65em",
              color: "var(--gold)",
            }}
          >
            ×{c}
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
      {months.map((monthAnchor) => (
        <div
          key={monthAnchor.toISOString()}
          style={{
            ["--cell-size" as never]:
              "clamp(28px, calc((100% - 16px) / 8), 40px)",
          }}
        >
          <Calendar
            numberOfMonths={1}
            mode="multiple"
            selected={appearanceDates}
            month={monthAnchor}
            showOutsideDays={false}
            onSelect={() => {}}
            modifiers={{ drawn: appearanceDates }}
            modifiersClassNames={{ drawn: "rdp-drawn" }}
            components={{ DayButton: dayButton }}
          />
        </div>
      ))}
    </div>
  );
}