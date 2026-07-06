/**
 * v2.93 — LunationStrip. Behaves like the Insights -> Patterns calendar cell,
 * just laid out along a per-lunation / per-month LINE instead of a 7-column
 * grid. It reuses the calendar's REAL per-day data (heroDrawn) and replicates
 * its exact display rules:
 *   - hero-drawn days get the gold fill (var(--gold), ~0.9), like the calendar;
 *   - the day number shows ONLY when there's a real signal (hero) — never on
 *     every cell;
 *   - other reading days get the faint wash the calendar uses;
 *   - new/full moons render as the real MoonPhaseIcon.
 * Sparse: only days that carry something (hero, a reading, or a moon) are
 * drawn. Newest on top. Two lenses: by moon phase / by day of month.
 *
 * NOT extracted from OverlapStrip: the pull-match tints and perfect/best/
 * asterism rings live inside that component's pull-match closure, which is too
 * entangled to share without risking the live calendar. Those rings are the
 * fast follow.
 */
import { useMemo, useState } from "react";
import { Hash, Moon } from "lucide-react";
import { MoonPhaseIcon } from "@/components/moon/MoonPhaseIcon";
import { getPhaseOccurrences } from "@/lib/moon";
import { isoDayInTz } from "@/lib/time";

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

type DayInfo = { date: string; heroDrawn: boolean };
type Cell = {
  ymd: string;
  frac: number;
  hero: boolean;
  reading: boolean;
  isNew: boolean;
  isFull: boolean;
};
type Row = { key: string; label: string; cells: Cell[] };

type Props = {
  months: Array<{ days: DayInfo[] }>;
  readingsByDate: Record<string, unknown[]>;
  heroSet: boolean;
  timeRange: string;
  effectiveTz: string;
  onDayClick?: (ymd: string) => void;
};

function rangeDays(tr: string): number {
  const m = /^(\d+)d$/.exec(tr);
  return m ? Number(m[1]) : 365;
}

export function LunationStrip({
  months,
  readingsByDate,
  heroSet,
  timeRange,
  effectiveTz,
  onDayClick,
}: Props) {
  const [lens, setLens] = useState<"moon" | "day">("moon");

  const { moonRows, dayRows } = useMemo(() => {
    const tz = effectiveTz || "UTC";
    const now = new Date();
    const spanDays = rangeDays(timeRange);
    const cutoff = new Date(now.getTime() - spanDays * DAY_MS);
    const from = new Date(now.getTime() - (spanDays + 45) * DAY_MS);
    const monthsAhead = Math.ceil((spanDays + 60) / 30);

    const newMoons = getPhaseOccurrences("New Moon", from, monthsAhead).sort(
      (a, b) => a.getTime() - b.getTime(),
    );
    const newSet = new Set(newMoons.map((d) => isoDayInTz(d, tz)));
    const fullSet = new Set(
      getPhaseOccurrences("Full Moon", from, monthsAhead).map((d) =>
        isoDayInTz(d, tz),
      ),
    );
    const heroDays = new Set<string>();
    for (const m of months) {
      for (const d of m.days) if (d.heroDrawn) heroDays.add(d.date);
    }
    const hasReading = (ymd: string) =>
      (readingsByDate[ymd]?.length ?? 0) > 0;

    const mk = (ymd: string, frac: number): Cell | null => {
      const hero = heroDays.has(ymd);
      const reading = hasReading(ymd);
      const isNew = newSet.has(ymd);
      const isFull = fullSet.has(ymd);
      if (!hero && !reading && !isNew && !isFull) return null;
      return { ymd, frac, hero, reading, isNew, isFull };
    };

    // ---- Moon lens: new-moon -> next-new-moon buckets ----
    const moon: Row[] = [];
    for (let i = 0; i < newMoons.length - 1; i++) {
      const start = newMoons[i];
      const end = newMoons[i + 1];
      if (end.getTime() < cutoff.getTime()) continue;
      const dayYmds: string[] = [];
      let cur = new Date(start.getTime());
      while (cur.getTime() < end.getTime()) {
        dayYmds.push(isoDayInTz(cur, tz));
        cur = new Date(cur.getTime() + DAY_MS);
      }
      const len = Math.max(1, dayYmds.length);
      const cells: Cell[] = [];
      dayYmds.forEach((ymd, idx) => {
        const c = mk(ymd, len > 1 ? idx / (len - 1) : 0);
        if (c) cells.push(c);
      });
      const [, mm, dd] = isoDayInTz(start, tz).split("-").map(Number);
      moon.push({
        key: isoDayInTz(start, tz),
        label: `${MONTHS[mm - 1]} ${dd}`,
        cells,
      });
    }
    moon.reverse();

    // ---- Day lens: calendar-month buckets ----
    const day: Row[] = [];
    const nowYmd = isoDayInTz(now, tz);
    const [ny, nmo] = nowYmd.split("-").map(Number);
    const monthCount = Math.min(13, Math.ceil(spanDays / 30) + 1);
    for (let k = 0; k < monthCount; k++) {
      let y = ny;
      let mo = nmo - k;
      while (mo < 1) {
        mo += 12;
        y -= 1;
      }
      // eslint-disable-next-line no-restricted-syntax -- pure month-length arithmetic
      const dim = new Date(y, mo, 0).getDate();
      const cells: Cell[] = [];
      for (let d = 1; d <= dim; d++) {
        const ymd = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const c = mk(ymd, (d - 1) / 30);
        if (c) cells.push(c);
      }
      day.push({ key: `${y}-${mo}`, label: MONTHS[mo - 1], cells });
    }

    return { moonRows: moon, dayRows: day };
  }, [months, readingsByDate, timeRange, effectiveTz]);

  const rows = lens === "moon" ? moonRows : dayRows;

  return (
    <div style={{ padding: "0 20px 24px", flexShrink: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <button
          type="button"
          onClick={() => setLens((l) => (l === "moon" ? "day" : "moon"))}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            background: "var(--surface-card)",
            border: "1px solid var(--accent, var(--gold))",
            borderRadius: 8,
            color: "var(--color-foreground)",
            cursor: "pointer",
            padding: "5px 10px",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: 12,
          }}
        >
          {lens === "moon" ? (
            <Moon size={14} strokeWidth={1.5} aria-hidden="true" />
          ) : (
            <Hash size={14} strokeWidth={1.5} aria-hidden="true" />
          )}
          {lens === "moon" ? "By moon phase" : "By day of month"}
        </button>
        <span
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: 11,
            color: "var(--color-foreground)",
            opacity: 0.55,
          }}
        >
          {lens === "moon" ? "new \u2192 new" : "day 1 \u2192 31"}
        </span>
      </div>

      <div>
        {rows.map((row) => (
          <div
            key={row.key}
            style={{ position: "relative", height: 20, marginBottom: 4 }}
          >
            <span
              style={{
                position: "absolute",
                left: 0,
                top: 5,
                width: 34,
                textAlign: "right",
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: 9,
                color: "var(--color-foreground)",
                opacity: 0.45,
              }}
            >
              {row.label}
            </span>
            <div
              style={{
                position: "absolute",
                left: 40,
                right: 4,
                top: 10,
                height: 1,
                background: "var(--border-subtle)",
              }}
            />
            <div
              style={{ position: "absolute", left: 40, right: 4, top: 0, height: 20 }}
            >
              {row.cells.map((c) => {
                // Match the calendar fill rules (QuickLog OverlapStrip):
                //   hero        -> gold, ~0.9
                //   reading only -> accent 0.4 when NO hero, else faint 0.18
                // Day number shows ONLY on hero days (v1 signal set).
                const fill = c.hero
                  ? { background: "var(--gold, var(--accent))", opacity: 0.9 }
                  : heroSet
                    ? { background: "var(--color-foreground)", opacity: 0.18 }
                    : { background: "var(--accent, var(--gold))", opacity: 0.4 };
                const showCell = c.hero || c.reading;
                return (
                  <span
                    key={c.ymd}
                    style={{
                      position: "absolute",
                      top: 3,
                      left: `calc(${(c.frac * 100).toFixed(2)}% - 7px)`,
                      width: 14,
                      height: 14,
                    }}
                  >
                    {showCell && (
                      <button
                        type="button"
                        onClick={() => onDayClick?.(c.ymd)}
                        title={c.ymd}
                        style={{
                          position: "absolute",
                          inset: 0,
                          padding: "0 0 1px 2px",
                          cursor: "pointer",
                          border:
                            "1px solid color-mix(in oklab, var(--color-foreground) 12%, transparent)",
                          borderRadius: 3,
                          ...fill,
                          display: "flex",
                          alignItems: "flex-end",
                          justifyContent: "flex-start",
                          fontFamily: "var(--font-serif)",
                          fontStyle: "italic",
                          fontSize: 9,
                          lineHeight: 1,
                          color: c.hero
                            ? "var(--background)"
                            : "var(--color-foreground)",
                        }}
                      >
                        {c.hero ? Number(c.ymd.split("-")[2]) : ""}
                      </button>
                    )}
                    {(c.isFull || c.isNew) && (
                      <span
                        aria-hidden="true"
                        style={{
                          position: "absolute",
                          top: -3,
                          right: -3,
                          width: 9,
                          height: 9,
                          pointerEvents: "none",
                          zIndex: 4,
                        }}
                      >
                        <MoonPhaseIcon
                          phase={c.isFull ? "Full Moon" : "New Moon"}
                          size={9}
                        />
                      </span>
                    )}
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
