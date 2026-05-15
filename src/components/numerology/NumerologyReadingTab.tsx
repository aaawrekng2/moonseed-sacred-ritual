/**
 * Q52f — Numerology Reading tab. Token-gated AI synthesis.
 */
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { usePremium } from "@/lib/premium";
import { useAuth } from "@/lib/auth";
import { useReducePremiumPrompts } from "@/lib/use-reduce-premium-prompts";
import { getNumerologyReading } from "@/lib/insights.functions";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import { AIGatedSection } from "@/components/ai/AIGatedSection";
import type { InsightsFilters } from "@/lib/insights.types";

export function NumerologyReadingTab({ filters }: { filters: InsightsFilters }) {
  const { user } = useAuth();
  const { isPremium } = usePremium(user?.id);
  const reducePrompts = useReducePremiumPrompts(user?.id);
  const fn = useServerFn(getNumerologyReading);

  const [reading, setReading] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [hasBirthDate, setHasBirthDate] = useState<boolean | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    if (!isPremium) return;
    let cancelled = false;
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        const r = await fn({
          data: { ...filters, cacheOnly: true },
          headers,
        });
        if (cancelled) return;
        if (r.ok) {
          setReading(r.reading);
          setGeneratedAt(r.generatedAt);
          setHasBirthDate(true);
        } else if (r.reason === "no_birth_date") {
          setHasBirthDate(false);
        } else {
          setReading(null);
          setGeneratedAt(null);
          setHasBirthDate(true);
        }
      } catch {
        if (!cancelled) {
          setReading(null);
          setGeneratedAt(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isPremium, filters, fn]);

  const onGenerate = useCallback(async () => {
    setIsGenerating(true);
    try {
      const headers = await getAuthHeaders();
      const r = await fn({
        data: { ...filters, cacheOnly: false },
        headers,
      });
      if (r.ok) {
        setReading(r.reading);
        setGeneratedAt(r.generatedAt);
        setHasBirthDate(true);
      } else if (r.reason === "no_birth_date") {
        setHasBirthDate(false);
      }
    } finally {
      setIsGenerating(false);
    }
  }, [filters, fn]);

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AIGatedSection
        title="Numerology Synthesis"
        caption="Your chart, woven into prose."
        isPremium={isPremium}
        reducePrompts={reducePrompts}
        dataReady={hasBirthDate !== false}
        dataReadyMessage="Add your birth date in Settings → Blueprint to generate a reading."
        hasCachedResult={!!reading}
        generatedAt={generatedAt}
        creditCost={3}
        onGenerate={onGenerate}
        isGenerating={isGenerating}
      >
        {reading && (
          <div
            style={{
              background: "var(--surface-card)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-md, 10px)",
              padding: 16,
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-body)",
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
            }}
          >
            {reading}
          </div>
        )}
      </AIGatedSection>
    </section>
  );
}