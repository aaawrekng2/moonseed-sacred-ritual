import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { getStalkerCards, getStalkerReflection } from "@/lib/insights.functions";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import { CardImage } from "@/components/card/CardImage";
import { Lock } from "lucide-react";
import type { InsightsFilters, StalkerCardsResult } from "@/lib/insights.types";
import { StalkerSparkline } from "./StalkerSparkline";
import { usePremium } from "@/lib/premium";
import { useAuth } from "@/lib/auth";
import { EmptyNote } from "@/components/ui/empty-note";

/** EK-1 — Stalker Cards section in the Cards tab. */
export function StalkerCardsSection({ filters }: { filters: InsightsFilters }) {
  const fn = useServerFn(getStalkerCards);
  const navigate = useNavigate();
  const [data, setData] = useState<StalkerCardsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const { isPremium } = usePremium(user?.id);

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

  // FK-4 — "12m" renamed to "365d".
  const days = filters.timeRange === "7d" ? 7 : filters.timeRange === "30d" ? 30 : filters.timeRange === "365d" ? 365 : 90;
  const windowEnd = Date.now();
  const windowStart = windowEnd - days * 24 * 60 * 60 * 1000;

  return (
    <section className="space-y-3">
      <SectionHeader title="Stalker Cards" caption="Cards that keep showing up." />
      {loading && <SkeletonRow />}
      {!loading && data && data.stalkerCards.length === 0 && (
        <EmptyNote text="No stalker cards yet. Cards become stalkers after appearing 3 or more times within your time window." />
      )}
      {!loading &&
        data?.stalkerCards.map((s) => {
          return (
            <button
              key={s.cardId}
              type="button"
              onClick={() =>
                navigate({ to: "/insights/card/$cardId", params: { cardId: String(s.cardId) } })
              }
              className="flex w-full items-center gap-3 p-3 text-left transition-opacity hover:opacity-95"
              style={{
                background: "var(--surface-card)",
                borderRadius: 14,
              }}
            >
              {/* EY-7 — unified card render. */}
              <CardImage
                cardId={s.cardId}
                variant="face"
                size="custom"
                widthPx={48}
                ariaLabel={s.cardName}
              />
              <div className="flex-1">
                <div
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontStyle: "italic",
                    fontSize: "var(--text-body)",
                  }}
                >
                  {s.cardName}
                </div>
                <div
                  style={{
                    fontStyle: "italic",
                    fontSize: "var(--text-body-sm)",
                    opacity: 0.7,
                  }}
                >
                  {s.count} appearances
                </div>
                <div className="mt-1">
                  <StalkerSparkline
                    dates={s.appearances.map((a) => a.date)}
                    windowStart={windowStart}
                    windowEnd={windowEnd}
                  />
                </div>
                {isPremium ? (
                  <PremiumReflection
                    cardId={s.cardId}
                    count={s.count}
                    latestDate={s.appearances[0]?.date ?? new Date().toISOString()}
                  />
                ) : (
                  <LockedReflection />
                )}
              </div>
            </button>
          );
        })}
    </section>
  );
}

/**
 * EO-3 — Placeholder for premium users. EP builds the actual AI
 * `getStalkerReflection` server fn; this stub just confirms the gate
 * is open.
 */
function PremiumReflection({
  cardId,
  count,
  latestDate,
}: {
  cardId: number;
  count: number;
  latestDate: string;
}) {
  const fn = useServerFn(getStalkerReflection);
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        const r = await fn({ data: { cardId, count, latestDate, sampleQuestions: [] }, headers });
        if (cancelled) return;
        if (r.ok) setText(r.reflection);
        else setErr(true);
      } catch {
        if (!cancelled) setErr(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cardId, count, latestDate, fn]);
  if (err) return null;
  return (
    <div
      className="mt-2"
      style={{
        color: "var(--gold)",
        fontStyle: "italic",
        fontFamily: "var(--font-serif)",
        fontSize: "var(--text-body-sm)",
        opacity: text ? 0.9 : 0.55,
        lineHeight: 1.4,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {text ?? "Reflection generating…"}
    </div>
  );
}

function LockedReflection() {
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        window.dispatchEvent(
          new CustomEvent("moonseed:open-premium", { detail: { feature: "Stalker Reflections" } }),
        );
      }}
      className="mt-2 inline-flex items-center gap-1.5 rounded-full px-2 py-1"
      style={{
        background: "color-mix(in oklch, var(--gold) 14%, transparent)",
        color: "var(--gold)",
        fontStyle: "italic",
        fontSize: "var(--text-caption, 0.7rem)",
      }}
    >
      <Lock className="h-3 w-3" /> Reflection — premium
    </div>
  );
}

export function SectionHeader({ title, caption }: { title: string; caption?: string }) {
  return (
    <header className="space-y-1">
      <h2
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-heading-md, 1.4rem)",
          color: "var(--color-foreground)",
        }}
      >
        {title}
      </h2>
      {caption && (
        <p
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body-sm)",
            opacity: 0.65,
          }}
        >
          {caption}
        </p>
      )}
    </header>
  );
}

export function SkeletonRow() {
  return (
    <div
      className="animate-pulse"
      style={{ height: 110, background: "var(--surface-card)", borderRadius: 14, opacity: 0.5 }}
    />
  );
}