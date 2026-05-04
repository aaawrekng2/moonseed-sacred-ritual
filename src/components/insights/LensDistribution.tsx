/**
 * EM-3 — Lens distribution. 4 tiles, gold ring on dominant.
 */
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Eye } from "lucide-react";
import { getLensDistribution } from "@/lib/insights.functions";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import type { InsightsFilters } from "@/lib/insights.types";
import { SectionHeader, SkeletonRow } from "./StalkerCardsSection";

type Lens = { lensId: string; name: string; count: number };
type Data = {
  lenses: Lens[];
  totalDeepReadings: number;
  dominantLens: string | null;
  allEven: boolean;
  hasAnyLens: boolean;
};

export function LensDistribution({ filters }: { filters: InsightsFilters }) {
  const fn = useServerFn(getLensDistribution);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        const r = (await fn({ data: filters, headers })) as Data;
        if (!cancelled) {
          setData(r);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filters, fn]);

  if (!loading && data && data.totalDeepReadings === 0 && !data.hasAnyLens) {
    return null;
  }

  const total = data?.lenses.reduce((s, l) => s + l.count, 0) ?? 0;
  const dominantName =
    data?.lenses.find((l) => l.lensId === data.dominantLens)?.name ?? null;

  return (
    <section className="space-y-3">
      <SectionHeader title="Lens distribution" caption="The angle you most often choose." />
      {loading && <SkeletonRow />}
      {!loading && data && (
        <>
          {data.totalDeepReadings > 0 && (
            <p
              className="text-center"
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: "var(--text-caption, 0.75rem)",
                opacity: 0.7,
              }}
            >
              You've completed {data.totalDeepReadings} deep reading
              {data.totalDeepReadings === 1 ? "" : "s"} (each contains all four lenses).
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            {data.lenses.map((l) => {
              const isDominant = l.lensId === data.dominantLens;
              const pct = total > 0 ? Math.round((l.count / total) * 100) : 0;
              return (
                <div
                  key={l.lensId}
                  className="p-4"
                  style={{
                    background: "var(--surface-card)",
                    borderRadius: 16,
                    border: isDominant
                      ? "1px solid color-mix(in oklab, var(--gold) 60%, transparent)"
                      : "1px solid transparent",
                    boxShadow: isDominant
                      ? "0 0 24px -8px color-mix(in oklab, var(--gold) 40%, transparent)"
                      : undefined,
                  }}
                >
                  <div className="mb-2 flex items-center gap-2">
                    <Eye
                      size={14}
                      style={{ color: isDominant ? "var(--gold)" : "var(--color-foreground)" }}
                    />
                    <span
                      style={{
                        fontFamily: "var(--font-serif)",
                        fontStyle: "italic",
                        fontSize: "var(--text-body-sm)",
                        color: isDominant ? "var(--gold)" : "var(--color-foreground)",
                      }}
                    >
                      {l.name}
                    </span>
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-serif)",
                      fontStyle: "italic",
                      fontSize: "var(--text-display, 1.5rem)",
                      color: "var(--gold)",
                    }}
                  >
                    {l.count}
                  </div>
                  <div
                    style={{
                      fontSize: "var(--text-caption, 0.7rem)",
                      opacity: 0.55,
                      fontStyle: "italic",
                    }}
                  >
                    {pct}% of chosen lenses
                  </div>
                </div>
              );
            })}
          </div>
          <p
            className="text-center"
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-caption, 0.75rem)",
              opacity: 0.65,
            }}
          >
            {data.allEven || !dominantName
              ? "You move evenly between the lenses."
              : `${dominantName} is the lens you reach for most.`}
          </p>
        </>
      )}
    </section>
  );
}