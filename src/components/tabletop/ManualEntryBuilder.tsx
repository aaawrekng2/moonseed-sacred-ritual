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
import { useState } from "react";
import { X } from "lucide-react";
import { CardPicker } from "@/components/cards/CardPicker";
import { SPREAD_META, type SpreadMode } from "@/lib/spreads";
import { ManualSpreadSlots } from "@/components/tabletop/SpreadLayout";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { FullScreenSheet } from "@/components/ui/full-screen-sheet";
import { cn } from "@/lib/utils";

export type ManualPick = { id: number; cardIndex: number; isReversed: boolean };

type Props = {
  spread: SpreadMode;
  onCancel: () => void;
  /** Fires once every slot has a card and the seeker hits Done. */
  onComplete: (picks: ManualPick[]) => void;
};

export function ManualEntryBuilder({ spread, onCancel, onComplete }: Props) {
  const meta = SPREAD_META[spread];
  const required = meta.count;
  const labels = meta.positions ?? [];

  const [picks, setPicks] = useState<(ManualPick | null)[]>(
    Array.from({ length: required }, () => null),
  );
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);
  // 9-6-G — per-slot deck override; null = active deck.
  const [slotDeckIds, setSlotDeckIds] = useState<(string | null)[]>(
    Array.from({ length: required }, () => null),
  );

  const handleSlotDeckChange = (deckId: string | null) => {
    if (pickerSlot === null) return;
    const next = [...slotDeckIds];
    next[pickerSlot] = deckId;
    setSlotDeckIds(next);
  };

  const allFilled = picks.every((p) => p !== null);
  const placedIds = picks.filter((p): p is ManualPick => !!p).map((p) => p.cardIndex);

  const handlePick = (cardIndex: number, isReversed: boolean) => {
    if (pickerSlot === null) return;
    const next = [...picks];
    next[pickerSlot] = { id: pickerSlot, cardIndex, isReversed };
    setPicks(next);
    setPickerSlot(null);
  };

  return (
    <FullScreenSheet open onClose={onCancel} entry="slide-up" showCloseButton={false}>
    <div className="flex h-full w-full flex-col bg-cosmos text-foreground">
      <header className="flex items-center justify-between border-b border-border/40 px-4 py-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full p-2 hover:bg-foreground/10"
          aria-label="Cancel"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="text-xs uppercase tracking-[0.3em] opacity-70">
          Manual entry · {meta.label}
        </div>
        <div className="w-9" />
      </header>

      <div className="flex flex-1 flex-col items-center justify-start gap-6 overflow-y-auto p-6">
        <p className="text-center text-sm opacity-70">
          Tap each position to pick the card you drew.
        </p>

        {/* Phase 9.5b Fix 5 — slot positions match the SpreadLayout used
            by the reading screen exactly, so manual entry feels like the
            same spread the seeker is about to read. */}
        <ManualSpreadSlots
          spread={spread}
          picks={picks.map((p) =>
            p ? { cardIndex: p.cardIndex, isReversed: p.isReversed } : null,
          )}
          onSlotTap={(idx) => setPickerSlot(idx)}
        />

        <button
          type="button"
          disabled={!allFilled}
          onClick={() => {
            if (!allFilled) return;
            onComplete(picks.filter((p): p is ManualPick => !!p));
          }}
          className={cn(
            "rounded-full px-6 py-2.5 text-sm font-medium transition",
            allFilled
              ? "bg-gold text-cosmos hover:bg-gold/90"
              : "cursor-not-allowed bg-foreground/10 text-foreground/40",
          )}
        >
          Done · view reading
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