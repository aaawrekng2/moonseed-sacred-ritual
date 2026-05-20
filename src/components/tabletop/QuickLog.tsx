/**
 * Q109 Phase 1 — QuickLog.
 *
 * Statistics-driven Manual Entry replacement. Phase 1 builds the
 * SKELETON only: hero card on the left, date pill + smart input on
 * the top right, a dynamically-scaling slot row beneath, and a
 * question textarea + Get Reading button at the bottom. Companions,
 * calendar overlap, pull-history, and pull-resonance arrive in
 * Phases 2-4.
 *
 * The Tabletop scatter is untouched; this only replaces the
 * `ManualEntryBuilder` surface from draw.tsx. Prop signature matches
 * the old builder so the swap is mechanical.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, Plus, X } from "lucide-react";
import { FullScreenSheet } from "@/components/ui/full-screen-sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CardImage } from "@/components/card/CardImage";
import { EntryModeToggle } from "@/components/tabletop/EntryModeToggle";
import {
  SmartCardInput,
  type PasteOutcome,
  type SmartPick,
} from "@/components/tabletop/SmartCardInput";
import { useActiveDeck } from "@/lib/active-deck";
import { useElementWidth } from "@/lib/use-element-width";
import { useRegisterCloseHandler } from "@/lib/floating-menu-context";
import { cn } from "@/lib/utils";
import type { SpreadMode } from "@/lib/spreads";
import type { ManualPick } from "@/components/tabletop/ManualEntryBuilder";

const HERO_W = 225;
const HERO_H = 346;
const DEFAULT_SLOT_W = 80;
const DEFAULT_GAP = 15;
const GAP_RATIO = DEFAULT_GAP / DEFAULT_SLOT_W; // 0.1875

type Props = {
  spread: SpreadMode;
  customCount?: number;
  question: string;
  onQuestionChange: (q: string) => void;
  initialPicks?: (ManualPick | null)[];
  onPicksChange?: (p: (ManualPick | null)[]) => void;
  onSwitchToTable?: () => void;
  onCustomCountChange?: (n: number) => void;
  onCancel: () => void;
  onComplete: (
    picks: ManualPick[],
    meta?: { createdAt?: string; entryMode?: "manual" },
  ) => void;
};

export function QuickLog({
  question,
  onQuestionChange,
  initialPicks,
  onPicksChange,
  onSwitchToTable,
  onCancel,
  onComplete,
}: Props) {
  useRegisterCloseHandler(onCancel);
  const { activeDeck, imageMap } = useActiveDeck();

  // Seed from any cached picks; QuickLog is additive (no null gaps).
  const [picks, setPicks] = useState<ManualPick[]>(() =>
    (initialPicks ?? []).filter((p): p is ManualPick => !!p),
  );
  useEffect(() => {
    onPicksChange?.(picks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picks]);

  const [backdate, setBackdate] = useState<Date | null>(null);
  const [dateOpen, setDateOpen] = useState(false);

  // Smart-input parser index: pull names from the active deck.
  const deckCards = useMemo(() => {
    if (!activeDeck) return undefined;
    const entries = Object.entries(imageMap.nameByCardId ?? {});
    if (entries.length === 0) return undefined;
    return entries.map(([id, name]) => ({
      cardId: Number(id),
      name: name || `Card ${id}`,
    }));
  }, [activeDeck, imageMap]);

  const placedIds = picks.map((p) => p.cardIndex);

  const handleCommit = (pick: SmartPick) => {
    setPicks((prev) => [
      ...prev,
      {
        id: Date.now() + prev.length,
        cardIndex: pick.cardIndex,
        isReversed: pick.isReversed,
        deckId: null,
        cardName: pick.cardName,
      },
    ]);
  };

  const handleBulk = (outcome: PasteOutcome) => {
    setPicks((prev) => {
      const next = [...prev];
      outcome.picks.forEach((item, i) => {
        next.push({
          id: Date.now() + prev.length + i,
          cardIndex: item.pick.cardIndex,
          isReversed: item.pick.isReversed,
          deckId: null,
          cardName: item.pick.cardName,
        });
      });
      return next;
    });
  };

  // Dynamic slot sizing. The slot row lives inside the right column.
  const { ref: rowRef, width: rowWidth } = useElementWidth<HTMLDivElement>();
  const slotCount = picks.length + 1; // entered + trailing "+"
  const { slotW, slotH, gap } = useMemo(() => {
    if (rowWidth <= 0) {
      return { slotW: DEFAULT_SLOT_W, slotH: DEFAULT_SLOT_W * 1.6, gap: DEFAULT_GAP };
    }
    const defaultExtent = slotCount * DEFAULT_SLOT_W + (slotCount - 1) * DEFAULT_GAP;
    let w: number;
    let g: number;
    if (defaultExtent <= rowWidth) {
      w = DEFAULT_SLOT_W;
      g = DEFAULT_GAP;
    } else {
      w = rowWidth / (slotCount + GAP_RATIO * (slotCount - 1));
      g = w * GAP_RATIO;
    }
    return { slotW: w, slotH: w * 1.6, gap: g };
  }, [rowWidth, slotCount]);

  const heroPick = picks.length > 0 ? picks[picks.length - 1] : null;

  const canSubmit = picks.length >= 1;

  const handleSubmit = () => {
    if (!canSubmit) return;
    const meta: { createdAt?: string; entryMode?: "manual" } = {
      entryMode: "manual",
    };
    if (backdate) meta.createdAt = backdate.toISOString();
    onComplete(picks, meta);
    setPicks([]);
    setBackdate(null);
  };

  return (
    <FullScreenSheet open onClose={onCancel} entry="fade" showCloseButton={false}>
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          maxWidth: 1280,
          marginLeft: "auto",
          marginRight: "auto",
          overflowY: "auto",
        }}
      >
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close quick log"
          style={{
            position: "absolute",
            top: "calc(env(safe-area-inset-top, 0px) + 10px)",
            right: 12,
            zIndex: 10,
            padding: 8,
            color: "var(--color-foreground)",
            opacity: 0.7,
            background: "transparent",
            border: "none",
            cursor: "pointer",
            touchAction: "manipulation",
          }}
        >
          <X size={18} strokeWidth={1.5} />
        </button>

        <div className="flex h-full w-full flex-col bg-cosmos text-foreground">
          {/* Header strip — entry-mode toggle on the left (parity with
              ManualEntryBuilder). */}
          <div
            className="relative w-full border-b border-border/40"
            style={{
              minHeight: 48,
              paddingTop: "calc(env(safe-area-inset-top, 0px) + 4px)",
              paddingBottom: 8,
              display: "flex",
              alignItems: "center",
              paddingLeft: 16,
            }}
          >
            {onSwitchToTable && (
              <EntryModeToggle current="manual" onToggle={onSwitchToTable} />
            )}
          </div>

          {/* Main two-column grid */}
          <div
            style={{
              padding: "24px 24px 16px",
              display: "grid",
              gridTemplateColumns: `${HERO_W}px 1fr`,
              gap: 25,
              alignItems: "start",
            }}
          >
            {/* Left column — hero */}
            <div
              style={{
                width: HERO_W,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ position: "relative", width: HERO_W, height: HERO_H }}>
                {heroPick ? (
                  <CardImage
                    variant="face"
                    cardId={heroPick.cardIndex}
                    reversed={heroPick.isReversed}
                    deckId={heroPick.deckId ?? undefined}
                    size="custom"
                    widthPx={HERO_W}
                    eager
                  />
                ) : (
                  <CardImage
                    variant="back"
                    size="custom"
                    widthPx={HERO_W}
                    eager
                  />
                )}
              </div>
              {/* Card descriptor placeholder — wired in Phase 2. */}
            </div>

            {/* Right column — date pill + smart input, then slot row */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                }}
              >
                <Popover open={dateOpen} onOpenChange={setDateOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 rounded-full px-3 transition hover:bg-foreground/[0.04]"
                      style={{
                        height: 30,
                        fontFamily: "var(--font-serif)",
                        fontStyle: "italic",
                        fontSize: "var(--text-caption, 0.75rem)",
                        color: "var(--color-foreground)",
                        opacity: backdate ? 0.9 : 0.7,
                        border: "1px solid var(--border-subtle)",
                        background: "transparent",
                        cursor: "pointer",
                        flexShrink: 0,
                        whiteSpace: "nowrap",
                      }}
                    >
                      <CalendarIcon size={13} strokeWidth={1.5} />
                      {format(backdate ?? new Date(), "MMM d")}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-auto p-0"
                    align="start"
                    style={{ zIndex: "var(--z-modal-nested)" as unknown as number }}
                  >
                    <Calendar
                      mode="single"
                      selected={backdate ?? undefined}
                      onSelect={(d) => {
                        if (d) setBackdate(d);
                        setDateOpen(false);
                      }}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <SmartCardInput
                    positionLabels={[]}
                    emptySlotCount={78}
                    onCommit={handleCommit}
                    onBulkCommit={handleBulk}
                    placedCardIds={placedIds}
                    deckCards={deckCards}
                  />
                </div>
              </div>

              {/* Slot row — dynamic sizing */}
              <div ref={rowRef} style={{ width: "100%" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap,
                  }}
                >
                  {picks.map((pick, idx) => {
                    const isLatest = idx === picks.length - 1;
                    return (
                      <div
                        key={pick.id}
                        style={{
                          width: slotW,
                          height: slotH,
                          borderRadius: 6,
                          overflow: "hidden",
                          border: isLatest
                            ? "1.5px solid var(--accent, var(--gold))"
                            : "1px solid var(--border-subtle)",
                          boxSizing: "border-box",
                          flexShrink: 0,
                        }}
                      >
                        <CardImage
                          variant="face"
                          cardId={pick.cardIndex}
                          reversed={pick.isReversed}
                          deckId={pick.deckId ?? undefined}
                          size="custom"
                          widthPx={slotW}
                        />
                      </div>
                    );
                  })}
                  {/* Trailing dashed "+" slot */}
                  <button
                    type="button"
                    onClick={() => {
                      const el = document.querySelector<HTMLInputElement>(
                        'input[placeholder^="Type or paste"]',
                      );
                      el?.focus();
                    }}
                    style={{
                      width: slotW,
                      height: slotH,
                      borderRadius: 6,
                      border: "1.5px dashed color-mix(in oklab, var(--gold) 55%, transparent)",
                      background: "transparent",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--accent, var(--gold))",
                      cursor: "pointer",
                      flexShrink: 0,
                    }}
                    aria-label="Add card"
                  >
                    <Plus size={Math.max(14, slotW * 0.3)} strokeWidth={1.5} />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom: question textarea + Get Reading */}
          <div
            style={{
              marginTop: 30,
              padding: "0 24px 32px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 16,
            }}
          >
            <textarea
              value={question}
              onChange={(e) => onQuestionChange(e.target.value)}
              placeholder="Tap to add your question for the cards…"
              rows={1}
              style={{
                width: "100%",
                maxWidth: 640,
                minHeight: 44,
                padding: "12px 14px",
                borderRadius: 10,
                border: "1px solid var(--border-subtle)",
                background: "color-mix(in oklab, var(--color-foreground) 4%, transparent)",
                color: "var(--color-foreground)",
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: "var(--text-body, 0.95rem)",
                resize: "vertical",
                outline: "none",
              }}
            />
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              style={{
                width: 180,
                height: 44,
                borderRadius: 9999,
                background: "var(--accent, var(--gold))",
                color: "var(--cosmos, #0a0a14)",
                border: "none",
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: "var(--text-body, 0.95rem)",
                cursor: canSubmit ? "pointer" : "not-allowed",
                opacity: canSubmit ? 1 : 0.4,
                pointerEvents: canSubmit ? "auto" : "none",
                transition: "opacity 0.2s ease",
              }}
            >
              Get Reading
            </button>
          </div>
        </div>
      </div>
    </FullScreenSheet>
  );
}
