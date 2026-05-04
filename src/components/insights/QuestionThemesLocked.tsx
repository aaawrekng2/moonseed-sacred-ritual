/**
 * EM-4 — Question Themes (locked premium teaser).
 * No data fetched. Tap dispatches `moonseed:open-premium`.
 */
import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { SectionHeader } from "./StalkerCardsSection";
import { usePremium } from "@/lib/premium";
import { useAuth } from "@/lib/auth";
import { getQuestionThemes, type QuestionTheme } from "@/lib/insights.functions";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import type { InsightsFilters } from "@/lib/insights.types";
import { DEFAULT_FILTERS } from "@/lib/insights.types";

const FAKE_THEMES: Array<{ name: string; pct: number }> = [
  { name: "Career & Path", pct: 28 },
  { name: "Boundaries", pct: 22 },
  { name: "Self-Trust", pct: 18 },
  { name: "Relationships", pct: 17 },
  { name: "Creative Voice", pct: 15 },
];

export function QuestionThemesLocked({ filters }: { filters?: InsightsFilters } = {}) {
  const { user } = useAuth();
  const { isPremium } = usePremium(user?.id);
  if (isPremium) {
    return <PremiumQuestionThemes filters={filters ?? DEFAULT_FILTERS} />;
  }
  const open = () =>
    window.dispatchEvent(
      new CustomEvent("moonseed:open-premium", {
        detail: { feature: "Question Themes", featureName: "Question Themes" },
      }),
    );
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <SectionHeader title="Question Themes" caption="What you keep asking about." />
        <Lock size={14} style={{ color: "var(--gold)", opacity: 0.7, marginLeft: -8 }} />
      </div>
      <div className="relative">
        <div
          className="space-y-2 pointer-events-none select-none"
          style={{ filter: "blur(8px)" }}
          aria-hidden
        >
          {FAKE_THEMES.map((t) => (
            <div
              key={t.name}
              className="flex items-center justify-between p-3"
              style={{ background: "var(--surface-card)", borderRadius: 14 }}
            >
              <span
                style={{
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: "var(--text-body-sm)",
                  color: "var(--color-foreground)",
                }}
              >
                {t.name}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  color: "var(--gold)",
                }}
              >
                {t.pct}%
              </span>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={open}
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center"
          style={{
            background: "color-mix(in oklch, var(--cosmos, #0a0a14) 40%, transparent)",
            borderRadius: 14,
          }}
        >
          <Lock className="h-5 w-5" style={{ color: "var(--gold)" }} />
          <span
            style={{
              fontStyle: "italic",
              color: "var(--gold)",
              fontFamily: "var(--font-serif)",
              fontSize: "var(--text-body-sm)",
            }}
          >
            Premium feature — AI-analyzed themes from your saved questions.
          </span>
          <span
            style={{
              fontStyle: "italic",
              color: "var(--color-foreground)",
              opacity: 0.7,
              fontSize: "var(--text-caption, 0.75rem)",
            }}
          >
            Tap to unlock
          </span>
        </button>
      </div>
    </section>
  );
}

function PremiumQuestionThemes({ filters }: { filters: InsightsFilters }) {
  const fn = useServerFn(getQuestionThemes);
  const [themes, setThemes] = useState<QuestionTheme[] | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error">("loading");
  useEffect(() => {
    let cancelled = false;
    setState("loading");
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        const r = await fn({ data: filters, headers });
        if (cancelled) return;
        if (r.ok) {
          setThemes(r.themes);
          setState("ready");
        } else if (r.error === "insufficient_questions") {
          setState("empty");
        } else {
          setState("error");
        }
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filters, fn]);

  return (
    <section className="space-y-3">
      <SectionHeader title="Question Themes" caption="What you keep asking about." />
      {state === "loading" && (
        <div
          className="p-4 text-center"
          style={{
            background: "color-mix(in oklch, var(--gold) 10%, transparent)",
            borderRadius: 14,
            color: "var(--gold)",
            fontStyle: "italic",
            fontFamily: "var(--font-serif)",
          }}
        >
          Reading your questions…
        </div>
      )}
      {state === "empty" && (
        <div
          className="p-4 text-center"
          style={{
            background: "var(--surface-card)",
            borderRadius: 14,
            fontStyle: "italic",
            fontSize: "var(--text-body-sm)",
            opacity: 0.75,
          }}
        >
          Ask a few more questions in your readings — themes appear once you have at least 5.
        </div>
      )}
      {state === "error" && (
        <div
          className="p-4 text-center"
          style={{
            background: "var(--surface-card)",
            borderRadius: 14,
            fontStyle: "italic",
            fontSize: "var(--text-body-sm)",
            opacity: 0.75,
          }}
        >
          Themes are unavailable right now. Try again shortly.
        </div>
      )}
      {state === "ready" &&
        themes?.map((t) => (
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
    </section>
  );
}