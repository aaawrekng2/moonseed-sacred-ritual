/**
 * Level 1 — The Single Pull.
 *
 * Triggered right after card flip, before AI interpretation arrives.
 * Minimal, card-forward, deep cosmic black background. The accent
 * color glows softly behind the card(s). No interpretation text — this
 * is the moment of revelation.
 */
import type { ShareColor, ShareContext } from "../share-types";
import { ShareCardFrame, ShareCardRow } from "./share-card-shared";

export function Level1SinglePull({
  ctx,
  color,
  includeQuestion,
}: {
  ctx: ShareContext;
  color: ShareColor;
  includeQuestion: boolean;
}) {
  const showQuestion = includeQuestion && !!ctx.question?.trim();
  return (
    <ShareCardFrame
      guideName={ctx.guideName}
      accent={color.accent}
      background={`radial-gradient(ellipse at 50% 38%, ${color.glow.replace(/0\.35\)/, "0.7)")} 0%, transparent 60%), #06060c`}
    >
      {showQuestion && (
        <div
          style={{
            textAlign: "center",
            fontStyle: "italic",
            fontSize: 56,
            lineHeight: 1.4,
            opacity: 0.92,
            maxWidth: 860,
            margin: "0 auto",
          }}
        >
          “{ctx.question!.trim()}”
        </div>
      )}
      <ShareCardRow picks={ctx.picks} />
    </ShareCardFrame>
  );
}
