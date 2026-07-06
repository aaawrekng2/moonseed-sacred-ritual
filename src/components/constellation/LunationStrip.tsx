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
import { useMemo } from "react";
import { CalendarDays, Hash, Moon, Sparkles } from "lucide-react";
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
  hoverStrokeHit: boolean;
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
  lens: "moon" | "day" | "numerology" | "weekday";
  onLensChange: (lens: "moon" | "day" | "numerology" | "weekday") => void;
  heroName: string;
  hoverStrokeYmds: Set<string>;
  pulseHoverDays: boolean;
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

// v2.99 — INTEGER day-distance alignment for the moon-phase lens. Each day sits
// a FIXED step from its NEAREST moon, so co-occurring days stack exactly by their
// day-distance: "new + n" always lands in one column; "full - n" and "full + n"
// always land in one column. New moon pins at x=0, full moon at x=0.5, next new
// moon at x=1. The only fuzzy spot is the dead-center day of a half — a 14- vs
// 15-day half makes "new + 7" and "full - 7" different days, off by one step —
// which is invisible now that the empty cells are gone. Ties (equidistant) count
// from the near anchor (new for the first half's start, full for its end).
const PHASE_STEP = 0.5 / 14.765; // one day as a fraction of half a synodic month
function clampFrac(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
function phaseFrac(idx: number, fullIdx: number, len: number): number {
  if (fullIdx <= 0 || fullIdx >= len) {
    // Partial edge row with no full moon: anchor new-left at the fixed step.
    return clampFrac(idx * PHASE_STEP, 0, 1);
  }
  if (idx <= fullIdx) {
    const afterNew = idx;
    const beforeFull = fullIdx - idx;
    return afterNew <= beforeFull
      ? clampFrac(afterNew * PHASE_STEP, 0, 0.5)
      : clampFrac(0.5 - beforeFull * PHASE_STEP, 0, 0.5);
  }
  const afterFull = idx - fullIdx;
  const beforeNextNew = len - idx; // next new moon sits at idx === len
  return afterFull <= beforeNextNew
    ? clampFrac(0.5 + afterFull * PHASE_STEP, 0.5, 1)
    : clampFrac(1 - beforeNextNew * PHASE_STEP, 0.5, 1);
}

function reduceTo1to9(n: number): number {
  let x = Math.abs(Math.floor(n));
  while (x > 9) {
    x = String(x)
      .split("")
      .reduce((sum, c) => sum + Number(c), 0);
  }
  return x < 1 ? 9 : x;
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
  lens,
  onLensChange,
  heroName,
  hoverStrokeYmds,
  pulseHoverDays,
  onDayClick,
  onDayHover,
  onDayHoverEnd,
}: Props) {

  const { moonRows, dayRows, numerologyRows, weekdayRows } = useMemo(() => {
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
      const hoverStrokeHit = hoverStrokeYmds.has(ymd);
      // v2.98 — drop cells that would render as only a faint base wash. With a
      // hero set, a non-hero / non-match reading day is visual clutter, so it
      // isn't drawn (this declutters the strip AND lets the alignment read). With
      // no hero, reading days still show (matches the calendar's markReadingDays).
      // Hero / match / asterism / moon days always draw.
      if (
        !heroDrawn &&
        matchCount === 0 &&
        !teal &&
        !isFull &&
        !isNew &&
        !hoverStrokeHit &&
        !(markReadingDays && hasReading)
      ) {
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
      } else if (isFull || isNew) {
        // v3.00 — moon-only cell: a very faint box behind the moon disc.
        bg = "var(--color-foreground)";
        opacity = 0.08;
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
        hoverStrokeHit,
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
      // v2.98 — proportional half-normalization: new moon pins at x=0, full moon
      // at x=0.5, next new moon at x=1. Each half is spread evenly over its own
      // day count, so full moons stack in the center column and new moons on the
      // left, regardless of the ~1-day variance in half length — that variance
      // disappears into the dropped empty cells. If no full moon falls in the row
      // (edge-of-window partial), anchor new-left and scale against a standard
      // 29.53-day cycle.
      const fullIdx = ymds.findIndex((y) => fullSet.has(y));
      const cells: Cell[] = [];
      ymds.forEach((ymd, idx) => {
        const c = build(ymd, phaseFrac(idx, fullIdx, len));
        if (c) cells.push(c);
      });
      const [, mm, dd] = isoDayInTz(start, tz).split("-").map(Number);
      moon.push({ key: isoDayInTz(start, tz), label: `${MONTHS[mm - 1]} ${dd}`, cells });
    }
    moon.reverse();

    // Day-of-month / numerology / day-of-week lenses — all month-bucketed;
    // only the column position (frac) differs per lens.
    const day: Row[] = [];
    const numerology: Row[] = [];
    const weekday: Row[] = [];
    const nowYmd = isoDayInTz(now, tz);
    const [ny, nmo] = nowYmd.split("-").map(Number);
    const monthCount = Math.min(13, Math.ceil(spanDays / 30) + 1);
    for (let k = 0; k < monthCount; k++) {
      let y = ny;
      let mo = nmo - k;
      while (mo < 1) { mo += 12; y -= 1; }
      // eslint-disable-next-line no-restricted-syntax -- pure month-length arithmetic
      const dim = new Date(y, mo, 0).getDate();
      const dayCells: Cell[] = [];
      const numCells: Cell[] = [];
      const dowCells: Cell[] = [];
      for (let d = 1; d <= dim; d++) {
        const ymd = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const base = build(ymd, 0);
        if (!base) continue;
        // by day of month: date 1-31 across the row
        dayCells.push({ ...base, frac: (d - 1) / 30 });
        // by numerology: personal-day number 1-9 (master numbers reduced)
        if (birthDate) {
          const digit = reduceTo1to9(personalDay(birthDate, y, mo, d).digit);
          numCells.push({ ...base, frac: (digit - 0.5) / 9 });
        }
        // by day of week: Sun(0)-Sat(6); noon-UTC avoids tz drift
        const dow = new Date(`${ymd}T12:00:00Z`).getUTCDay();
        dowCells.push({ ...base, frac: (dow + 0.5) / 7 });
      }
      const key = `${y}-${mo}`;
      const label = MONTHS[mo - 1];
      day.push({ key, label, cells: dayCells });
      if (birthDate) numerology.push({ key, label, cells: numCells });
      weekday.push({ key, label, cells: dowCells });
    }

    return {
      moonRows: moon,
      dayRows: day,
      numerologyRows: numerology,
      weekdayRows: weekday,
    };
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
    heroName,
    hoverStrokeYmds,
  ]);

  const rows =
    lens === "moon"
      ? moonRows
      : lens === "day"
        ? dayRows
        : lens === "numerology"
          ? numerologyRows
          : weekdayRows;
  const nextLens: Record<string, "moon" | "day" | "numerology" | "weekday"> = {
    moon: "day",
    day: "numerology",
    numerology: "weekday",
    weekday: "moon",
  };
  const lensLabel =
    lens === "moon"
      ? "By moon phase"
      : lens === "day"
        ? "By day of month"
        : lens === "numerology"
          ? "By numerology"
          : "By day of week";
  const lensNote =
    lens === "moon"
      ? "new \u2192 new"
      : lens === "day"
        ? "day 1 \u2192 31"
        : lens === "numerology"
          ? "1 \u2192 9"
          : "Sun \u2192 Sat";
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
          onClick={() => onLensChange(nextLens[lens])}
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
          ) : lens === "day" ? (
            <Hash size={14} strokeWidth={1.5} aria-hidden="true" />
          ) : lens === "numerology" ? (
            <Sparkles size={14} strokeWidth={1.5} aria-hidden="true" />
          ) : (
            <CalendarDays size={14} strokeWidth={1.5} aria-hidden="true" />
          )}
          {lensLabel}
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
          {lensNote}
        </span>
      </div>

      {lens === "numerology" && !birthDate ? (
        <div
          style={{
            padding: "18px 8px",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: 13,
            lineHeight: 1.5,
            color: "var(--color-foreground)",
            opacity: 0.7,
            textAlign: "center",
          }}
        >
          Add your birthday in Settings to use the numerology lens — it needs your
          birth data to give each day a personal number.
        </div>
      ) : (
      <div>
        {rows.map((row) => (
          <div key={row.key} style={{ position: "relative", height: 24, marginBottom: 2 }}>
            <span
              style={{
                position: "absolute",
                left: 0,
                top: 7,
                width: 46,
                textAlign: "left",
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
                left: 50,
                width: "min(680px, calc(100% - 54px))",
                top: 12,
                height: 1,
                background: "var(--border-subtle)",
              }}
            />
            <div style={{ position: "absolute", left: 50, width: "min(680px, calc(100% - 54px))", top: 0, height: 24 }}>
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
                    hoverStrokeHit={c.hoverStrokeHit}
                    traceColor="var(--trace-color, #5cead4)"
                    heroName={heroName}
                    effectivePullSize={pullSize}
                    tooltipText={c.tooltipText}
                    pulseHoverDays={pulseHoverDays}
                    asterismBadgeHovered={false}
                    dayReadingIds={c.readingIds}
                    isFullMoon={c.isFull}
                    isNewMoon={c.isNew}
                    fullMoonOpacity={0.5}
                    onDayClick={onDayClick ? (date) => onDayClick(date) : undefined}
                    onDayHover={onDayHover}
                    onDayHoverEnd={onDayHoverEnd}
                  />
                </span>
              ))}
              {/* v3.01 — faint wrap marker at the next-new-moon end (x=1): the
                  cycle loops up to the next row's new moon. Flipped vertically so
                  it reads as wrapping UP, and dim so it's not mistaken for a
                  logged day. */}
              <span
                aria-hidden="true"
                title="Next new moon"
                style={{
                  position: "absolute",
                  bottom: 32,
                  left: "calc(100% - 13px)",
                  width: 26,
                  textAlign: "center",
                  fontSize: 26,
                  lineHeight: 1,
                  color: "var(--color-foreground)",
                  opacity: 0.3,
                  transform: "scaleY(-1)",
                  transformOrigin: "bottom",
                  pointerEvents: "none",
                }}
              >
                {"\u21B5"}
              </span>
            </div>
          </div>
        ))}
      </div>
      )}
    </div>
  );
}
