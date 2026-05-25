/**
 * EJ53 — Canonical CardFrame primitive.
 *
 * Wraps a CardImage with:
 *   • The inline-block-descender fix (font-size:0 / line-height:0 /
 *     vertical-align:top on outer span + vertical-align:top on inner
 *     image-clip span). This is the EJ29 fix that earned Cori's
 *     "FINALLY!!" exclamation on the constellation hero card.
 *   • Optional highlight ring rendered as an absolute span at
 *     inset:-2 BEHIND the image, so it hugs the actual rendered card
 *     image regardless of natural aspect ratio. The radius derives
 *     from the deck's baked corner radius + 2 to match the image's
 *     printed rounded silhouette.
 *   • Optional badges array — each badge sits absolute at a configurable
 *     anchor (bottom-right is the default for the gold pull-count badge,
 *     top-left/top-right available for other uses).
 *
 * Why a canonical primitive: prior to EJ53 every surface that rendered
 * a card with a stroke or badge re-rolled its own wrapper, ring, and
 * badge placement. Constellation hero/companion fixed it at EJ29.
 * QuickLog manual entry slot ring fixed at EJ33 (different DOM, the
 * inset:-6 → -2 pattern, NOT the descender fix). EJ50/EJ52 mistakenly
 * cross-applied the constellation pattern to QuickLog and made things
 * worse. The duplication kept regressing. With this primitive, every
 * surface migrates to one wrapper and a single bug fix updates them
 * all at once.
 *
 * Migration plan: EJ53 ships CardFrame and migrates ConstellationWeb
 * (hero + companion cards) and the QuickLog slot row. Future phases
 * migrate the other ~20 surfaces that render <CardImage> directly —
 * insights cells, calendar thumbnails, reading detail modal, etc.
 *
 * Naming: not "CardSlot" — that name is taken by the tabletop
 * scatter component (drag/drop interactions for the 78-card draw).
 * Different concern.
 */
import { type ReactNode } from "react";
import { CardImage } from "@/components/card/CardImage";

export type CardFrameHighlight = {
  /** Solid fill color of the highlight backdrop. CSS color or var. */
  color: string;
  /**
   * Optional outer glow. When set, a box-shadow extends N px past the
   * fill in the same color at the given alpha. Most surfaces want a
   * static highlight without a glow — leave undefined for crisp.
   */
  glow?: { px: number; alpha: number };
  /**
   * How many pixels the highlight extends beyond the card edge on each
   * side. Default 2 (matches the constellation EJ27/EJ29 pattern). Pass
   * 0 for a tight outline that sits exactly on the card edge.
   */
  outset?: number;
};

export type CardFrameBadge = {
  /** Stable React key for the badge slot. */
  id: string;
  /** Where on the card the badge anchors. */
  anchor: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
  /** Pixel offset from the anchor edge. Default 4. */
  inset?: number;
  /** Render the badge node. */
  node: ReactNode;
};

type CardFrameProps = {
  /** Numeric card id — passed through to CardImage. */
  cardId: number;
  /** Reversed card flag — passed through to CardImage. */
  reversed?: boolean;
  /** Optional deck id override. Pass undefined to use the active deck. */
  deckId?: string;
  /** Width of the card in px. Height derives from natural aspect. */
  widthPx: number;
  /**
   * Highlight ring config. Pass undefined for no ring. When set, the
   * ring renders BEHIND the card image so it hugs the card edges.
   */
  highlight?: CardFrameHighlight;
  /**
   * Corner radius percent (0-50) of the deck — used to match the
   * highlight's silhouette to the image's baked-in rounded corners.
   * Default 0 = sharp rectangles.
   */
  deckRadiusPct?: number;
  /** Optional badges (gold pull-count, X delete, etc.). */
  badges?: ReadonlyArray<CardFrameBadge>;
  /** Pass-through className for the outer span. */
  className?: string;
  /** Inline style for the outer span. Merged after canonical styles. */
  style?: React.CSSProperties;
  /** Optional aria-label for the wrapper. */
  ariaLabel?: string;
};

const ANCHOR_TO_STYLE: Record<NonNullable<CardFrameBadge["anchor"]>, React.CSSProperties> = {
  "top-left": { top: 0, left: 0 },
  "top-right": { top: 0, right: 0 },
  "bottom-left": { bottom: 0, left: 0 },
  "bottom-right": { bottom: 0, right: 0 },
  center: { top: "50%", left: "50%", transform: "translate(-50%, -50%)" },
};

export function CardFrame({
  cardId,
  reversed,
  deckId,
  widthPx,
  highlight,
  deckRadiusPct = 0,
  badges,
  className,
  style,
  ariaLabel,
}: CardFrameProps) {
  // EJ53 — Apply EJ29 descender fix here. font-size:0 + line-height:0
  // on the outer span kills the line-box descender reservation that
  // inline-block children otherwise create. vertical-align:top on the
  // inner image-clip span keeps the inline-block flush with the top
  // of the parent line-box. Together these make the wrapper hug the
  // image's actual rendered height precisely — no descender pixels
  // pushing the wrapper bottom past the image's actual bottom.
  const outset = highlight?.outset ?? 2;
  const radius = Math.round((deckRadiusPct / 100) * widthPx);
  const highlightRadius = radius + outset;

  return (
    <span
      aria-label={ariaLabel}
      className={className}
      style={{
        display: "inline-block",
        position: "relative",
        width: widthPx,
        verticalAlign: "top",
        fontSize: 0,
        lineHeight: 0,
        ...style,
      }}
    >
      {highlight && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: -outset,
            left: -outset,
            right: -outset,
            bottom: -outset,
            borderRadius: highlightRadius,
            background: highlight.color,
            // Glow is optional and additive — most surfaces opt out.
            boxShadow: highlight.glow
              ? `0 0 ${highlight.glow.px}px color-mix(in oklab, ${highlight.color} ${Math.round(
                  highlight.glow.alpha * 100,
                )}%, transparent)`
              : undefined,
            zIndex: 0,
            pointerEvents: "none",
          }}
        />
      )}
      <span
        style={{
          // The image-clip span. Sits ABOVE the highlight backdrop in
          // the stacking context. verticalAlign:top is the second half
          // of the descender fix — the inline-block CardImage attaches
          // to the top of its parent's line-box, not the baseline, so
          // no extra space is reserved below it.
          display: "inline-block",
          position: "relative",
          width: widthPx,
          verticalAlign: "top",
          zIndex: 1,
          borderRadius: radius || undefined,
          overflow: radius ? "hidden" : undefined,
        }}
      >
        <CardImage
          variant="face"
          cardId={cardId}
          reversed={reversed}
          deckId={deckId}
          size="custom"
          widthPx={widthPx}
        />
      </span>
      {badges?.map((b) => {
        const anchorStyle = ANCHOR_TO_STYLE[b.anchor];
        const inset = b.inset ?? 4;
        // Translate anchor edges into offsets via the inset. We
        // re-write any defined edge to use the inset value so callers
        // don't need to thread two props.
        const offsetStyle: React.CSSProperties = {};
        if ("top" in anchorStyle && anchorStyle.top === 0) offsetStyle.top = inset;
        if ("bottom" in anchorStyle && anchorStyle.bottom === 0) offsetStyle.bottom = inset;
        if ("left" in anchorStyle && anchorStyle.left === 0) offsetStyle.left = inset;
        if ("right" in anchorStyle && anchorStyle.right === 0) offsetStyle.right = inset;
        return (
          <span
            key={b.id}
            style={{
              position: "absolute",
              zIndex: 2,
              ...anchorStyle,
              ...offsetStyle,
              // Restore fontSize/lineHeight inside badges so any text
              // inside them renders normally (the outer span set them
              // to 0 for the descender fix).
              fontSize: "initial",
              lineHeight: "initial",
            }}
          >
            {b.node}
          </span>
        );
      })}
    </span>
  );
}
