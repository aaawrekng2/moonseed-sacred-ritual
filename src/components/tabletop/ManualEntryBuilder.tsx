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
import { useEffect, useMemo, useRef, useState } from "react";
import { CardPicker } from "@/components/cards/CardPicker";
import { SPREAD_META, type SpreadMode } from "@/lib/spreads";
import { ManualSpreadSlots } from "@/components/tabletop/SpreadLayout";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { FullScreenSheet } from "@/components/ui/full-screen-sheet";
import { TopNav } from "@/components/nav/TopNav";
import { PageMenu, type PageMenuSection } from "@/components/nav/PageMenu";
import { PageMenuTrigger } from "@/components/nav/PageMenuTrigger";
import { LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SmartCardInput,
  type PasteOutcome,
  type SmartPick,
} from "@/components/tabletop/SmartCardInput";
import { useActiveDeck, useActiveDeckCardName } from "@/lib/active-deck";
import { CardImage } from "@/components/card/CardImage";
// EJ69 — EntryModeToggle removed from mobile Manual Entry surface. The
// Draw action lives in the PageMenu left fly-out now.
import { CustomCountStepper } from "@/components/tabletop/CustomCountStepper";
// EK05 — Shared spread picker (chevron + portaled dropdown), same
// component the draw table uses. Adds spread switching to manual
// entry mobile.
import { SpreadPicker } from "@/components/tabletop/SpreadPicker";
import type { SpreadPickerSelection } from "@/components/tabletop/SpreadPicker";
import { Hint, isHintHardDismissed } from "@/components/hints/Hint";
import { useAuth } from "@/lib/auth";
import { useRegisterCloseHandler } from "@/lib/floating-menu-context";
import { X, CalendarIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";

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

// CC — Single shared max width for Manual Entry inner content.
// Sized so 5 cards at the 120px cell cap fit across one row with 8px
// gaps (5*120 + 4*8 = 632) and a small breathing margin (~8px).
// SmartCardInput, ManualSpreadSlots (three/custom/celtic), the celtic
// vertical list, and the question/Done block all consume this so
// the dropdown can never render wider than the row beneath it.
// EJ70 — MANUAL_ENTRY_CONTENT_MAX now lives in its own leaf module to
// break the ManualEntryBuilder ↔ SpreadLayout / SmartCardInput import
// cycle (was a const-init TDZ). Re-exported here so existing importers
// that reference it from this file keep working.
export { MANUAL_ENTRY_CONTENT_MAX } from "@/components/tabletop/manual-entry-constants";
import { MANUAL_ENTRY_CONTENT_MAX } from "@/components/tabletop/manual-entry-constants";

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
  onComplete: (picks: ManualPick[], meta?: { createdAt?: string }) => void;
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
  /** EK05 — Spread-switch hook. Provides the inline SpreadPicker
   *  chevron in the action row so the seeker can change spread type
   *  without leaving manual entry. Omitted from callers that don't
   *  support spread switching at this surface. */
  onSpreadChange?: (next: SpreadPickerSelection) => void;
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
  onSpreadChange,
}: Props) {
  // Q30 Fix B5 — register the X close handler with the FloatingMenu so the
  // pop-down's X icon dismisses manual entry mode.
  useRegisterCloseHandler(onCancel);
  const meta = SPREAD_META[spread];
  // EJ35 — oracle card name resolver. Falls back through deck name
  // overrides for cards 1000+; for tarot 0..77 still uses the
  // standard dictionary.
  const resolveCardName = useActiveDeckCardName();
  const required = spread === "custom" ? Math.max(1, Math.min(10, customCount ?? 3)) : meta.count;
  const labels = meta.positions ?? [];

  // Q20 Fix 3 — first-mount hint for the custom-count stepper. The
  // EJ69 cleanup removed the entry-toggle hint (toggle moved into the
  // PageMenu fly-out; old anchored hint no longer applies).
  const { user: authUser, loading: authLoading } = useAuth();
  const stepperRef = useRef<HTMLDivElement | null>(null);
  const [showCountHint, setShowCountHint] = useState(false);
  // EJ69 — Page menu fly-out state. Holds the Draw action (and any
  // future per-page toggles for the manual entry surface).
  const [pageMenuOpen, setPageMenuOpen] = useState(false);
  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    const timers: number[] = [];
    void (async () => {
      if (spread === "custom" && onCustomCountChange) {
        const dismissedA = await isHintHardDismissed("custom_count_stepper", authUser?.id ?? null);
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
  // Q79 — optional backdate. Default null = "today / now". When set,
  // we emit it via onComplete so the reading row is inserted with the
  // chosen created_at (preserves journal chronology for retro entries).
  const [backdate, setBackdate] = useState<Date | null>(null);
  const [dateOpen, setDateOpen] = useState(false);
  // 9-6-G — per-slot deck override; null = active deck.
  const [slotDeckIds, setSlotDeckIds] = useState<(string | null)[]>(
    Array.from({ length: required }, () => null),
  );
  const [ambiguousSlots, setAmbiguousSlots] = useState<number[]>([]);
  const { activeDeck, imageMap } = useActiveDeck();
  // Q24 Fix 4 — build the smart-input search index from the active
  // deck's own card names so oracle / custom decks get fuzzy / paste
  // matching too. Undefined falls back to standard tarot.
  const deckCards = useMemo(() => {
    if (!activeDeck) return undefined;
    const entries = Object.entries(imageMap.nameByCardId ?? {});
    if (entries.length === 0) return undefined;
    return entries.map(([id, name]) => ({
      cardId: Number(id),
      name: name || `Card ${id}`,
    }));
  }, [activeDeck, imageMap]);

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
      ? `Select ${remaining} more card${remaining === 1 ? "" : "s"} to enter your spread`
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

  // EJ69 — Build PageMenu sections for mobile manual entry. Only the
  // Draw action lives here (replaces the inline EntryModeToggle).
  // Pages without applicable actions render the menu trigger anyway so
  // the seeker has a consistent surface; sections array can be empty.
  const pageMenuSections: PageMenuSection[] = [];
  if (onSwitchToTable) {
    pageMenuSections.push({
      id: "view",
      title: "View",
      items: [
        {
          id: "draw",
          label: "Card Draw Table",
          description: "Switch to the 78-card scatter",
          Icon: LayoutGrid,
          mode: "navigate",
          onClick: () => {
            setPageMenuOpen(false);
            onSwitchToTable();
          },
        },
      ],
    });
  }

  return (
    <FullScreenSheet open onClose={onCancel} entry="fade" showCloseButton={false}>
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          // CD — mirror Q94 #2 on the cast screen: clamp to 1280 and
          // center inside the FullScreenSheet portal so the header strip,
          // content column, and close button never span the full viewport
          // on wide monitors. FullScreenSheet portals to document.body
          // and escapes the root 1280 frame, so each consumer must impose
          // its own clamp.
          maxWidth: 1280,
          marginLeft: "auto",
          marginRight: "auto",
        }}
      >
        {/* EJ69 — TopNav band at the very top of the manual entry portal.
            FullScreenSheet renders at z-modal=100 which covers the global
            TopNav (z-40), so we render our own copy inside the portal
            to keep the seeker's navigation consistent. */}
        <TopNav />

        {/* EJ69 — PageMenu fly-out (left) + trigger button. Replaces the
            inline EntryModeToggle. Trigger sits below the TopNav band,
            upper-left. */}
        {pageMenuSections.length > 0 && (
          <>
            <PageMenuTrigger onClick={() => setPageMenuOpen(true)} />
            <PageMenu
              open={pageMenuOpen}
              onClose={() => setPageMenuOpen(false)}
              sections={pageMenuSections}
              title="Manual Entry"
            />
          </>
        )}

        {/* EJ69 — X close, upper-right. Mirrors the PageMenuTrigger's
            position so they bracket the same horizontal line. */}
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close manual entry"
          style={{
            position: "fixed",
            top: "calc(env(safe-area-inset-top, 0px) + var(--topbar-height) + 8px)",
            right: 8,
            zIndex: "var(--z-popover)" as unknown as number,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 36,
            height: 36,
            borderRadius: 999,
            background:
              "color-mix(in oklch, var(--surface-elevated) 80%, transparent)",
            border: "1px solid var(--border-subtle)",
            cursor: "pointer",
            color: "var(--color-foreground)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            touchAction: "manipulation",
          }}
        >
          <X size={18} strokeWidth={1.5} />
        </button>
        <div className="flex h-full w-full flex-col bg-cosmos text-foreground">
          {/* EJ69 — In-flow spacer matching TopNav height so content
              starts BELOW the TopNav band (not under it). */}
          <div style={{ height: "var(--topbar-pad)" }} aria-hidden />

          {/* EJ69 — In-flow action row directly under TopNav.
              Custom-count stepper centered. Spread label shown for
              fixed spreads. The seeker's left hamburger + right X both
              float above this row at fixed positions; this row's content
              only fills the central area between them.

              EK07 — Reverted the EK06 `position: sticky` attempt; sticky
              inside the flex-col content tree had known failure modes
              (Designcise + MDN + Mozilla bug #1488080) and the stepper
              still scrolled away at count 6+. The new approach: keep
              this row in normal flow at the top, and give the slot
              section below its OWN `overflow-y-auto`. The slot section
              scrolls INTERNALLY when its multi-row custom layout
              exceeds available height, while this row never moves. */}
          <div
            className="relative w-full border-b border-border/40"
            style={{
              minHeight: 48,
              paddingTop: 4,
              paddingBottom: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              paddingLeft: 56,
              paddingRight: 56,
              // Don't shrink — the slot section below will absorb any
              // overflow via its own scroll container.
              flexShrink: 0,
            }}
          >
            <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", gap: 8 }}>
              {/* EK05 — Spread picker chevron, immediately to the left
                  of the count display. Matches the EK02 placement on
                  the draw table (inline with the slot labels) so the
                  surface feels consistent across the two entry modes.
                  Only renders when an onSpreadChange handler is
                  provided. */}
              {onSpreadChange && (
                <SpreadPicker
                  current={spread}
                  hasPicks={picks.some((p) => p !== null)}
                  customCount={customCount}
                  onChange={onSpreadChange}
                />
              )}
              {/* EK05 — Show the count for every spread, not just custom.
                  Fixed spreads (three, celtic, yes_no, etc.) render the
                  stepper with min === max so both chevrons are dimmed/
                  disabled — the count number is visible but un-editable.
                  This matches the draw table behavior and replaces the
                  prior `meta.label` text that displayed nothing about
                  the cardinality. */}
              <CustomCountStepper
                ref={stepperRef}
                count={required}
                onChange={(next) => {
                  if (spread === "custom" && onCustomCountChange) {
                    onCustomCountChange(next);
                  }
                }}
                min={spread === "custom" && onCustomCountChange ? 1 : required}
                max={spread === "custom" && onCustomCountChange ? 10 : required}
              />
            </div>
          </div>
          {/* EJ69 — Entry-toggle hint removed. The Draw action now lives
              in the PageMenu fly-out, so the old hint anchored to the
              inline toggle has no target. Seeker discovers Draw via the
              hamburger trigger. */}
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
            className={cn("flex flex-1 flex-col items-center justify-start gap-3 px-4 pt-4 pb-4")}
            style={{
              paddingTop: 16,
              // EK07 — Internal scroll for the slot section. Was
              // previously letting the FullScreenSheet's outer
              // overflow-y-auto handle ALL scrolling, which meant the
              // action row (above this div) scrolled off-screen with
              // everything else when the custom layout's two-row
              // grid (count >= 6) pushed total content height past
              // the viewport.
              //
              // Now this div is its own scroll boundary:
              //   - `flex-1` takes the remaining vertical inside the
              //     content column (after topbar spacer + action row).
              //   - `min-height: 0` is the textbook fix for "flex-1
              //     child won't scroll" — without it, flex children
              //     refuse to shrink below content size, so they grow
              //     unbounded instead of becoming scrollable.
              //   - `overflow-y: auto` makes vertical overflow inside
              //     THIS box scrollable, leaving the action row
              //     above always pinned at the top in normal flow.
              minHeight: 0,
              overflowY: "auto",
            }}
          >
            {/* CF — Top row: date pill (left) + SmartCardInput (right),
            sharing the 640 content block. Date pill is fixed-width;
            input fills the rest. */}
            <div
              style={{
                width: "100%",
                maxWidth: MANUAL_ENTRY_CONTENT_MAX,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <Popover open={dateOpen} onOpenChange={setDateOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 transition hover:bg-foreground/[0.04]"
                    style={{
                      fontFamily: "var(--font-serif)",
                      fontStyle: "italic",
                      fontSize: "var(--text-caption, 0.75rem)",
                      color: "var(--color-foreground)",
                      opacity: backdate ? 0.9 : 0.55,
                      border: "1px solid var(--border-subtle)",
                      background: "transparent",
                      cursor: "pointer",
                      flexShrink: 0,
                      whiteSpace: "nowrap",
                    }}
                  >
                    <CalendarIcon size={13} strokeWidth={1.5} />
                    {backdate ? format(backdate, "PPP") : "Today"}
                    {backdate && (
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label="Clear backdate"
                        onClick={(e) => {
                          e.stopPropagation();
                          setBackdate(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            setBackdate(null);
                          }
                        }}
                        style={{ marginLeft: 4, opacity: 0.6 }}
                      >
                        <X size={12} strokeWidth={1.5} />
                      </span>
                    )}
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
                    disabled={(d) => d > new Date()}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
              <div style={{ flex: 1, minWidth: 0 }}>
                <SmartCardInput
                  positionLabels={labels.slice(0, required)}
                  emptySlotCount={required - filledCount}
                  onCommit={handleSmartCommit}
                  onBulkCommit={handleSmartBulk}
                  placedCardIds={placedIds}
                  deckCards={deckCards}
                />
              </div>
            </div>

            {/* Phase 9.5b Fix 5 — slot positions match the SpreadLayout used
            by the reading screen exactly, so manual entry feels like the
            same spread the seeker is about to read.
            Q13 Fix 6 — celtic switches to a compact vertical list in
            manual entry so all 10 slots are reachable; the post-Done
            tabletop still renders the full cross/staff layout. */}
            {isCelticManualEntry ? (
              <div
                className="flex w-full mx-auto flex-col gap-2"
                style={{ maxWidth: MANUAL_ENTRY_CONTENT_MAX }}
              >
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
                            fontSize: "var(--text-body-sm, 0.875rem)",
                          }}
                        >
                          {label}
                        </span>
                      </span>
                      {p ? (
                        <span className="flex items-center gap-2">
                          <span style={{ width: 32, flexShrink: 0 }}>
                            <CardImage
                              cardId={p.cardIndex}
                              variant="face"
                              size="custom"
                              widthPx={32}
                              reversed={!!p.isReversed}
                              deckId={p.deckId ?? null}
                            />
                          </span>
                          <span
                            className="text-[12px]"
                            style={{
                              color: "var(--gold)",
                              opacity: 0.85,
                              fontFamily: "var(--font-serif)",
                              fontStyle: "italic",
                            }}
                          >
                            {p.cardName ?? resolveCardName(p.cardIndex) ?? `Card ${p.cardIndex}`}
                            {p.isReversed ? " ↻" : ""}
                          </span>
                        </span>
                      ) : (
                        <span
                          className="text-[12px]"
                          style={{
                            color: "var(--color-foreground)",
                            opacity: 0.45,
                            fontFamily: "var(--font-serif)",
                            fontStyle: "italic",
                          }}
                        >
                          Tap to pick
                        </span>
                      )}
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
            <div className="w-full mx-auto" style={{ maxWidth: MANUAL_ENTRY_CONTENT_MAX }}>
              {question.trim().length > 0 && (
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
              )}
              {/* Q17 Fix 4 — taller textarea (3 rows default), drag-resize. */}
              <textarea
                value={question}
                onChange={(e) => onQuestionChange(e.target.value)}
                rows={3}
                placeholder="Tap to add your question for the cards"
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
                const meta = backdate ? { createdAt: backdate.toISOString() } : undefined;
                onComplete(
                  picks.filter((p): p is ManualPick => !!p),
                  meta,
                );
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
      </div>
    </FullScreenSheet>
  );
}
