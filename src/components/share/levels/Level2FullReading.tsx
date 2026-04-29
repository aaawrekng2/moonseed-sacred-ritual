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
      background={`linear-gradient(180deg, #07070d 0%, #14110a 55%, #1f1a10 100%), radial-gradient(ellipse at 50% 20%, ${color.glow} 0%, transparent 60%)`}
    >
      <ShareCardRow picks={ctx.picks} />
      {showQuestion && (
        <div
          style={{
            textAlign: "center",
            fontStyle: "italic",
            fontSize: 32,
            lineHeight: 1.35,
            opacity: 0.85,
            maxWidth: 760,
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
            fontSize: 30,
            lineHeight: 1.55,
            maxWidth: 820,
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
