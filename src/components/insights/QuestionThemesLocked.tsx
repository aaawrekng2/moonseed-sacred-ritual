/**
 * EM-4 / Q42 — Question Themes section.
 *
 * Reads cached themes on mount; never auto-fires the AI. Tapping
 * "Generate" or "Refresh" inside AIGatedSection authorizes the call.
 */
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { usePremium } from "@/lib/premium";
import { useAuth } from "@/lib/auth";
import { useReducePremiumPrompts } from "@/lib/use-reduce-premium-prompts";
import { getQuestionThemes, type QuestionTheme } from "@/lib/insights.functions";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import type { InsightsFilters } from "@/lib/insights.types";
import { DEFAULT_FILTERS } from "@/lib/insights.types";
import { AIGatedSection } from "@/components/ai/AIGatedSection";

export function QuestionThemesLocked({ filters }: { filters?: InsightsFilters } = {}) {
  const effectiveFilters = filters ?? DEFAULT_FILTERS;
  const { user } = useAuth();
  const { isPremium } = usePremium(user?.id);
  const reducePrompts = useReducePremiumPrompts(user?.id);
  const fn = useServerFn(getQuestionThemes);

  const [themes, setThemes] = useState<QuestionTheme[] | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [questionCount, setQuestionCount] = useState<number>(0);
  const [isGenerating, setIsGenerating] = useState(false);

  // Cache-only read on mount / filter change. Never fires the model.
  useEffect(() => {
    if (!isPremium) return;
    let cancelled = false;
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        const r = await fn({ data: { ...effectiveFilters, cacheOnly: true }, headers });
        if (cancelled) return;
        if (r.ok) {
          setThemes(r.themes);
          setGeneratedAt(r.generatedAt ?? null);
        } else {
          setThemes(null);
          setGeneratedAt(null);
          if ("count" in r && typeof r.count === "number") setQuestionCount(r.count);
        }
      } catch {
        if (!cancelled) {
          setThemes(null);
          setGeneratedAt(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isPremium, effectiveFilters, fn]);

  const onGenerate = useCallback(async () => {
    setIsGenerating(true);
    try {
      const headers = await getAuthHeaders();
      const r = await fn({ data: effectiveFilters, headers });
      if (r.ok) {
        setThemes(r.themes);
        setGeneratedAt(r.generatedAt ?? new Date().toISOString());
      } else if ("count" in r && typeof r.count === "number") {
        setQuestionCount(r.count);
      }
    } finally {
      setIsGenerating(false);
    }
  }, [effectiveFilters, fn]);

  // dataReady uses cached question count when known; otherwise assume true
  // and let the server tell us if there aren't enough.
  const dataReady = questionCount === 0 || questionCount >= 5;

  return (
    <AIGatedSection
      title="Question Themes"
      caption="What you keep asking about."
      isPremium={isPremium}
      reducePrompts={reducePrompts}
      dataReady={dataReady}
      dataReadyMessage="Ask a few more questions — themes appear after 5 readings with questions."
      hasCachedResult={!!themes && themes.length > 0}
      generatedAt={generatedAt}
      creditCost={1}
      onGenerate={onGenerate}
      isGenerating={isGenerating}
    >
      {themes?.map((t) => (
        <div
          key={t.theme}
          className="p-3"
          style={{ background: "var(--surface-card)", borderRadius: 14 }}
        >
          <div className="flex items-center justify-between">
            <span
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: "var(--text-body)",
                color: "var(--color-foreground)",
              }}
            >
              {t.theme}
            </span>
            <span
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                color: "var(--gold)",
              }}
            >
              {t.percentage}%
            </span>
          </div>
          {t.sample_questions.length > 0 && (
            <ul
              style={{
                marginTop: 6,
                fontStyle: "italic",
                fontSize: "var(--text-body-sm)",
                opacity: 0.7,
                lineHeight: 1.5,
              }}
            >
              {t.sample_questions.slice(0, 2).map((q, i) => (
                <li key={i}>“{q}”</li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </AIGatedSection>
  );
}