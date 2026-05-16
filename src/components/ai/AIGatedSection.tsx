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
import { SectionHeader } from "@/components/insights/StalkerCardsSection";
import { formatTimeAgo } from "@/lib/dates";

export type AIGatedSectionProps = {
  title: string;
  caption: string;
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

export function AIGatedSection(props: AIGatedSectionProps) {
  const {
    title,
    caption,
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

  // Reduced-prompt mode: render a single muted line in place of the
  // generate button so the seeker can hide AI affordances entirely
  // without losing the section header.
  if (reducePrompts && !hasCachedResult) {
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
          {title}
        </p>
      </section>
    );
  }

  const TitleRow = (
    <SectionHeader title={title} caption={caption} />
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