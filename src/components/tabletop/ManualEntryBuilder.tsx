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
import { getCardName } from "@/lib/tarot";

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
};

export function ManualEntryBuilder({
  spread,
  onCancel,
  onComplete,
  customCount,
  question,
  onQuestionChange,
}: Props) {
  const meta = SPREAD_META[spread];
  const required = spread === "custom"
    ? Math.max(1, Math.min(10, customCount ?? 3))
    : meta.count;
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
  const isCelticManualEntry = spread === "celtic";

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
          Manual entry · {meta.label}
        </div>
        <div className="w-9" />
      </header>

      <div
        className={cn(
          "flex flex-1 flex-col items-center justify-start gap-6 p-6",
          // Q14 Fix 8 — only celtic needs scrolling; small spreads fit fine.
          isCelticManualEntry && "overflow-y-auto",
        )}
      >
        <p
          className="text-center"
          style={{
            fontSize: "var(--text-caption, 0.72rem)",
            color: "var(--color-foreground)",
            opacity: 0.6,
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
          }}
        >
          Tap each position to pick the card you drew.
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
                      ? `${p.cardName ?? getCardName(p.cardIndex) ?? `Card ${p.cardIndex}`}${p.isReversed ? " (rev)" : ""}`
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
          <textarea
            value={question}
            onChange={(e) => onQuestionChange(e.target.value)}
            rows={2}
            placeholder="Tap to add your question…"
            className="w-full resize-none bg-transparent focus:outline-none text-center"
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-body)",
              lineHeight: 1.7,
              color: "var(--foreground)",
              borderBottom: "1px solid var(--border-subtle)",
              padding: "4px 0",
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
          className="px-6 py-2 transition disabled:cursor-not-allowed"
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