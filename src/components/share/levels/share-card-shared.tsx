/**
 * Building blocks shared by every ShareLevel*.tsx.
 *
 * Each level component renders a fixed 1080x1920 surface so the
 * captured PNG is sized correctly for Instagram Stories. The on-screen
 * preview re-uses the same DOM but is CSS-scaled (transform: scale)
 * by the parent ShareBuilder so we never maintain two layouts.
 */
import type { CSSProperties, ReactNode } from "react";
import { getCardImagePath, getCardName } from "@/lib/tarot";
import { useDeckImage } from "@/lib/active-deck";
import type { SharePick } from "../share-types";
import type { ShareLevel } from "../share-types";
import { getSigilForLevel, MoonseedMark } from "../sigils";

/*
 * DN-7 — Share cards now render with the reading's saved deck_id, so
 * the seeker sees the same custom artwork they actually drew with.
 * When `deckId` is null/undefined or the deck has no override for a
 * given card, we fall back to the default Rider-Waite asset.
 */

export const SHARE_CARD_W = 1080;
export const SHARE_CARD_H = 1920;

/**
 * Outer 1080x1920 frame. Children fill it. The shared footer is
 * rendered automatically so every level gets the same brand sign-off.
 */
export function ShareCardFrame({
  background,
  level,
  children,
  guideName,
  accent,
}: {
  /**
   * DR-X — Background is now OPTIONAL. When omitted, the canvas
   * inherits the active theme's gradient + atmosphere via the same
   * tokens the main app uses. Pass a value only for legacy / one-off
   * level overrides.
   */
  background?: CSSProperties["background"];
  /** DR-X — drives which sigil renders in the upper-left corner. */
  level?: ShareLevel;
  children: ReactNode;
  guideName: string;
  accent: string;
}) {
  // DR-X — theme-driven canvas (mirrors .bg-cosmos in styles.css).
  const themeBackground =
    "radial-gradient(ellipse at 15% 10%, var(--atmosphere-overlay, transparent), transparent 50%)," +
    "radial-gradient(ellipse at 85% 90%, var(--atmosphere-overlay, transparent), transparent 45%)," +
    "linear-gradient(to right, var(--bg-gradient-left), var(--bg-gradient-right))";
  const Sigil = level ? getSigilForLevel(level) : null;
  return (
    <div
      style={{
        width: SHARE_CARD_W,
        height: SHARE_CARD_H,
        position: "relative",
        background: background ?? themeBackground,
        color: "var(--color-foreground)",
        overflow: "hidden",
        fontFamily: "var(--font-serif)",
      }}
    >
      {/* DR-X — Upper-left level sigil. */}
      {Sigil && (
        <div
          style={{
            position: "absolute",
            top: 48,
            left: 48,
            zIndex: 3,
            pointerEvents: "none",
          }}
        >
          <Sigil size={64} />
        </div>
      )}
      {/* DR-X — Upper-right brand wordmark. */}
      <div
        style={{
          position: "absolute",
          top: 48,
          right: 48,
          zIndex: 3,
          pointerEvents: "none",
        }}
      >
        <MoonseedMark />
      </div>
      {/* DR-X — Dampener: a soft dark wash sized to the card cluster
          area so cards stay dominant against any theme + custom deck.
          Sits above the canvas gradient but below the content layer. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: "10%",
          right: "10%",
          top: "22%",
          bottom: "22%",
          background:
            "color-mix(in oklch, oklch(0.05 0.02 280) 15%, transparent)",
          zIndex: 1,
          pointerEvents: "none",
          borderRadius: 32,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          padding: "160px 80px 100px",
          gap: 40,
          zIndex: 2,
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
  guideName: _guideName,
  accent: _accent,
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
          fontSize: "var(--text-caption)",
          letterSpacing: "0.04em",
          opacity: 0.6,
        }}
      >
        Moonseed.com
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
  cardAspect = 1.75,
  deckId,
}: {
  picks: SharePick[];
  maxWidth?: number;
  cardAspect?: number;
  deckId?: string | null;
}) {
  const n = Math.max(1, picks.length);
  const gap = n > 1 ? 24 : 0;
  const cardWidth = Math.min(360, Math.floor((maxWidth - gap * (n - 1)) / n));
  const cardHeight = Math.round(cardWidth * cardAspect);
  // DN-7 — useDeckImage gives a deck-aware resolver with default fallback.
  const getImage = useDeckImage(deckId ?? null);
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
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 16,
            width: cardWidth,
          }}
        >
          <div
            style={{
              width: cardWidth,
              height: cardHeight,
              borderRadius: 16,
              overflow: "hidden",
              boxShadow: "0 24px 48px rgba(0,0,0,0.45)",
              // DN-6 — inherit active theme background instead of a
              // hardcoded cosmic dark, so themed previews match in-app.
              background: "var(--background)",
            }}
          >
            <img
              src={getImage(p.cardIndex) ?? getCardImagePath(p.cardIndex)}
              alt=""
              crossOrigin="anonymous"
              style={{
                width: "100%",
                height: "100%",
                // DC-3.1 — contain so non–Rider-Waite custom decks
                // (varying aspect ratios) aren't sliced mid-card.
                objectFit: "contain",
                display: "block",
                transform: p.isReversed ? "rotate(180deg)" : undefined,
              }}
            />
          </div>
          <div
            style={{
              fontFamily: "var(--font-serif)",
              // DN-8 — bump from 28 → 38 for legibility on social thumbnails.
              fontSize: 38,
              lineHeight: 1.2,
              textAlign: "center",
              opacity: 0.92,
              letterSpacing: "0.02em",
            }}
          >
            {getCardName(p.cardIndex)}
            {p.isReversed ? " (R)" : ""}
          </div>
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
