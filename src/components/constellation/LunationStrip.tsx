/**
 * v2.92 — LunationStrip. Replaces the calendar strip on the /lunations page.
 *
 * Two lenses (one toggle):
 *  - "By moon phase": rows are lunations (new moon → next new moon), cells
 *    placed by phase fraction so full moons land in the same band across rows.
 *  - "By day of month": rows are calendar months, cells placed by date number
 *    (1–31), so the same date stacks in a column — the numerology view the
 *    day-of-week-offset calendars can't give.
 *
 * Sparse: a faint per-row track with ONLY notable cells drawn — days with
 * draws (heat-colored, day number) plus new/full moon markers (the real
 * MoonPhaseIcon). Newest on top. v1 renders draws + moons; the gold-match /
 * teal-asterism rings are a fast follow.
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

type Cell = {
  ymd: string;
  frac: number;
  count: number;
  isNew: boolean;
  isFull: boolean;
};
type Row = { key: string; label: string; cells: Cell[] };

type Props = {
  readingsByDate: Record<string, unknown[]>;
  timeRange: string;
  effectiveTz: string;
  onDayClick?: (ymd: string) => void;
};

function rangeDays(tr: string): number {
  const m = /^(\d+)d$/.exec(tr);
  return m ? Number(m[1]) : 365;
}

function heatColor(count: number): string {
  return count <= 1
    ? "color-mix(in oklab, var(--accent, var(--gold)) 30%, transparent)"
    : count === 2
      ? "color-mix(in oklab, var(--accent, var(--gold)) 58%, transparent)"
      : "var(--accent, var(--gold))";
}

export function LunationStrip({
  readingsByDate,
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
    const countOf = (ymd: string) => readingsByDate[ymd]?.length ?? 0;

    // ---- Moon lens: new-moon → next-new-moon buckets ----
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
        const count = countOf(ymd);
        const isNew = idx === 0;
        const isFull = fullSet.has(ymd);
        if (count > 0 || isNew || isFull) {
          cells.push({
            ymd,
            frac: len > 1 ? idx / (len - 1) : 0,
            count,
            isNew,
            isFull,
          });
        }
      });
      moon.push({
        key: isoDayInTz(start, tz),
        label: (() => {
          const [, m, d] = isoDayInTz(start, tz).split("-").map(Number);
          return `${MONTHS[m - 1]} ${d}`;
        })(),
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
        const count = countOf(ymd);
        const isNew = newSet.has(ymd);
        const isFull = fullSet.has(ymd);
        if (count > 0 || isNew || isFull) {
          cells.push({ ymd, frac: (d - 1) / 30, count, isNew, isFull });
        }
      }
      day.push({ key: `${y}-${mo}`, label: `${MONTHS[mo - 1]}`, cells });
    }

    return { moonRows: moon, dayRows: day };
  }, [readingsByDate, timeRange, effectiveTz]);

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
              {row.cells.map((c) => (
                <button
                  key={c.ymd}
                  type="button"
                  onClick={() => onDayClick?.(c.ymd)}
                  title={
                    c.ymd + (c.count ? ` \u00b7 ${c.count} draw${c.count > 1 ? "s" : ""}` : "")
                  }
                  style={{
                    position: "absolute",
                    top: c.count > 0 ? 2 : 4,
                    left: `calc(${(c.frac * 100).toFixed(2)}% - ${c.count > 0 ? 7.5 : 6}px)`,
                    width: c.count > 0 ? 15 : 12,
                    height: c.count > 0 ? 15 : 12,
                    padding: 0,
                    border: "none",
                    background:
                      c.count > 0 ? heatColor(c.count) : "transparent",
                    borderRadius: c.count > 0 ? 2 : "50%",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: "var(--font-serif)",
                    fontSize: 8,
                    color:
                      c.count >= 2 ? "#160f2c" : "var(--color-foreground)",
                    zIndex: c.count > 0 ? 2 : 3,
                  }}
                >
                  {c.count > 0 ? (
                    Number(c.ymd.split("-")[2])
                  ) : c.isFull ? (
                    <MoonPhaseIcon phase="Full Moon" size={12} />
                  ) : (
                    <MoonPhaseIcon phase="New Moon" size={12} />
                  )}
                </button>
              ))}
              {/* Moon markers for days that ALSO have draws — a small disc
                  above the heat cell so the phase still reads. */}
              {row.cells
                .filter((c) => c.count > 0 && (c.isFull || c.isNew))
                .map((c) => (
                  <div
                    key={`m-${c.ymd}`}
                    aria-hidden="true"
                    style={{
                      position: "absolute",
                      top: -4,
                      left: `calc(${(c.frac * 100).toFixed(2)}% - 4px)`,
                      width: 8,
                      height: 8,
                      pointerEvents: "none",
                      zIndex: 4,
                    }}
                  >
                    <MoonPhaseIcon
                      phase={c.isFull ? "Full Moon" : "New Moon"}
                      size={8}
                    />
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
