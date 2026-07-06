/**
 * v2.95 — LunationStrip. Now renders the SHARED CalendarDayCell (extracted from
 * OverlapStrip in v2.94), so it marks days EXACTLY like the Insights -> Patterns
 * calendar — gold hero fill, accent match tints, perfect/best rings, green/teal
 * asterism rings, conditional day numbers, moon markers — just laid out along a
 * per-lunation / per-month LINE instead of a 7-column grid.
 *
 * The per-day SIGNALS are computed here by replicating the calendar's rules
 * (hero gold, countDayMatches, matchOpacity, teal trace) on data ConstellationPage
 * already has (heroCardId, pullCardIds, tealSelectedIds, mode, each day's
 * sameDayCardIds). The calendar's own code (OverlapStrip) is NOT touched.
 *
 * Sparse: only days carrying a signal (hero, match, asterism, a reading, or a
 * new/full moon) are drawn. Newest on top. Two lenses: moon phase / day of month.
 */
import { useMemo, useState } from "react";
import { Hash, Moon } from "lucide-react";
import { CalendarDayCell, type DayCellSignals } from "@/components/tabletop/QuickLog";
import { getPhaseOccurrences } from "@/lib/moon";
import { isoDayInTz } from "@/lib/time";
import { personalDay } from "@/lib/numerology";
import { formatDateLong } from "@/lib/dates";

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

type DayInfo = { date: string; heroDrawn?: boolean; sameDayCardIds?: number[] };
type Reading = { id: string; cardIds: number[] };

type Cell = {
  ymd: string;
  frac: number;
  heroDrawn: boolean;
  matchCount: number;
  isPerfectMatch: boolean;
  isBestAvailable: boolean;
  tealTraceHit: boolean;
  bg: string;
  opacity: number;
  textColor: string;
  displayNumber: number;
  isFull: boolean;
  isNew: boolean;
  readingIds: string[];
  tooltipText: string;
};
type Row = { key: string; label: string; cells: Cell[] };

type Props = {
  months: Array<{ days: DayInfo[] }>;
  readingsByDate: Record<string, Reading[]>;
  heroCardId: number | null;
  pullCardIds: number[];
  tealSelectedIds: number[];
  mode: "day" | "pull";
  calendarNumberMode: "dates" | "numerology";
  birthDate: string | null;
  timeRange: string;
  effectiveTz: string;
  heroName: string;
  onDayClick?: (ymd: string) => void;
  onDayHover?: (info: {
    date: string;
    anchorX: number;
    anchorY: number;
    targetRect: DOMRect | null;
    signals: DayCellSignals;
    tooltipText: string;
  }) => void;
  onDayHoverEnd?: (date: string) => void;
};

function rangeDays(tr: string): number {
  const m = /^(\d+)d$/.exec(tr);
  return m ? Number(m[1]) : 365;
}
function matchOpacity(matches: number, pullSize: number): number {
  if (matches <= 0 || pullSize <= 0) return 0;
  return 0.15 + (matches / pullSize) * 0.8;
}

export function LunationStrip({
  months,
  readingsByDate,
  heroCardId,
  pullCardIds,
  tealSelectedIds,
  mode,
  calendarNumberMode,
  birthDate,
  timeRange,
  effectiveTz,
  heroName,
  onDayClick,
  onDayHover,
  onDayHoverEnd,
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

    // Per-day card data (from the calendar's own server data) + hero days.
    const dayCards: Record<string, number[]> = {};
    const heroDays = new Set<string>();
    for (const mo of months) {
      for (const d of mo.days) {
        dayCards[d.date] = d.sameDayCardIds ?? [];
        if (d.heroDrawn) heroDays.add(d.date);
      }
    }

    // Replicate the calendar's match/teal computation (non-atlas path).
    const pullSet = new Set(pullCardIds);
    const effectivePullSize = pullSet.size;
    const tealSet = new Set(tealSelectedIds);
    const countMatches = (ymd: string): number => {
      if (effectivePullSize === 0) return 0;
      if (mode === "day") {
        const s = new Set(dayCards[ymd] ?? []);
        let n = 0;
        for (const id of pullSet) if (s.has(id)) n++;
        return n;
      }
      let best = 0;
      for (const r of readingsByDate[ymd] ?? []) {
        const s = new Set(r.cardIds);
        let n = 0;
        for (const id of pullSet) if (s.has(id)) n++;
        if (n > best) best = n;
      }
      return best;
    };
    const tealHit = (ymd: string): boolean => {
      if (tealSet.size === 0) return false;
      if (mode === "day") {
        const s = new Set(dayCards[ymd] ?? []);
        for (const id of tealSet) if (!s.has(id)) return false;
        return true;
      }
      for (const r of readingsByDate[ymd] ?? []) {
        const s = new Set(r.cardIds);
        let ok = true;
        for (const id of tealSet) if (!s.has(id)) { ok = false; break; }
        if (ok) return true;
      }
      return false;
    };
    let maxMatch = 0;
    if (effectivePullSize > 1) {
      for (const ymd of Object.keys(dayCards)) {
        const m = countMatches(ymd);
        if (m > maxMatch) maxMatch = m;
      }
    }
    const markReadingDays = heroCardId == null;

    const build = (ymd: string, frac: number): Cell | null => {
      const heroDrawn = heroDays.has(ymd);
      const matchCount = countMatches(ymd);
      const teal = tealHit(ymd);
      const hasReading = (readingsByDate[ymd]?.length ?? 0) > 0;
      const isFull = fullSet.has(ymd);
      const isNew = newSet.has(ymd);
      if (!heroDrawn && matchCount === 0 && !teal && !hasReading && !isFull && !isNew) {
        return null;
      }
      let bg = "var(--color-foreground)";
      let opacity = 0.18;
      if (heroDrawn && heroCardId != null) {
        bg = "var(--gold, var(--accent))";
        opacity = 0.9;
      } else if (matchCount > 0) {
        const op = matchOpacity(matchCount, effectivePullSize);
        if (op > 0) {
          bg = "var(--accent, var(--gold))";
          opacity = op;
        }
      } else if (markReadingDays && hasReading) {
        bg = "var(--accent, var(--gold))";
        opacity = 0.4;
      }
      let textColor: string;
      if (heroDrawn && heroCardId != null) {
        textColor = "var(--background)";
      } else if (matchCount > 0 || (markReadingDays && hasReading)) {
        textColor = "var(--accent-foreground, var(--background))";
      } else {
        textColor = "var(--color-foreground)";
      }
      const isPerfectMatch =
        matchCount > 0 && matchCount === effectivePullSize && effectivePullSize >= 2;
      const isBestAvailable =
        !isPerfectMatch &&
        matchCount >= 2 &&
        matchCount === maxMatch &&
        effectivePullSize > 1;
      const parts = ymd.split("-").map(Number);
      const displayNumber =
        calendarNumberMode === "numerology" && birthDate
          ? personalDay(birthDate, parts[0], parts[1], parts[2]).digit
          : parts[2];
      // Replicate the calendar's multi-line tooltip so the shared popover
      // shows identical text on hover.
      const lines: string[] = [formatDateLong(`${ymd}T00:00:00`)];
      if (heroDrawn && heroCardId != null && heroName) {
        lines.push(`You drew ${heroName} here.`);
      }
      if (matchCount > 0) {
        if (isPerfectMatch) {
          lines.push(
            `Your full spread (all ${pullCardIds.length} cards) was drawn here.`,
          );
        } else if (isBestAvailable) {
          lines.push(
            `${matchCount} of ${pullCardIds.length} cards in your spread were drawn here — the best match in your calendar.`,
          );
        } else {
          lines.push(
            `${matchCount} of ${pullCardIds.length} cards in your spread were drawn here.`,
          );
        }
      }
      if (teal && tealSet.size >= 2) {
        const starWord = tealSet.size === 1 ? "star" : "stars";
        lines.push(`Your asterism (${tealSet.size} ${starWord}) all met here.`);
      }
      return {
        ymd,
        frac,
        heroDrawn,
        matchCount,
        isPerfectMatch,
        isBestAvailable,
        tealTraceHit: teal,
        bg,
        opacity,
        textColor,
        displayNumber,
        isFull,
        isNew,
        readingIds: (readingsByDate[ymd] ?? []).map((r) => r.id),
        tooltipText: lines.join("\n"),
      };
    };

    // Moon lens
    const moon: Row[] = [];
    for (let i = 0; i < newMoons.length - 1; i++) {
      const start = newMoons[i];
      const end = newMoons[i + 1];
      if (end.getTime() < cutoff.getTime()) continue;
      // v2.97 — bucket by CALENDAR DAY over the half-open span
      // [thisNewMoonDay, nextNewMoonDay): each new moon OPENS exactly one
      // lunation and is not repeated as the previous row's closing day.
      // (Stepping 24h off the raw instant let the boundary new-moon day land
      // in both rows — the "May 16 shows twice" bug.)
      const startYmd = isoDayInTz(start, tz);
      const endYmd = isoDayInTz(end, tz);
      const ymds: string[] = [];
      let stepper = new Date(`${startYmd}T12:00:00Z`);
      let curYmd = startYmd;
      while (curYmd < endYmd) {
        ymds.push(curYmd);
        stepper = new Date(stepper.getTime() + DAY_MS);
        curYmd = isoDayInTz(stepper, "UTC");
      }
      const len = Math.max(1, ymds.length);
      const cells: Cell[] = [];
      ymds.forEach((ymd, idx) => {
        const c = build(ymd, len > 1 ? idx / (len - 1) : 0);
        if (c) cells.push(c);
      });
      const [, mm, dd] = isoDayInTz(start, tz).split("-").map(Number);
      moon.push({ key: isoDayInTz(start, tz), label: `${MONTHS[mm - 1]} ${dd}`, cells });
    }
    moon.reverse();

    // Day lens
    const day: Row[] = [];
    const nowYmd = isoDayInTz(now, tz);
    const [ny, nmo] = nowYmd.split("-").map(Number);
    const monthCount = Math.min(13, Math.ceil(spanDays / 30) + 1);
    for (let k = 0; k < monthCount; k++) {
      let y = ny;
      let mo = nmo - k;
      while (mo < 1) { mo += 12; y -= 1; }
      // eslint-disable-next-line no-restricted-syntax -- pure month-length arithmetic
      const dim = new Date(y, mo, 0).getDate();
      const cells: Cell[] = [];
      for (let d = 1; d <= dim; d++) {
        const ymd = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const c = build(ymd, (d - 1) / 30);
        if (c) cells.push(c);
      }
      day.push({ key: `${y}-${mo}`, label: MONTHS[mo - 1], cells });
    }

    return { moonRows: moon, dayRows: day };
  }, [
    months,
    readingsByDate,
    heroCardId,
    pullCardIds,
    tealSelectedIds,
    mode,
    calendarNumberMode,
    birthDate,
    timeRange,
    effectiveTz,
  ]);

  const rows = lens === "moon" ? moonRows : dayRows;
  const pullSize = new Set(pullCardIds).size;

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
          <div key={row.key} style={{ position: "relative", height: 26, marginBottom: 5 }}>
            <span
              style={{
                position: "absolute",
                left: 0,
                top: 8,
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
                top: 13,
                height: 1,
                background: "var(--border-subtle)",
              }}
            />
            <div style={{ position: "absolute", left: 40, right: 4, top: 0, height: 26 }}>
              {row.cells.map((c) => (
                <span
                  key={c.ymd}
                  style={{
                    position: "absolute",
                    top: 2,
                    left: `calc(${(c.frac * 100).toFixed(2)}% - 11px)`,
                    width: 22,
                    height: 22,
                  }}
                >
                  <CalendarDayCell
                    day={{ date: c.ymd, heroDrawn: c.heroDrawn }}
                    layout="grid12"
                    bg={c.bg}
                    opacity={c.opacity}
                    textColor={c.textColor}
                    displayNumber={c.displayNumber}
                    matchCount={c.matchCount}
                    isPerfectMatch={c.isPerfectMatch}
                    isBestAvailable={c.isBestAvailable}
                    tealTraceHit={c.tealTraceHit}
                    hoverStrokeHit={false}
                    traceColor="var(--trace-color, #5cead4)"
                    heroName={heroName}
                    effectivePullSize={pullSize}
                    tooltipText={c.tooltipText}
                    pulseHoverDays={false}
                    asterismBadgeHovered={false}
                    dayReadingIds={c.readingIds}
                    isFullMoon={c.isFull}
                    isNewMoon={c.isNew}
                    onDayClick={onDayClick ? (date) => onDayClick(date) : undefined}
                    onDayHover={onDayHover}
                    onDayHoverEnd={onDayHoverEnd}
                  />
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
