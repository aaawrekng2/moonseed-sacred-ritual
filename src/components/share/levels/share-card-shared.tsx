/**
 * Building blocks shared by every ShareLevel*.tsx.
 *
 * Each level component renders a fixed 1080x1920 surface so the
 * captured PNG is sized correctly for Instagram Stories. The on-screen
 * preview re-uses the same DOM but is CSS-scaled (transform: scale)
 * by the parent ShareBuilder so we never maintain two layouts.
 */
import type { CSSProperties, ReactNode } from "react";
import { getCardImagePath } from "@/lib/tarot";
import type { SharePick } from "../share-types";

export const SHARE_CARD_W = 1080;
export const SHARE_CARD_H = 1920;

/**
 * Outer 1080x1920 frame. Children fill it. The shared footer is
 * rendered automatically so every level gets the same brand sign-off.
 */
export function ShareCardFrame({
  background,
  children,
  guideName,
  accent,
}: {
  background: CSSProperties["background"];
  children: ReactNode;
  guideName: string;
  accent: string;
}) {
  return (
    <div
      style={{
        width: SHARE_CARD_W,
        height: SHARE_CARD_H,
        position: "relative",
        background,
        color: "var(--color-foreground)",
        overflow: "hidden",
        fontFamily: "var(--font-serif)",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          padding: "160px 80px 100px",
          gap: 40,
        }}
      >
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-start",
            gap: 40,
          }}
        >
          {children}
        </div>
        <ShareCardFooter guideName={guideName} accent={accent} />
      </div>
    </div>
  );
}

/**
 * Oracle name (small italic) over Moonseed.com (smaller still).
 * Identical across every level — the brand sign-off.
 */
export function ShareCardFooter({
  guideName,
  accent,
}: {
  guideName: string;
  accent: string;
}) {
  return (
    <div
      style={{
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        marginTop: 32,
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: 32,
          opacity: 0.85,
          letterSpacing: "0.04em",
          color: accent,
        }}
      >
        {guideName}
      </div>
      <div
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 22,
          letterSpacing: "0.32em",
          textTransform: "uppercase",
          opacity: 0.55,
        }}
      >
        moonseed.com
      </div>
    </div>
  );
}

/**
 * Render a row of card images. Used by Levels 1 + 2.
 * Cards size proportionally to fit within `maxWidth`.
 */
export function ShareCardRow({
  picks,
  maxWidth = 880,
  cardAspect = 1.6,
}: {
  picks: SharePick[];
  maxWidth?: number;
  cardAspect?: number;
}) {
  const n = Math.max(1, picks.length);
  const gap = n > 1 ? 24 : 0;
  const cardWidth = Math.min(360, Math.floor((maxWidth - gap * (n - 1)) / n));
  const cardHeight = Math.round(cardWidth * cardAspect);
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        gap,
      }}
    >
      {picks.map((p) => (
        <div
          key={p.id}
          style={{
            width: cardWidth,
            height: cardHeight,
            borderRadius: 16,
            overflow: "hidden",
            boxShadow: "0 24px 48px rgba(0,0,0,0.45)",
            background: "#0b0b14",
          }}
        >
          <img
            src={getCardImagePath(p.cardIndex)}
            alt=""
            crossOrigin="anonymous"
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * Trim the interpretation overview to its first ~2-3 sentences so the
 * snippet shown in Level 2 stays readable on a Story canvas.
 */
export function snippetFromOverview(overview: string, maxChars = 200): string {
  const trimmed = (overview ?? "").trim();
  if (!trimmed) return "";
  // First pass: take first 2-3 sentences.
  const parts = trimmed.split(/(?<=[.!?])\s+/).slice(0, 3).join(" ");
  if (parts.length <= maxChars) return parts;
  // Hard fallback if a single sentence is enormous.
  return parts.slice(0, maxChars - 1).trimEnd() + "…";
}
