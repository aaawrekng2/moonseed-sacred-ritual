/**
 * EM-4 — Question Themes (locked premium teaser).
 * No data fetched. Tap dispatches `moonseed:open-premium`.
 */
import { Lock } from "lucide-react";
import { SectionHeader } from "./StalkerCardsSection";

const FAKE_THEMES: Array<{ name: string; pct: number }> = [
  { name: "Career & Path", pct: 28 },
  { name: "Boundaries", pct: 22 },
  { name: "Self-Trust", pct: 18 },
  { name: "Relationships", pct: 17 },
  { name: "Creative Voice", pct: 15 },
];

export function QuestionThemesLocked() {
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