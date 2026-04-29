import { useMemo, useState } from "react";
import { getPhaseOccurrences } from "@/lib/moon";
import {
  getDatePartsInTz,
  getYmdInTz,
  formatTimeInTz,
  useTimezone,
} from "@/lib/use-timezone";

/**
 * Dev-only panel: simulate Pacific / London / Tokyo and inspect the
 * computed peak YMD for the May 31, 2026 full moon as observed in each
 * zone. Compares against the seeker's current effectiveTz so we can see
 * timezone-driven calendar drift at a glance.
 */
const ZONES: Array<{ label: string; tz: string }> = [
  { label: "Pacific", tz: "America/Los_Angeles" },
  { label: "London", tz: "Europe/London" },
  { label: "Tokyo", tz: "Asia/Tokyo" },
];

export function MoonPeakDebugPanel() {
  const { effectiveTz } = useTimezone();
  const [simTz, setSimTz] = useState<string>(effectiveTz);

  // Find the full moon nearest May 31, 2026.
  const peakUtc = useMemo<Date | null>(() => {
    try {
      const anchor = new Date(Date.UTC(2026, 4, 20, 12, 0, 0)); // May 20, 2026
      const list = getPhaseOccurrences("Full Moon", anchor, 2);
      return list[0] ?? null;
    } catch {
      return null;
    }
  }, []);

  const rows = ZONES.map(({ label, tz }) => {
    if (!peakUtc) return { label, tz, ymd: "—", time: "—", hour: NaN };
    const ymd = getYmdInTz(peakUtc, tz);
    const time = formatTimeInTz(peakUtc, tz);
    const hour = getDatePartsInTz(peakUtc, tz).hour;
    return { label, tz, ymd, time, hour };
  });

  return (
    <div
      className="mx-auto mt-4 max-w-2xl rounded-lg border border-border/40 bg-background/40 p-3 font-mono text-xs"
      data-debug="moon-peak"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-muted-foreground">
          May 2026 Full Moon UTC: {peakUtc ? peakUtc.toISOString() : "—"}
        </span>
        <span className="text-muted-foreground">
          effectiveTz: <span className="text-foreground">{effectiveTz}</span>
        </span>
      </div>

      <div className="mb-2 flex flex-wrap gap-1">
        {ZONES.map(({ label, tz }) => (
          <button
            key={tz}
            type="button"
            onClick={() => setSimTz(tz)}
            className={
              "rounded border px-2 py-1 transition-colors " +
              (simTz === tz
                ? "border-primary bg-primary/20 text-foreground"
                : "border-border/50 text-muted-foreground hover:text-foreground")
            }
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setSimTz(effectiveTz)}
          className="rounded border border-border/50 px-2 py-1 text-muted-foreground hover:text-foreground"
        >
          reset
        </button>
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1 pr-2 font-normal">Zone</th>
            <th className="py-1 pr-2 font-normal">Peak YMD</th>
            <th className="py-1 pr-2 font-normal">Local time</th>
            <th className="py-1 font-normal">Side</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const side =
              Number.isNaN(r.hour)
                ? "—"
                : r.hour < 6 || r.hour >= 21
                  ? r.hour < 12
                    ? "left seam"
                    : "right seam"
                  : "hidden (daytime)";
            const isSim = simTz === r.tz;
            return (
              <tr
                key={r.tz}
                className={isSim ? "text-foreground" : "text-muted-foreground"}
              >
                <td className="py-1 pr-2">{r.label}</td>
                <td className="py-1 pr-2">{r.ymd}</td>
                <td className="py-1 pr-2">{r.time}</td>
                <td className="py-1">{side}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="mt-2 text-[10px] text-muted-foreground">
        Simulated tz: <span className="text-foreground">{simTz}</span> — peak
        YMD here:{" "}
        <span className="text-foreground">
          {peakUtc ? getYmdInTz(peakUtc, simTz) : "—"}
        </span>
      </div>
    </div>
  );
}