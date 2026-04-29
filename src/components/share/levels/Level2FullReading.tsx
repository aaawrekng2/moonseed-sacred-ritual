/**
 * Level 2 — The Full Reading.
 *
 * The most common share. Cards across the top, optional question
 * below, then a flowing prose snippet of the interpretation. Warm
 * parchment gradient over cosmic dark.
 */
import type { ShareColor, ShareContext } from "../share-types";
import {
  ShareCardFrame,
  ShareCardRow,
  snippetFromOverview,
} from "./share-card-shared";

export function Level2FullReading({
  ctx,
  color,
  includeQuestion,
  includeInterpretation,
}: {
  ctx: ShareContext;
  color: ShareColor;
  includeQuestion: boolean;
  includeInterpretation: boolean;
}) {
  const showQuestion = includeQuestion && !!ctx.question?.trim();
  const snippet = includeInterpretation
    ? snippetFromOverview(ctx.interpretation.overview ?? "")
    : "";
  return (
    <ShareCardFrame
      guideName={ctx.guideName}
      accent={color.accent}
      background={`radial-gradient(ellipse at 50% 18%, ${color.glow.replace(/0\.35\)/, "0.8)")} 0%, transparent 60%), linear-gradient(180deg, color-mix(in oklab, ${color.accent} 5%, #07070d) 0%, color-mix(in oklab, ${color.accent} 4%, #14110a) 55%, color-mix(in oklab, ${color.accent} 6%, #1f1a10) 100%)`}
    >
      <ShareCardRow picks={ctx.picks} />
      {showQuestion && (
        <div
          style={{
            textAlign: "center",
            fontStyle: "italic",
            fontSize: 48,
            lineHeight: 1.4,
            opacity: 0.85,
            maxWidth: 860,
            margin: "0 auto",
          }}
        >
          “{ctx.question!.trim()}”
        </div>
      )}
      {snippet && (
        <p
          style={{
            textAlign: "center",
            fontFamily: "var(--font-serif)",
            fontSize: 40,
            lineHeight: 1.5,
            maxWidth: 880,
            margin: "0 auto",
            opacity: 0.95,
          }}
        >
          {snippet}
        </p>
      )}
    </ShareCardFrame>
  );
}
