/**
 * ManualEntryBuilder (Phase 9.5b — fixes 7, 8, 10).
 *
 * Slot-by-slot manual reading composer. Replaces the scatter when the
 * seeker chooses "Pick manually" on the draw table. Tapping an empty
 * slot opens the {@link CardPicker} as a bottom sheet so the spread
 * stays visible above. Each pick fills its slot and closes the sheet;
 * Done is only enabled once every slot has a card. Output funnels into
 * the same SpreadLayout → ReadingScreen path as a digital draw so the
 * resulting reading is visually identical (Fix 9).
 */
import { useEffect, useRef, useState } from "react";
import { CardPicker } from "@/components/cards/CardPicker";
import { SPREAD_META, type SpreadMode } from "@/lib/spreads";
import { ManualSpreadSlots } from "@/components/tabletop/SpreadLayout";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { FullScreenSheet } from "@/components/ui/full-screen-sheet";
import { getCardName } from "@/lib/tarot";
import { cn } from "@/lib/utils";
import { SmartCardInput, type PasteOutcome, type SmartPick } from "@/components/tabletop/SmartCardInput";
import { useActiveDeck } from "@/lib/active-deck";
import { EntryModeToggle } from "@/components/tabletop/EntryModeToggle";
import { CustomCountStepper } from "@/components/tabletop/CustomCountStepper";
import { Hint, isHintHardDismissed } from "@/components/hints/Hint";
import { useAuth } from "@/lib/auth";

const CELTIC_POSITION_LABELS = [
  "Significator",
  "Crossing",
  "Foundation",
  "Recent Past",
  "Crown",
  "Near Future",
  "Self",
  "Environment",
  "Hopes & Fears",
  "Outcome",
];

export type ManualPick = {
  id: number;
  cardIndex: number;
  isReversed: boolean;
  /** 9-6-M — null = active deck. */
  deckId: string | null;
  /** 9-6-M — name resolved from deck (oracle uses user-supplied names). */
  cardName: string;
};

type Props = {
  spread: SpreadMode;
  onCancel: () => void;
  /** Fires once every slot has a card and the seeker hits Done. */
  onComplete: (picks: ManualPick[]) => void;
  /** 9-6-O — Custom spread cardinality (1-10). */
  customCount?: number;
  /** 26-05-08-N — Fix 4: inline question input above the Done button. */
  question: string;
  onQuestionChange: (next: string) => void;
  /**
   * Q19 — Mid-draw picks preservation. The draw-route caches in-progress
   * manual picks so toggling Table ↔ Manual doesn't wipe the seeker's
   * placements. Optional; defaults to a fresh array.
   */
  initialPicks?: (ManualPick | null)[];
  onPicksChange?: (picks: (ManualPick | null)[]) => void;
  /** Q19 — Surface swap (Manual → Table) via the unified toggle. */
  onSwitchToTable?: () => void;
  /** Q19 — Custom-count stepper hook (custom spread only). */
  onCustomCountChange?: (next: number) => void;
};

export function ManualEntryBuilder({
  spread,
  onCancel,
  onComplete,
  customCount,
  question,
  onQuestionChange,
  initialPicks,
  onPicksChange,
  onSwitchToTable,
  onCustomCountChange,
}: Props) {
  const meta = SPREAD_META[spread];
  const required = spread === "custom"
    ? Math.max(1, Math.min(10, customCount ?? 3))
    : meta.count;
  const labels = meta.positions ?? [];

  // Q20 Fix 3 — two staggered first-mount hints (toggle + stepper).
  const { user: authUser, loading: authLoading } = useAuth();
  const entryToggleRef = useRef<HTMLButtonElement | null>(null);
  const stepperRef = useRef<HTMLDivElement | null>(null);
  const [showEntryHint, setShowEntryHint] = useState(false);
  const [showCountHint, setShowCountHint] = useState(false);
  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    const timers: number[] = [];
    void (async () => {
      if (onSwitchToTable) {
        const dismissedB = await isHintHardDismissed(
          "entry_mode_toggle",
          authUser?.id ?? null,
        );
        if (!cancelled && !dismissedB) {
          timers.push(window.setTimeout(() => setShowEntryHint(true), 400));
        }
      }
      if (spread === "custom" && onCustomCountChange) {
        const dismissedA = await isHintHardDismissed(
          "custom_count_stepper",
          authUser?.id ?? null,
        );
        if (!cancelled && !dismissedA) {
          timers.push(window.setTimeout(() => setShowCountHint(true), 800));
        }
      }
    })();
    return () => {
      cancelled = true;
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [authUser, authLoading, onSwitchToTable, onCustomCountChange, spread]);

  const [picks, setPicks] = useState<(ManualPick | null)[]>(() => {
    if (initialPicks && initialPicks.length > 0) {
      // Trim or pad to match the current `required` count so a stale
      // cached array (e.g. left-over Custom 5-card picks) lines up
      // with the stepper's new value.
      const next = initialPicks.slice(0, required);
      while (next.length < required) next.push(null);
      return next;
    }
    return Array.from({ length: required }, () => null);
  });
  // Q19 — keep the lifted cache in sync with internal edits.
  useEffect(() => {
    onPicksChange?.(picks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picks]);
  // Q19 — reflow when the stepper changes the required count.
  useEffect(() => {
    setPicks((prev) => {
      if (prev.length === required) return prev;
      const next = prev.slice(0, required);
      while (next.length < required) next.push(null);
      return next;
    });
    setSlotDeckIds((prev) => {
      if (prev.length === required) return prev;
      const next = prev.slice(0, required);
      while (next.length < required) next.push(null);
      return next;
    });
  }, [required]);
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);
  // 9-6-G — per-slot deck override; null = active deck.
  const [slotDeckIds, setSlotDeckIds] = useState<(string | null)[]>(
    Array.from({ length: required }, () => null),
  );
  const [ambiguousSlots, setAmbiguousSlots] = useState<number[]>([]);
  const { activeDeck } = useActiveDeck();
  // Smart input only handles standard tarot; oracle decks fall back
  // to tap-to-pick (cardIndex >= 1000 isn't in the search index).
  const smartInputDisabled = !!activeDeck;

  const handleSlotDeckChange = (deckId: string | null) => {
    if (pickerSlot === null) return;
    const next = [...slotDeckIds];
    next[pickerSlot] = deckId;
    setSlotDeckIds(next);
  };

  const allFilled = picks.every((p) => p !== null);
  const placedIds = picks.filter((p): p is ManualPick => !!p).map((p) => p.cardIndex);
  const isCelticManualEntry = spread === "celtic";
  const filledCount = picks.filter((p) => p !== null).length;
  const remaining = required - filledCount;
  const buttonText =
    remaining > 0
      ? `Select ${remaining} more card${remaining === 1 ? "" : "s"} to enter your reading`
      : "Done · view reading";

  const handlePick = (
    cardIndex: number,
    isReversed: boolean,
    deckId: string | null,
    cardName: string,
  ) => {
    if (pickerSlot === null) return;
    const next = [...picks];
    next[pickerSlot] = {
      id: Date.now() + pickerSlot,
      cardIndex,
      isReversed,
      deckId,
      cardName,
    };
    setPicks(next);
    setAmbiguousSlots((prev) => prev.filter((i) => i !== pickerSlot));
    setPickerSlot(null);
  };

  const firstEmptySlot = (arr: (ManualPick | null)[]): number => {
    for (let i = 0; i < arr.length; i++) if (arr[i] === null) return i;
    return -1;
  };

  const handleSmartCommit = (pick: SmartPick) => {
    const next = [...picks];
    const idx = firstEmptySlot(next);
    if (idx === -1) return;
    next[idx] = {
      id: Date.now() + idx,
      cardIndex: pick.cardIndex,
      isReversed: pick.isReversed,
      deckId: null,
      cardName: pick.cardName,
    };
    setPicks(next);
    setAmbiguousSlots((prev) => prev.filter((i) => i !== idx));
  };

  const handleSmartBulk = (outcome: PasteOutcome) => {
    const next = [...picks];
    const newAmbig: number[] = [];
    for (const item of outcome.picks) {
      const idx = firstEmptySlot(next);
      if (idx === -1) break;
      next[idx] = {
        id: Date.now() + idx,
        cardIndex: item.pick.cardIndex,
        isReversed: item.pick.isReversed,
        deckId: null,
        cardName: item.pick.cardName,
      };
      if (item.ambiguous) newAmbig.push(idx);
    }
    setPicks(next);
    setAmbiguousSlots(newAmbig);
  };

  const handleSlotReorder = (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    const next = [...picks];
    const tmp = next[toIdx];
    next[toIdx] = next[fromIdx];
    next[fromIdx] = tmp;
    setPicks(next);
    setAmbiguousSlots((prev) =>
      prev.map((i) => (i === fromIdx ? toIdx : i === toIdx ? fromIdx : i)),
    );
  };

  return (
    <FullScreenSheet open onClose={onCancel} entry="fade" showCloseButton={false}>
    <div className="flex h-full w-full flex-col bg-cosmos text-foreground">
      {/* Q20 Fix 4 — Unified header strip: toggle (left) + stepper
          (centered) on the same row. */}
      <div
        className="relative w-full border-b border-border/40"
        style={{
          minHeight: 48,
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 4px)",
          paddingBottom: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ paddingLeft: 16 }}>
          {onSwitchToTable && (
            <EntryModeToggle
              ref={entryToggleRef}
              current="manual"
              onToggle={onSwitchToTable}
            />
          )}
        </div>
        <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
          {spread === "custom" && onCustomCountChange ? (
            <CustomCountStepper
              ref={stepperRef}
              count={required}
              onChange={onCustomCountChange}
            />
          ) : (
            <div
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: "var(--text-caption, 0.7rem)",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                opacity: 0.55,
              }}
            >
              {meta.label}
            </div>
          )}
        </div>
        <div style={{ paddingRight: 56 }} />
      </div>
      {showEntryHint && onSwitchToTable && (
        <Hint
          hintId="entry_mode_toggle"
          text={'Want to physically draw? Tap "Table" to draw from the 78-card scatter.'}
          anchorRef={entryToggleRef}
          position="bottom"
          pointerAlign="start"
          onDismiss={() => setShowEntryHint(false)}
        />
      )}
      {showCountHint && spread === "custom" && onCustomCountChange && (
        <Hint
          hintId="custom_count_stepper"
          text="Pick how many cards. Tap the chevrons to change how many cards you draw."
          anchorRef={stepperRef}
          position="bottom"
          pointerAlign="center"
          onDismiss={() => setShowCountHint(false)}
        />
      )}

      <div
        className={cn(
          "flex flex-1 flex-col items-center justify-start gap-6 p-6",
          // Q17 Fix 3B — only celtic needs scrolling; small spreads fit
          // fine. Q14 Fix 8 set this gate; Q17 audit confirms it stays.
          isCelticManualEntry && "overflow-y-auto",
        )}
      >
        {/* Q17 Fix 1 — Smart bulk-input combobox. Hidden for oracle
            decks; standard tarot only. */}
        <SmartCardInput
          positionLabels={labels.slice(0, required)}
          emptySlotCount={required - filledCount}
          onCommit={handleSmartCommit}
          onBulkCommit={handleSmartBulk}
          placedCardIds={placedIds}
          disabled={smartInputDisabled}
        />
        <p
          className="text-center"
          style={{
            fontSize: "var(--text-caption, 0.72rem)",
            color: "var(--color-foreground)",
            opacity: 0.55,
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
          }}
        >
          {smartInputDisabled
            ? "Tap each position to pick the card you drew."
            : "Or tap a position below to pick from the deck. Drag a filled slot to reorder."}
        </p>

        {/* Phase 9.5b Fix 5 — slot positions match the SpreadLayout used
            by the reading screen exactly, so manual entry feels like the
            same spread the seeker is about to read.
            Q13 Fix 6 — celtic switches to a compact vertical list in
            manual entry so all 10 slots are reachable; the post-Done
            tabletop still renders the full cross/staff layout. */}
        {isCelticManualEntry ? (
          <div className="flex w-full max-w-md mx-auto flex-col gap-2">
            {Array.from({ length: required }).map((_, i) => {
              const p = picks[i];
              const label = CELTIC_POSITION_LABELS[i] ?? labels[i] ?? `Card ${i + 1}`;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setPickerSlot(i)}
                  draggable={!!p}
                  onDragStart={(e) => {
                    if (!p) return;
                    e.dataTransfer.setData("text/plain", String(i));
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const fromIdx = parseInt(e.dataTransfer.getData("text/plain"), 10);
                    if (!Number.isNaN(fromIdx)) handleSlotReorder(fromIdx, i);
                  }}
                  className="flex items-center justify-between rounded-lg border border-border/40 bg-foreground/[0.03] px-3 py-2 text-left transition hover:border-gold/40 hover:bg-gold/5"
                >
                  <span className="flex items-center gap-3">
                    <span
                      className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] tabular-nums"
                      style={{
                        background: "color-mix(in oklab, var(--gold) 14%, transparent)",
                        color: "var(--gold)",
                      }}
                    >
                      {i + 1}
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--font-serif)",
                        fontStyle: "italic",
                        fontSize: "var(--text-body-sm, 0.9rem)",
                      }}
                    >
                      {label}
                    </span>
                  </span>
                  <span
                    className="text-[12px]"
                    style={{
                      color: p ? "var(--gold)" : "var(--color-foreground)",
                      opacity: p ? 0.85 : 0.45,
                      fontFamily: "var(--font-serif)",
                      fontStyle: "italic",
                    }}
                  >
                    {p
                      ? `${p.cardName ?? getCardName(p.cardIndex) ?? `Card ${p.cardIndex}`}${p.isReversed ? " ↻" : ""}`
                      : "Tap to pick"}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <ManualSpreadSlots
          spread={spread}
          customCount={required}
          picks={picks.map((p) =>
            p
              ? {
                  cardIndex: p.cardIndex,
                  isReversed: p.isReversed,
                  deckId: p.deckId,
                  cardName: p.cardName,
                }
              : null,
          )}
          onSlotTap={(idx) => setPickerSlot(idx)}
          onSlotReorder={handleSlotReorder}
          ambiguousSlots={ambiguousSlots}
          />
        )}

        {/* 26-05-08-N — Fix 4: inline question input above Done. */}
        <div className="w-full max-w-md mx-auto">
          <span
            style={{
              fontFamily: "var(--font-display, var(--font-serif))",
              fontStyle: "italic",
              fontSize: "var(--text-caption)",
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "var(--gold)",
              opacity: 0.7,
              display: "block",
              textAlign: "center",
              marginBottom: 8,
            }}
          >
            Your question for the cards
          </span>
          {/* Q17 Fix 4 — taller textarea (3 rows default), drag-resize. */}
          <textarea
            value={question}
            onChange={(e) => onQuestionChange(e.target.value)}
            rows={3}
            placeholder="Tap to add your question…"
            className="w-full bg-transparent focus:outline-none text-center"
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-body)",
              lineHeight: 1.5,
              color: "var(--foreground)",
              borderBottom: "1px solid var(--border-subtle)",
              padding: "4px 0",
              minHeight: 96,
              resize: "vertical",
            }}
          />
        </div>

        <button
          type="button"
          disabled={!allFilled}
          onClick={() => {
            if (!allFilled) return;
            onComplete(picks.filter((p): p is ManualPick => !!p));
          }}
          className="px-6 py-2 transition disabled:cursor-not-allowed text-center"
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body)",
            color: allFilled ? "var(--accent)" : "var(--color-foreground)",
            opacity: allFilled ? 1 : 0.4,
            background: "none",
            border: "none",
            textShadow: allFilled ? "0 0 12px var(--accent-faint)" : undefined,
          }}
        >
          {buttonText}
        </button>
      </div>

      <Sheet
        open={pickerSlot !== null}
        onOpenChange={(open) => {
          if (!open) setPickerSlot(null);
        }}
      >
        <SheetContent
          side="bottom"
          className="h-[75vh] rounded-t-2xl p-0"
          // Phase 9.5a — the picker must stack above the FullScreenSheet
          // (z-modal=100) that wraps ManualEntryBuilder. SheetContent's
          // default z-drawer=60 hides the picker behind the wrapper.
          style={{ zIndex: "var(--z-modal-nested)" as unknown as number }}
        >
          {pickerSlot !== null && (
            <CardPicker
              mode="manual-entry"
              embedded
              deckId={slotDeckIds[pickerSlot]}
              onDeckChange={handleSlotDeckChange}
              excludeCardIds={placedIds}
              // CE Group 3 — manual entry logs a physical reading where
              // reversal is part of what happened. Always offer the
              // toggle regardless of the digital allow_reversed_cards
              // preference (which only governs digital randomization).
              showReversedToggle={true}
              title={
                labels[pickerSlot]
                  ? `Pick — ${labels[pickerSlot]}`
                  : `Pick card ${pickerSlot + 1} of ${required}`
              }
              onCancel={() => setPickerSlot(null)}
              onSelect={handlePick}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
    </FullScreenSheet>
  );
}