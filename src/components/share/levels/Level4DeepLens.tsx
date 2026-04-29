/**
 * Level 4 — The Deep Lens.
 *
 * Premium tier visible from outside the app. Mist textures, layered
 * depth, subtle gold luminosity — visibly more atmospheric than the
 * three regular levels. Anyone seeing this on social should immediately
 * understand it is something deeper than a regular reading.
 */
import type { ShareColor, ShareContext } from "../share-types";
import { ShareCardFrame, ShareCardRow, snippetFromOverview } from "./share-card-shared";

export type DeepLensSelection = {
  /** Display label, e.g. "Present Resonance" / "Shadow Layer". */
  label: string;
  /** The lens prose body. */
  body: string;
};

export function Level4DeepLens({
  ctx,
  color,
  lens,
  /** Show all picks faintly behind the mist, or just the first as anchor. */
  variant = "anchor",
}: {
  ctx: ShareContext;
  color: ShareColor;
  lens: DeepLensSelection;
  variant?: "anchor" | "spread";
}) {
  const snippet = snippetFromOverview(lens.body, 420);
  const anchorPick = variant === "anchor" ? ctx.picks.slice(0, 1) : ctx.picks;
  return (
    <ShareCardFrame
      guideName={ctx.guideName}
      accent={color.accent}
      // Layered mist: dark base + soft glow halo + faint vertical band.
      background={[
        `radial-gradient(ellipse at 50% 30%, ${color.glow.replace(/0\.35\)/, "0.7)")} 0%, transparent 60%)`,
        `radial-gradient(circle at 20% 80%, ${color.glow} 0%, transparent 40%)`,
        `radial-gradient(circle at 80% 70%, ${color.glow} 0%, transparent 45%)`,
        `linear-gradient(180deg, #050509 0%, #0a0a14 50%, #0e0a18 100%)`,
      ].join(", ")}
    >
      <div
        style={{
          textAlign: "center",
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: 44,
          letterSpacing: "0.06em",
          color: color.accent,
          opacity: 1,
          textShadow: `0 0 28px ${color.glow}`,
        }}
      >
        {lens.label}
      </div>
      {anchorPick.length > 0 && (
        <div
          style={{
            opacity: 0.55,
            filter: `drop-shadow(0 0 36px ${color.glow})`,
          }}
        >
          <ShareCardRow
            picks={anchorPick}
            maxWidth={variant === "anchor" ? 360 : 880}
          />
        </div>
      )}
      {snippet && (
        <p
          style={{
            textAlign: "center",
            fontFamily: "var(--font-serif)",
            fontSize: 56,
            lineHeight: 1.5,
            maxWidth: 900,
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
