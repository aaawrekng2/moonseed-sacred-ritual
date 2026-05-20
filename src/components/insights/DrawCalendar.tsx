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
import { currentTzOrFallback, isoDayInTz } from "@/lib/time";

export type DrawCalendarAppearance = {
  readingId?: string;
  date: string;
  isReversed?: boolean;
};

export function DrawCalendar({
  appearances,
  monthsBack,
  tz,
}: {
  appearances: DrawCalendarAppearance[];
  /** Q64 — when provided, caps the visible months from the current month
   *  back. Falls back to viewport-based auto-selection when omitted. */
  monthsBack?: number;
  /**
   * Phase 16 — IANA tz used to bucket appearances by the seeker's
   * calendar day. Without this the calendar drifts in negative offsets
   * (e.g. an 8pm PT draw shows on the next day). Falls back to the
   * browser's resolved tz, then UTC.
   */
  tz?: string;
}) {
  // Resolve tz once. The browser's resolved tz almost always matches the
  // seeker's, but explicit prop wins.
  const effectiveTz = useMemo(() => {
    if (tz && tz.length > 0) return tz;
    try {
      return currentTzOrFallback(
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      );
    } catch {
      return "UTC";
    }
  }, [tz]);

  /**
   * Per appearance: compute the seeker-local ISO day ("YYYY-MM-DD") and
   * a Date anchored at browser-local midnight of those same Y/M/D
   * numbers. We feed the latter into the day-picker so its visible
   * cells line up with the seeker's calendar day, and we key counts /
   * months by the ISO string (string keys avoid Date-equality drift).
   */
  const appearanceMeta = useMemo(
    () =>
      appearances.map((a) => {
        const ymd = isoDayInTz(new Date(a.date), effectiveTz);
        const [y, m, d] = ymd.split("-").map(Number);
        return { ymd, date: new Date(y, m - 1, d) };
      }),
    [appearances, effectiveTz],
  );
  const appearanceDates = useMemo(
    () => appearanceMeta.map((a) => a.date),
    [appearanceMeta],
  );

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of appearanceMeta) {
      m[a.ymd] = (m[a.ymd] ?? 0) + 1;
    }
    return m;
  }, [appearanceMeta]);

  const months = useMemo(() => {
    // Anchor "now" to the seeker's local Y/M for the current-month cell.
    const nowYmd = isoDayInTz(new Date(), effectiveTz);
    const [ny, nm] = nowYmd.split("-").map(Number);
    if (typeof monthsBack === "number" && monthsBack > 0) {
      const out: Date[] = [];
      for (let i = monthsBack - 1; i >= 0; i -= 1) {
        out.push(new Date(ny, nm - 1 - i, 1));
      }
      return out;
    }
    const currentKey = `${ny}-${String(nm).padStart(2, "0")}`;
    const set = new Set<string>();
    for (const a of appearanceMeta) {
      set.add(a.ymd.slice(0, 7));
    }
    set.add(currentKey);
    const isMobile =
      typeof window !== "undefined" && window.innerWidth < 769;
    const cap = isMobile ? 2 : 4;
    const sortedDesc = Array.from(set).sort().reverse().slice(0, cap);
    return sortedDesc.sort().map((k) => {
      const [y, m] = k.split("-").map(Number);
      return new Date(y, m - 1, 1);
    });
  }, [appearanceMeta, effectiveTz, monthsBack]);

  const dayButton = (props: any) => {
    // The day-picker passes a browser-local Date for each rendered cell.
    // Build the same YYYY-MM-DD key we used when bucketing.
    const cell: Date = props.day.date;
    // eslint-disable-next-line no-restricted-syntax -- cell is a browser-local Date constructed by the day-picker for the visible cell; reading local Y/M/D matches what's painted.
    const y = cell.getFullYear();
    // eslint-disable-next-line no-restricted-syntax -- see above
    const m = cell.getMonth() + 1;
    // eslint-disable-next-line no-restricted-syntax -- see above
    const dnum = cell.getDate();
    const k = `${y}-${String(m).padStart(2, "0")}-${String(dnum).padStart(2, "0")}`;
    const c = counts[k] ?? 0;
    const isToday = !!props.modifiers?.today;
    // Q62 Fix 3 — heatmap intensity scaled by daily count (inline so
    // we don't depend on data-attr forwarding through CalendarDayButton).
    let bg: string | undefined;
    // Q64 — wider opacity range so heavy-draw cards stand out.
    // Q73 Fix 6 — only highlight days with appearances. Without this
    // `else if (c < 8)` was catching c === 0 and lighting every day.
    // Q74 — wider gap at the low end so single- vs double-draw days are
    // clearly distinct on a dark background.
    if (c === 0) bg = undefined;
    else if (c === 1) bg = "color-mix(in oklab, var(--gold) 20%, transparent)";
    else if (c === 2) bg = "color-mix(in oklab, var(--gold) 38%, transparent)";
    else if (c === 3) bg = "color-mix(in oklab, var(--gold) 52%, transparent)";
    else if (c === 4) bg = "color-mix(in oklab, var(--gold) 64%, transparent)";
    else if (c < 8) bg = "color-mix(in oklab, var(--gold) 78%, transparent)";
    else bg = "color-mix(in oklab, var(--gold) 90%, transparent)";
    if (isToday) bg = undefined;
    return (
      <CalendarDayButton
        {...props}
        style={{
          ...(bg ? { background: bg } : null),
          borderRadius: 4,
          ...(isToday
            ? { outline: "2px solid var(--accent, var(--gold))", outlineOffset: 1 }
            : null),
        }}
      >
        <span className="leading-none">{dnum}</span>
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
        {isToday && (
          <span
            className="leading-none"
            style={{
              fontSize: "var(--text-caption)",
              color: "var(--accent, var(--gold))",
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              marginTop: 2,
              opacity: 0.75,
            }}
          >
            Today
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