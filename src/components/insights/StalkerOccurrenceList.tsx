/**
 * FU-14 — Occurrence list. Loads the underlying readings for a stalker's
 * appearances and renders a tappable canonical ReadingRow for each.
 */
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getReadingsByIds } from "@/lib/insights.functions";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import { ReadingRow } from "@/components/ui/reading-row";

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
      <ul className="flex flex-col">
        {readings.map((r) => (
          <li key={r.id}>
            <ReadingRow
              readingId={r.id}
              question={r.question ?? null}
              cardIds={r.card_ids ?? []}
              createdAt={r.created_at}
              onOpen={onOpenReading}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
