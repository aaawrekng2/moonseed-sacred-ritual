/**
 * v2.11 — OverviewMoonCalendar.
 *
 * The Insights → Overview calendar, styled to match the manual-entry
 * (constellation) calendar: a multi-month grid of small day cells, gold
 * radial-fill on the days the *featured* card appeared, and principal
 * moon-phase markers (new / first quarter / full / last quarter) — the
 * same moon treatment the manual-entry grid carries.
 *
 * Standalone by design: the manual-entry OverlapStrip is welded to
 * QuickLog's slot-row / teal / co-occurrence logic, so this replicates the
 * look without touching that surface. Hover uses a native title (the
 * canonical calendar-cell tooltip); tapping a day the card appeared opens
 * that reading.
 *
 * Date keying routes through @/lib/time (tz-aware); month math is pure
 * string/number arithmetic — no Date getters/setters.
 */
import { useMemo, useState } from "react";
import {
  currentTzOrFallback,
  dayOfWeekInTz,
  isoDayInTz,
  nowYmdInTz,
  parseIsoDay,
} from "@/lib/time";
import { formatMonthYear, formatDateLong } from "@/lib/dates";
import { getPhaseOccurrences, type MoonPhaseName } from "@/lib/moon";
import { MoonPhaseIcon } from "@/components/moon/MoonPhaseIcon";
import { ReadingDetailModal } from "@/components/reading/ReadingDetailModal";

type Appearance = { readingId: string; date: string };

const PRINCIPAL: MoonPhaseName[] = [
  "New Moon",
  "First Quarter",
  "Full Moon",
  "Last Quarter",
];

function isLeap(y: number): boolean {
  return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
}
function daysInMonth(y: number, m1: number): number {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
    m1 - 1
  ];
}
const pad = (n: number) => String(n).padStart(2, "0");

export function OverviewMoonCalendar({
  appearances,
  cardName,
  tz,
  maxMonths = 12,
}: {
  appearances: Appearance[];
  cardName: string;
  tz?: string;
  /** Cap on visible months (manual-entry tops out at 12). */
  maxMonths?: number;
}) {
  const zone = useMemo(() => {
    if (tz && tz.length > 0) return tz;
    try {
      return currentTzOrFallback(
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      );
    } catch {
      return "UTC";
    }
  }, [tz]);

  const [openReadingId, setOpenReadingId] = useState<string | null>(null);

  // Draw days: ymd -> readingIds that featured this card that day.
  const drawDays = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const a of appearances) {
      const ymd = isoDayInTz(new Date(a.date), zone);
      const arr = m.get(ymd) ?? [];
      arr.push(a.readingId);
      m.set(ymd, arr);
    }
    return m;
  }, [appearances, zone]);

  // Visible months: earliest appearance month .. current month, capped.
  const months = useMemo(() => {
    const today = nowYmdInTz(zone);
    const [ty, tm] = today.split("-").map(Number);
    let earliest = today;
    for (const ymd of drawDays.keys()) if (ymd < earliest) earliest = ymd;
    const [ey, em] = earliest.split("-").map(Number);
    let span = (ty - ey) * 12 + (tm - em) + 1;
    if (span < 1) span = 1;
    if (span > maxMonths) span = maxMonths;
    const list: { y: number; m: number }[] = [];
    let yy = ty;
    let mm = tm;
    for (let i = 0; i < span; i++) {
      list.unshift({ y: yy, m: mm });
      mm -= 1;
      if (mm < 1) {
        mm = 12;
        yy -= 1;
      }
    }
    return list;
  }, [drawDays, zone, maxMonths]);

  // Principal moon-phase days across the visible range: ymd -> phase.
  const moonMap = useMemo(() => {
    const map = new Map<string, MoonPhaseName>();
    if (months.length === 0) return map;
    const first = months[0];
    const fromDate = parseIsoDay(`${first.y}-${pad(first.m)}-01`, zone);
    const monthsAhead = months.length + 1;
    for (const phase of PRINCIPAL) {
      for (const d of getPhaseOccurrences(phase, fromDate, monthsAhead)) {
        map.set(isoDayInTz(d, zone), phase);
      }
    }
    return map;
  }, [months, zone]);

  if (appearances.length === 0) return null;

  return (
    <div
      style={{
        background: "var(--surface-card)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-lg, 14px)",
        padding: "16px 16px 18px",
      }}
    >
      <p
        style={{
          margin: "0 0 4px",
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-body-sm)",
          color: "var(--color-foreground-muted)",
        }}
      >
        Gold marks the days {cardName} appeared · moons show the phase.
      </p>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          alignItems: "center",
          margin: "8px 0 14px",
          fontSize: "var(--text-caption)",
          color: "var(--color-foreground-muted)",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 13,
              height: 13,
              borderRadius: 3,
              background:
                "radial-gradient(ellipse at center, color-mix(in oklab, var(--gold) 85%, transparent), color-mix(in oklab, var(--gold) 35%, transparent) 60%, transparent)",
            }}
          />
          drawn
        </span>
        {(["Full Moon", "New Moon", "First Quarter"] as MoonPhaseName[]).map(
          (p) => (
            <span
              key={p}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <MoonPhaseIcon phase={p} size={11} ariaHidden />
              {p === "Full Moon"
                ? "full"
                : p === "New Moon"
                  ? "new"
                  : "quarter"}
            </span>
          ),
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: "18px 14px",
        }}
      >
        {months.map(({ y, m }) => {
          const lead = dayOfWeekInTz(
            parseIsoDay(`${y}-${pad(m)}-01`, zone),
            zone,
          );
          const n = daysInMonth(y, m);
          return (
            <div key={`${y}-${m}`}>
              <div
                style={{
                  fontSize: "var(--text-caption)",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: "var(--color-foreground-muted)",
                  marginBottom: 6,
                }}
              >
                {formatMonthYear(`${y}-${pad(m)}-01T12:00:00`)}
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(7, 20px)",
                  gap: 2,
                }}
              >
                {Array.from({ length: lead }).map((_, i) => (
                  <div key={`b${i}`} style={{ width: 20, height: 20 }} />
                ))}
                {Array.from({ length: n }).map((_, i) => {
                  const day = i + 1;
                  const ymd = `${y}-${pad(m)}-${pad(day)}`;
                  const reads = drawDays.get(ymd);
                  const isDraw = !!reads && reads.length > 0;
                  const phase = moonMap.get(ymd);
                  const longDate = formatDateLong(`${ymd}T12:00:00`);
                  const title = isDraw
                    ? `${longDate} — ${cardName} drawn${reads!.length > 1 ? ` (${reads!.length}×)` : ""}${phase ? ` · ${phase}` : ""}`
                    : phase
                      ? `${longDate} · ${phase}`
                      : longDate;
                  const cell = (
                    <div
                      title={title}
                      style={{
                        position: "relative",
                        width: 20,
                        height: 20,
                        borderRadius: 4,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 9,
                        color: isDraw
                          ? "var(--background)"
                          : "var(--color-foreground-muted)",
                        background: isDraw
                          ? "radial-gradient(ellipse at center, color-mix(in oklab, var(--gold) 90%, transparent), color-mix(in oklab, var(--gold) 45%, transparent) 55%, transparent 85%)"
                          : "transparent",
                        cursor: isDraw ? "pointer" : "default",
                      }}
                    >
                      {day}
                      {phase && (
                        <span
                          style={{
                            position: "absolute",
                            top: 0,
                            right: 0,
                            lineHeight: 0,
                          }}
                        >
                          <MoonPhaseIcon phase={phase} size={7} ariaHidden />
                        </span>
                      )}
                    </div>
                  );
                  if (!isDraw) return <div key={ymd}>{cell}</div>;
                  return (
                    <button
                      key={ymd}
                      type="button"
                      onClick={() => setOpenReadingId(reads![0])}
                      aria-label={title}
                      style={{
                        padding: 0,
                        border: "none",
                        background: "none",
                        cursor: "pointer",
                      }}
                    >
                      {cell}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {openReadingId && (
        <ReadingDetailModal
          readingId={openReadingId}
          onClose={() => setOpenReadingId(null)}
        />
      )}
    </div>
  );
}
