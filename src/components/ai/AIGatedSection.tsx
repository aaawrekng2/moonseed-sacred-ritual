/**
 * Q42 — AIGatedSection.
 *
 * Reusable wrapper for any AI-powered insights section. Encodes the
 * Q42 contract: AI calls that fire as a side-effect of viewing a
 * screen require explicit seeker authorization (a "Generate" button).
 * Cached results show a "Last analyzed" timestamp so freshness is
 * visible without re-firing the model.
 */
import type { ReactNode } from "react";
import { Crown } from "lucide-react";
import { SectionHeader } from "@/components/insights/StalkerCardsSection";
import { formatTimeAgo } from "@/lib/dates";

export type AIGatedSectionProps = {
  title: string;
  caption: string;
  isPremium: boolean;
  reducePrompts: boolean;
  dataReady: boolean;
  dataReadyMessage: string;
  hasCachedResult: boolean;
  generatedAt: string | null;
  creditCost: number;
  onGenerate: () => void | Promise<void>;
  isGenerating: boolean;
  children?: ReactNode;
};

function openPremium(featureName: string) {
  window.dispatchEvent(
    new CustomEvent("moonseed:open-premium", {
      detail: { feature: featureName, featureName },
    }),
  );
}

export function AIGatedSection(props: AIGatedSectionProps) {
  const {
    title,
    caption,
    isPremium,
    reducePrompts,
    dataReady,
    dataReadyMessage,
    hasCachedResult,
    generatedAt,
    creditCost,
    onGenerate,
    isGenerating,
    children,
  } = props;

  // Reduced-prompt mode: single muted line, nothing else.
  if (!isPremium && reducePrompts) {
    return (
      <section className="space-y-2">
        <p
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body-sm)",
            color: "var(--color-foreground)",
            opacity: 0.5,
          }}
        >
          {title} — premium feature
        </p>
      </section>
    );
  }

  // Locked premium teaser.
  if (!isPremium) {
    return (
      <section className="space-y-3">
        <SectionHeader title={title} caption={caption} />
        <button
          type="button"
          onClick={() => openPremium(title)}
          className="flex w-full flex-col items-center justify-center gap-2 px-6 py-6 text-center"
          style={{
            background: "color-mix(in oklch, var(--cosmos, #0a0a14) 40%, transparent)",
            borderRadius: 14,
          }}
        >
          <Crown className="h-5 w-5" style={{ color: "var(--gold)" }} />
          <span
            style={{
              fontStyle: "italic",
              color: "var(--gold)",
              fontFamily: "var(--font-serif)",
              fontSize: "var(--text-body-sm)",
            }}
          >
            Unlock with premium
          </span>
        </button>
      </section>
    );
  }

  const TitleRow = (
    <div className="flex items-center gap-2">
      <SectionHeader title={title} caption={caption} />
      <Crown size={14} style={{ color: "var(--gold)", opacity: 0.7, marginLeft: -6 }} />
    </div>
  );

  if (isGenerating) {
    return (
      <section className="space-y-3">
        {TitleRow}
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
      </section>
    );
  }

  if (!dataReady) {
    return (
      <section className="space-y-3">
        {TitleRow}
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
          {dataReadyMessage}
        </div>
      </section>
    );
  }

  if (!hasCachedResult) {
    return (
      <section className="space-y-3">
        {TitleRow}
        <button
          type="button"
          onClick={() => void onGenerate()}
          className="w-full text-center"
          style={{
            background: "transparent",
            border: "1px solid color-mix(in oklch, var(--gold) 40%, transparent)",
            borderRadius: 14,
            padding: "12px 16px",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            color: "var(--gold)",
          }}
        >
          Generate — {creditCost} credit{creditCost === 1 ? "" : "s"}
        </button>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      {TitleRow}
      {children}
      <div
        className="flex items-center justify-between"
        style={{ marginTop: 4, paddingInline: 4 }}
      >
        <span
          style={{
            color: "var(--text-caption, var(--color-foreground))",
            opacity: 0.5,
            fontStyle: "italic",
            fontSize: "var(--text-caption, 0.75rem)",
          }}
        >
          Last analyzed: {generatedAt ? formatTimeAgo(generatedAt) : "—"}
        </span>
        <button
          type="button"
          onClick={() => void onGenerate()}
          style={{
            color: "var(--gold)",
            opacity: 0.7,
            background: "transparent",
            fontStyle: "italic",
            fontSize: "var(--text-caption, 0.75rem)",
            textDecoration: "underline",
          }}
        >
          Refresh
        </button>
      </div>
    </section>
  );
}