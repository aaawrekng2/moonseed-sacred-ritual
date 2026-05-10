import type { ScatterCard } from "@/lib/scatter";
import type { SpreadMode } from "@/lib/spreads";

export type TabletopProps = {
  spread: SpreadMode;
  onExit: () => void;
  /** 9-6-O — Custom spread cardinality (1-10). Ignored unless spread === "custom". */
  customCount?: number;
  /**
   * Called when the reading is ready to display.
   *  - mode "reveal": user tapped Reveal first; cards are flipped face-up
   *    on the tabletop and the reading screen should open with cards
   *    already revealed.
   *  - mode "cast": user tapped Cast directly; cards remain face-down
   *    and the spread layout screen should let the user reveal them there.
   */
  onComplete: (
    picks: {
      id: number;
      cardIndex: number;
      isReversed?: boolean;
      /** Q3 — Fix 2: per-pick source deck for mixed-deck draws. */
      deckId?: string | null;
    }[],
    mode: "reveal" | "cast",
    meta?: { entryMode?: "digital" | "manual" },
  ) => void;
  /**
   * 26-05-08-N — Fix 4: question state lifted from the draw route so
   * ManualEntryBuilder can offer an inline question input above the
   * Done button. Optional — Tabletop continues to function without it.
   */
  question?: string;
  onQuestionChange?: (next: string) => void;
  /**
   * 26-05-08-Q19 — Entry-mode wiring. When set, Tabletop renders the
   * unified upper-left EntryModeToggle in place of its legacy
   * "Manual entry" pill and calls `onSwitchToManual` instead of
   * mounting ManualEntryBuilder internally.
   */
  onSwitchToManual?: () => void;
  /**
   * 26-05-08-Q19 — Custom-spread card-count stepper. When provided
   * (custom spread only), Tabletop renders a centered chevron
   * stepper that lets the seeker change the cardinality mid-table.
   */
  onCustomCountChange?: (next: number) => void;
};

export type CardState = ScatterCard & {
  selectionOrder: number | null;
  revealed: boolean;
  /**
   * The card's home position on the table, captured exactly once when the
   * scatter is first built. When a card is returned from a slot (via Stir
   * or by tapping it again) it animates back to these coordinates so the
   * table reads as the same scatter the user has been navigating, not a
   * fresh shuffle. NEVER overwrite these after initial assignment.
   */
  originalX: number;
  originalY: number;
  originalRotation: number;
  originalZ: number;
  /**
   * Last known position the card occupied while resting on the table.
   * Updated whenever the user drops the card on the table (drag-move or
   * drag-unplace). When a slotted card is returned to the table by a
   * tap (deselect) or by being displaced, it goes back to this spot
   * rather than its original random scatter coords — so the user's
   * deliberate placement is preserved.
   */
  lastTableX: number;
  lastTableY: number;
  lastTableRotation: number;
  /**
   * Set when the card just landed in a slot via a physical drag-drop
   * (rather than a tap). The flight animation is skipped for this
   * card on the next render — it appears in its slot exactly where
   * the user released it. Cleared once the card transitions back to
   * the table or another action runs.
   */
  isDragDrop?: boolean;
};

export type DragAction =
  | { kind: "move"; cardId: number; fromX: number; fromY: number; toX: number; toY: number }
  | {
      kind: "place";
      cardId: number;
      toSlot: number;
      /** Slot the dragged card came from, or null if it was on the table. */
      fromSlot: number | null;
      /** Pre-drag table coords (used when fromSlot === null). */
      fromX: number;
      fromY: number;
      displacedCardId: number | null;
      /**
       * Where the displaced occupant ended up after this action:
       *  - if dragged came from a slot → swap into that slot
       *    (`displacedToSlot` set, coords ignored)
       *  - if dragged came from the table → onto the table at the
       *    dragged card's pre-drag coords
       */
      displacedToSlot: number | null;
      displacedFromX: number;
      displacedFromY: number;
    }
  | {
      kind: "unplace";
      cardId: number;
      fromSlot: number;
      toX: number;
      toY: number;
    }
  | {
      // Tap-to-slot: card was tapped on the table and assigned to the
      // lowest empty slot. Reversible: undo returns the card to the
      // table at its previous coords and clears the slot.
      kind: "tap-place";
      cardId: number;
      toSlot: number;
      fromX: number;
      fromY: number;
    }
  | {
      // Tap-deselect: a slotted card was tapped and returned to the table
      // at its lastTable coords. Undo restores the slot.
      kind: "tap-unplace";
      cardId: number;
      fromSlot: number;
      toX: number;
      toY: number;
    };

export type TabletopSession = {
  cards: CardState[];
  undoStack: DragAction[];
  redoStack: DragAction[];
};
