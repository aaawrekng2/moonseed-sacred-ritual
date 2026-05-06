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
import { useDeckImage, useDeckCornerRadius } from "@/lib/active-deck";
import type { SharePick } from "../share-types";
import type { ShareLevel } from "../share-types";
import { getSigilForLevel, SigilWithGlow } from "../sigils";

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
  background?: CSSProperties["background"];
  level?: ShareLevel;
  children: ReactNode;
  guideName: string;
  accent: string;
}) {
  // DS — base gradient; atmosphere is layered as a separate element so
  // we can dial its opacity for the share canvas without touching the
  // global .bg-cosmos theme tokens.
  const baseGradient =
    "linear-gradient(to right, var(--bg-gradient-left), var(--bg-gradient-right))";
  const Sigil = level ? getSigilForLevel(level) : null;
  const FRAME_INSET = 36;
  return (
    <div
      style={{
        width: SHARE_CARD_W,
        height: SHARE_CARD_H,
        position: "relative",
        background: background ?? baseGradient,
        color: "var(--color-foreground)",
        overflow: "hidden",
        fontFamily: "var(--font-serif)",
      }}
    >
      {/* DS — Atmosphere overlay: theme radial glow pools at corners.
          Painted at ~55% intensity so cards remain dominant. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse at 15% 10%, var(--atmosphere-overlay, transparent), transparent 50%)," +
            "radial-gradient(ellipse at 85% 90%, var(--atmosphere-overlay, transparent), transparent 45%)",
          opacity: 0.55,
          zIndex: 0,
          pointerEvents: "none",
        }}
      />
      {/* DS — Full-canvas dampener: uniform whisper, no localized shape. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.06)",
          zIndex: 1,
          pointerEvents: "none",
        }}
      />
      {/* DS — Soft radial focus pool centered behind cards. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: 1200,
          height: 1200,
          transform: "translate(-50%, -50%)",
          background:
            "radial-gradient(circle, rgba(0,0,0,0.10) 0%, transparent 60%)",
          zIndex: 1,
          pointerEvents: "none",
        }}
      />
      {/* DS — Inner accent frame: thin line, ~25% opacity, inset. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: FRAME_INSET,
          top: FRAME_INSET,
          right: FRAME_INSET,
          bottom: FRAME_INSET,
          border: "1.5px solid var(--accent)",
          opacity: 0.25,
          zIndex: 2,
          pointerEvents: "none",
        }}
      />
      {/* DS — Manuscript-illumination corner ornaments. */}
      {[
        { top: FRAME_INSET - 3, left: FRAME_INSET - 3 },
        { top: FRAME_INSET - 3, right: FRAME_INSET - 3 },
        { bottom: FRAME_INSET - 3, left: FRAME_INSET - 3 },
        { bottom: FRAME_INSET - 3, right: FRAME_INSET - 3 },
      ].map((pos, i) => (
        <div
          key={i}
          aria-hidden
          style={{
            position: "absolute",
            ...pos,
            width: 6,
            height: 6,
            borderRadius: 9999,
            background: "var(--accent)",
            opacity: 0.5,
            zIndex: 2,
            pointerEvents: "none",
          }}
        />
      ))}
      {/* DS — Upper-left level sigil with glow halo. */}
      {Sigil && (
        <div
          style={{
            position: "absolute",
            top: 64,
            left: 64,
            zIndex: 3,
            pointerEvents: "none",
          }}
        >
          <SigilWithGlow Sigil={Sigil} size={132} />
        </div>
      )}
      {/* DT-13 — The upper-right ☽ moonseed wordmark was removed from
          the share canvas. Sigil top-left + Moonseed.com bottom-center
          anchor the composition; the upper-right is intentionally
          empty for asymmetric balance. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          padding: "240px 100px 160px",
          gap: 40,
          zIndex: 3,
        }}
      >
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "stretch",
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
        marginTop: 0,
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-serif)",
          // DT-9 — bumped from 26 → 38 and opacity 0.5 → 0.7 so the
          // bottom Moonseed.com wordmark stays legible at thumbnail
          // sizes without dominating the composition.
          fontSize: 38,
          letterSpacing: "0.18em",
          textTransform: "lowercase",
          color: "var(--foreground-muted, var(--color-foreground))",
          opacity: 0.7,
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
  const deckRadiusPx = useDeckCornerRadius(deckId ?? null);
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
              overflow: "hidden",
              boxShadow: "0 24px 48px rgba(0,0,0,0.45)",
              // DN-6 — inherit active theme background instead of a
              // hardcoded cosmic dark, so themed previews match in-app.
              background: "var(--background)",
              borderRadius:
                deckRadiusPx != null
                  ? `${(deckRadiusPx / 100) * cardWidth}px`
                  : 16,
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
              // DS — small-caps title treatment, accent at 80%.
              fontSize: 32,
              lineHeight: 1.2,
              textAlign: "center",
              opacity: 0.8,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--accent)",
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
