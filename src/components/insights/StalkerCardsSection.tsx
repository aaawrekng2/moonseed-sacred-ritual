import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { getStalkerCards } from "@/lib/insights.functions";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import { useActiveDeckImage } from "@/lib/active-deck";
import { getCardImagePath } from "@/lib/tarot";
import { Lock } from "lucide-react";
import type { InsightsFilters, StalkerCardsResult } from "@/lib/insights.types";
import { StalkerSparkline } from "./StalkerSparkline";
import { usePremium } from "@/lib/premium";
import { useAuth } from "@/lib/auth";

/** EK-1 — Stalker Cards section in the Cards tab. */
export function StalkerCardsSection({ filters }: { filters: InsightsFilters }) {
  const fn = useServerFn(getStalkerCards);
  const navigate = useNavigate();
  const [data, setData] = useState<StalkerCardsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const resolveImage = useActiveDeckImage();
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

  const days = filters.timeRange === "7d" ? 7 : filters.timeRange === "30d" ? 30 : filters.timeRange === "12m" ? 365 : 90;
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
          const url = resolveImage(s.cardId, "thumbnail") ?? getCardImagePath(s.cardId);
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
              <img
                src={url}
                alt={s.cardName}
                style={{ width: 48, height: 84, objectFit: "cover", borderRadius: 6 }}
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
                  <PremiumReflection />
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
function PremiumReflection() {
  return (
    <div
      className="mt-2 inline-flex items-center rounded-full px-2 py-1"
      style={{
        background: "color-mix(in oklch, var(--gold) 12%, transparent)",
        color: "var(--gold)",
        fontStyle: "italic",
        fontFamily: "var(--font-serif)",
        fontSize: "var(--text-caption, 0.7rem)",
      }}
    >
      Reflection generating…
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

export function EmptyNote({ text }: { text: string }) {
  return (
    <div
      className="rounded-lg p-4 text-center"
      style={{
        background: "var(--surface-card)",
        fontStyle: "italic",
        fontSize: "var(--text-body-sm)",
        opacity: 0.75,
      }}
    >
      {text}
    </div>
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