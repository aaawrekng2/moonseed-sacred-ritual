/**
 * Shared types for the Phase 9.5a Share System.
 *
 * The share system replaces the old TearOffCard. It exposes five
 * distinct visual "levels" (Pull, Reading, Position, Lens, Artifact)
 * that all share a common data envelope so the level selector in the
 * builder can swap between them in real time without re-fetching
 * anything.
 *
 * Only Levels 1 and 2 ship in this slice; Levels 3-5 are typed here
 * so consumers can declare future intent without breaking later.
 */
import type { InterpretationPayload } from "@/lib/interpret.functions";
import type { SpreadMode } from "@/lib/spreads";

/** All five share level identifiers. */
export type ShareLevel =
  | "pull"
  | "reading"
  | "position"
  | "lens"
  | "artifact";

/** Color chip identifier — drives the accent only, never the layout. */
export type ShareColorId =
  | "gold"
  | "purple"
  | "rose"
  | "sage"
  | "twilight"
  | "burnt"
  | "silver";

export type ShareColor = {
  id: ShareColorId;
  label: string;
  /** Solid accent color used for glyphs, rules, accent text. */
  accent: string;
  /** Soft glow used for halos / faint backgrounds. */
  glow: string;
};

/** The seven approved chips. Defined once; consumed by every level. */
export const SHARE_COLORS: ShareColor[] = [
  { id: "gold",     label: "Gold",     accent: "#D4AF37", glow: "rgba(212, 175,  55, 0.35)" },
  { id: "purple",   label: "Purple",   accent: "#9B7EDC", glow: "rgba(155, 126, 220, 0.35)" },
  { id: "rose",     label: "Rose",     accent: "#D17A92", glow: "rgba(209, 122, 146, 0.35)" },
  { id: "sage",     label: "Sage",     accent: "#7AAE91", glow: "rgba(122, 174, 145, 0.35)" },
  { id: "twilight", label: "Twilight", accent: "#5C8BC4", glow: "rgba( 92, 139, 196, 0.35)" },
  { id: "burnt",    label: "Burnt",    accent: "#CB7A3F", glow: "rgba(203, 122,  63, 0.35)" },
  { id: "silver",   label: "Moonwhite", accent: "#E6E6EA", glow: "rgba(230, 230, 234, 0.35)" },
];

export const DEFAULT_SHARE_COLOR: ShareColorId = "gold";

export function getShareColor(id: string | null | undefined): ShareColor {
  return SHARE_COLORS.find((c) => c.id === id) ?? SHARE_COLORS[0];
}

/** A drawn card in the reading. `isReversed` is optional for backwards
 * compatibility with older saved readings — treat missing as upright. */
export type SharePick = { id: number; cardIndex: number; isReversed?: boolean; deckId?: string | null };

/** The full data envelope a share level needs. */
export type ShareContext = {
  question?: string;
  spread: SpreadMode;
  picks: SharePick[];
  positionLabels: string[];
  interpretation: InterpretationPayload;
  /** Active guide name shown small/italic at the bottom of every share. */
  guideName: string;
  isOracle: boolean;
  /**
   * DN-7 — Reading's saved deck_id (or null when default Rider-Waite).
   * Drives the share preview to use the same custom deck artwork the
   * seeker actually drew with, instead of the generic Rider-Waite.
   */
  deckId?: string | null;
};

/** Per-level content toggles (Levels 2 + 3). */
export type ShareToggles = {
  includeQuestion: boolean;
  includeInterpretation: boolean;
  /** Currently unused at Levels 1 & 2 but reserved for Level 3. */
  includedPositions?: number[];
};
