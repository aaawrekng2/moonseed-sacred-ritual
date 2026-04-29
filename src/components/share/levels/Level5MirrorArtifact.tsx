/**
 * Level 5 — The Mirror Artifact.
 *
 * The deepest, rarest share. Gallery-piece aesthetic. The artifact text
 * is centered and treated like a found poem. Heavy whitespace. No cards
 * shown prominently — the words are the artifact.
 *
 * Background: vellum / aged paper feel rendered with layered radial
 * tints, since we can't load image assets at capture time reliably.
 */
import type { ShareColor, ShareContext } from "../share-types";
import { ShareCardFrame } from "./share-card-shared";

export function Level5MirrorArtifact({
  ctx,
  color,
  artifactText,
}: {
  ctx: ShareContext;
  color: ShareColor;
  artifactText: string;
}) {
  const text = artifactText.trim();
  return (
    <ShareCardFrame
      guideName={ctx.guideName}
      accent={color.accent}
      // Vellum-ish layered warm tint.
      background={[
        `radial-gradient(ellipse at 50% 50%, rgba(252, 244, 224, 0.05) 0%, transparent 60%)`,
        `radial-gradient(circle at 25% 25%, ${color.glow} 0%, transparent 35%)`,
        `radial-gradient(circle at 75% 75%, ${color.glow} 0%, transparent 30%)`,
        `linear-gradient(180deg, #0c0a08 0%, #14110b 100%)`,
      ].join(", ")}
    >
      {/* Top hairline rule — gallery framing */}
      <div
        aria-hidden
        style={{
          width: 96,
          height: 1,
          background: color.accent,
          opacity: 0.6,
          margin: "0 auto",
        }}
      />
      <p
        style={{
          textAlign: "center",
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: 38,
          lineHeight: 1.7,
          maxWidth: 760,
          margin: "0 auto",
          opacity: 0.98,
          letterSpacing: "0.01em",
          whiteSpace: "pre-wrap",
        }}
      >
        {text || "—"}
      </p>
      <div
        aria-hidden
        style={{
          width: 96,
          height: 1,
          background: color.accent,
          opacity: 0.6,
          margin: "0 auto",
        }}
      />
      {/* Subtle attribution row above the standard footer. */}
      <div
        style={{
          textAlign: "center",
          fontFamily: "var(--font-sans)",
          fontSize: 16,
          letterSpacing: "0.32em",
          textTransform: "uppercase",
          opacity: 0.4,
          marginTop: 8,
        }}
      >
        Mirror Artifact
      </div>
    </ShareCardFrame>
  );
}
