/**
 * Q62 — Canonical draw calendar.
 * Auto-selects months that contain draws (current month always shown),
 * capped by viewport (2 mobile / 4 tablet+). Heatmap intensity scales
 * with daily draw count via inline background. Equal-height months via
 * fixedWeeks. Inner Calendar overrides shadcn's w-fit so months fill
 * the auto-fit grid track properly.
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
  monthsBack,
}: {
  appearances: DrawCalendarAppearance[];
  /** Q64 — when provided, caps the visible months from the current month
   *  back. Falls back to viewport-based auto-selection when omitted. */
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
    if (typeof monthsBack === "number" && monthsBack > 0) {
      // Q64 — show the last `monthsBack` months ending with the current month.
      const out: Date[] = [];
      for (let i = monthsBack - 1; i >= 0; i -= 1) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        out.push(d);
      }
      return out;
    }
    const currentKey = `${now.getFullYear()}-${now.getMonth()}`;
    const set = new Set<string>();
    for (const d of appearanceDates) {
      set.add(`${d.getFullYear()}-${d.getMonth()}`);
    }
    set.add(currentKey);
    const isMobile =
      typeof window !== "undefined" && window.innerWidth < 769;
    const cap = isMobile ? 2 : 4;
    const sortedDesc = Array.from(set).sort().reverse().slice(0, cap);
    return sortedDesc
      .sort()
      .map((k) => {
        const [y, m] = k.split("-").map(Number);
        return new Date(y, m, 1);
      });
  }, [appearanceDates, monthsBack]);

  const dayButton = (props: any) => {
    const k = props.day.date.toDateString();
    const c = counts[k] ?? 0;
    // Q62 Fix 3 — heatmap intensity scaled by daily count (inline so
    // we don't depend on data-attr forwarding through CalendarDayButton).
    let bg: string | undefined;
    // Q64 — wider opacity range so heavy-draw cards stand out.
    // Q73 Fix 6 — only highlight days with appearances. Without this
    // `else if (c < 8)` was catching c === 0 and lighting every day.
    if (c === 0) bg = undefined;
    else if (c === 1) bg = "color-mix(in oklab, var(--gold) 15%, transparent)";
    else if (c === 2) bg = "color-mix(in oklab, var(--gold) 25%, transparent)";
    else if (c === 3) bg = "color-mix(in oklab, var(--gold) 35%, transparent)";
    else if (c === 4) bg = "color-mix(in oklab, var(--gold) 45%, transparent)";
    else if (c < 8) bg = "color-mix(in oklab, var(--gold) 55%, transparent)";
    else if (c < 12) bg = "color-mix(in oklab, var(--gold) 70%, transparent)";
    else bg = "color-mix(in oklab, var(--gold) 85%, transparent)";
    return (
      <CalendarDayButton
        {...props}
        style={bg ? { background: bg, borderRadius: 4 } : undefined}
      >
        <span className="leading-none">{props.day.date.getDate()}</span>
        {c > 1 && (
          <span
            className="leading-none"
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "1em",
              color: "var(--gold)",
              marginTop: 2,
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
            width: "100%",
            ["--cell-size" as never]:
              "clamp(32px, calc((100% - 24px) / 7), 56px)",
          }}
        >
          <Calendar
            className="w-full"
            numberOfMonths={1}
            mode="multiple"
            selected={appearanceDates}
            month={monthAnchor}
            showOutsideDays={false}
            onSelect={() => {}}
            fixedWeeks={true}
            modifiers={{ drawn: appearanceDates }}
            modifiersClassNames={{ drawn: "rdp-drawn" }}
            components={{ DayButton: dayButton }}
          />
        </div>
      ))}
    </div>
  );
}