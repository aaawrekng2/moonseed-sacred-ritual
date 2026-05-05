/**
 * FQ-3 — Occurrence list. Loads the underlying readings for a stalker's
 * appearances and renders a tappable row for each.
 */
import { useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { getReadingsByIds } from "@/lib/insights.functions";
import { getAuthHeaders } from "@/lib/server-fn-auth";

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

export function StalkerOccurrenceList({
  appearances,
  onOpenReading,
}: {
  appearances: Array<{ readingId: string; date: string }>;
  onOpenReading: (readingId: string) => void;
}) {
  const fetchReadings = useServerFn(getReadingsByIds);
  const [readings, setReadings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const ids = useMemo(
    () => Array.from(new Set(appearances.map((a) => a.readingId))).slice(0, 100),
    [appearances],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetchReadings({ data: { readingIds: ids }, headers });
        if (cancelled) return;
        setReadings(res.readings ?? []);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[stalkers] occurrences fetch failed", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ids, fetchReadings]);

  if (loading) {
    return (
      <div className="text-xs italic text-muted-foreground">Loading occurrences…</div>
    );
  }

  if (readings.length === 0) {
    return (
      <div className="text-xs italic text-muted-foreground">No occurrences found.</div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <h4
        className="text-sm font-serif italic"
        style={{ color: "var(--color-foreground)", opacity: 0.7 }}
      >
        Occurrences ({readings.length})
      </h4>
      <ul className="flex flex-col divide-y divide-border/20">
        {readings.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => onOpenReading(r.id)}
              className="flex w-full items-center justify-between gap-3 rounded px-2 py-2 text-left transition-colors hover:bg-muted/30"
            >
              <div className="flex flex-col">
                <span className="text-sm">{formatDate(r.created_at)}</span>
                <span className="text-xs text-muted-foreground">
                  {r.spread_type ?? "Reading"}
                  {r.question ? ` · ${truncate(r.question, 60)}` : ""}
                </span>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}