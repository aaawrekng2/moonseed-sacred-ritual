/**
 * EM-1 — Tag cloud. Tap a tag to filter Cards tab by that tag.
 */
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getTagCloud } from "@/lib/insights.functions";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import type { InsightsFilters } from "@/lib/insights.types";
import { SectionHeader, SkeletonRow } from "./StalkerCardsSection";
import { EmptyNote } from "@/components/ui/empty-note";

type TagItem = { tagId: string; name: string; count: number };

export function TagCloud({
  filters,
  onTagSelect,
}: {
  filters: InsightsFilters;
  onTagSelect?: (tagId: string) => void;
}) {
  const fn = useServerFn(getTagCloud);
  const [data, setData] = useState<{
    tags: TagItem[];
    uniqueTags: number;
    totalReadings: number;
    taggedReadings: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        const r = await fn({ data: filters, headers });
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

  const max = useMemo(() => Math.max(1, ...(data?.tags ?? []).map((t) => t.count)), [data]);
  const activeTag = filters.tagIds[0] ?? null;

  return (
    <section className="space-y-3">
      <SectionHeader title="Themes you carry" caption="Tags you reach for, sized by frequency." />
      {loading && <SkeletonRow />}
      {!loading && data && data.tags.length === 0 && (
        <EmptyNote text="Your themes will surface here as you add tags to your readings." />
      )}
      {!loading && data && data.tags.length > 0 && (
        <>
          <div
            className="flex flex-wrap items-baseline justify-center"
            style={{ gap: 14, padding: "8px 4px" }}
          >
            {data.tags.map((t) => {
              const ratio = t.count / max;
              const fontSize = 12 + ratio * 22; // 12px → 34px
              const opacity = 0.45 + ratio * 0.55;
              const isActive = activeTag === t.tagId;
              const isTop = t === data.tags[0];
              return (
                <button
                  key={t.tagId}
                  type="button"
                  onClick={() => onTagSelect?.(t.tagId)}
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontStyle: "italic",
                    fontSize: `${isTop ? Math.max(fontSize, 28) : fontSize}px`,
                    color: "var(--gold)",
                    opacity,
                    lineHeight: 1.05,
                    background: "transparent",
                    border: "none",
                    padding: "2px 4px",
                    cursor: "pointer",
                    textDecoration: isActive ? "underline" : "none",
                    textUnderlineOffset: 4,
                  }}
                  aria-label={`${t.name} (${t.count})`}
                >
                  {t.name}
                </button>
              );
            })}
          </div>
          <p
            className="text-center"
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-caption, 0.75rem)",
              opacity: 0.6,
            }}
          >
            You've used {data.uniqueTags} unique tag{data.uniqueTags === 1 ? "" : "s"} across{" "}
            {data.taggedReadings} reading{data.taggedReadings === 1 ? "" : "s"}.
          </p>
        </>
      )}
    </section>
  );
}