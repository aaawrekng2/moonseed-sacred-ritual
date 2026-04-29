/**
 * Level 3 — The Spread Position.
 *
 * Triggered when the user wants to share a single position from a
 * 3-card or Celtic Cross spread (e.g. just "Past" or just "The
 * Outcome"). Position label sits prominently at the top, the single
 * card sits below, and the per-position interpretation flows beneath.
 */
import type { ShareColor, ShareContext } from "../share-types";
import {
  ShareCardFrame,
  ShareCardRow,
  snippetFromOverview,
} from "./share-card-shared";

export function Level3SpreadPosition({
  ctx,
  color,
  positionIndex,
}: {
  ctx: ShareContext;
  color: ShareColor;
  /** Which position from `ctx.picks` / `ctx.positionLabels` to feature. */
  positionIndex: number;
}) {
  const safeIndex = Math.max(0, Math.min(ctx.picks.length - 1, positionIndex));
  const pick = ctx.picks[safeIndex];
  const label =
    ctx.positionLabels[safeIndex] ?? `Card ${safeIndex + 1}`;
  const positionInterpretation =
    ctx.interpretation.positions[safeIndex]?.interpretation ?? "";
  const snippet = snippetFromOverview(positionInterpretation, 320);

  return (
    <ShareCardFrame
      guideName={ctx.guideName}
      accent={color.accent}
      background={`linear-gradient(180deg, #07070d 0%, #14110a 60%, #1c1810 100%), radial-gradient(ellipse at 50% 28%, ${color.glow} 0%, transparent 55%)`}
    >
      <div
        style={{
          textAlign: "center",
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: 80,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: color.accent,
          opacity: 1,
          textShadow: `0 0 24px ${color.glow}`,
        }}
      >
        {label}
      </div>
      {pick && <ShareCardRow picks={[pick]} maxWidth={520} />}
      {snippet && (
        <p
          style={{
            textAlign: "center",
            fontFamily: "var(--font-serif)",
            fontSize: 52,
            lineHeight: 1.5,
            maxWidth: 860,
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
