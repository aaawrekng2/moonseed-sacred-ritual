/**
 * 26-05-08-Q17 Fix 1 — Smart bulk-input combobox for Manual Entry.
 *
 * Renders a single text input above the slot grid with an autocomplete
 * dropdown. Supports prefix / word-start / substring / fuzzy matching,
 * rank + suit group keywords ("3", "wands", "majors"), reversed
 * suffixes, comma-separated bulk paste, Enter to commit, Tab to extend
 * a comma list, and arrow-key navigation through grouped results.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  buildSearchIndex,
  parseReversed,
  resolveSegment,
  searchCards,
  type CardSearchEntry,
} from "@/lib/card-search";
import { useActiveDeckImage } from "@/lib/active-deck";
import { getCardImagePath } from "@/lib/tarot";

export type SmartPick = {
  cardIndex: number;
  cardName: string;
  isReversed: boolean;
};

export type PasteOutcome = {
  picks: { pick: SmartPick; ambiguous: boolean }[];
  unmatched: string[];
  overflow: number;
};

type Props = {
  positionLabels: string[];
  emptySlotCount: number;
  /** Called when a single card is committed (Enter / click). */
  onCommit: (pick: SmartPick) => void;
  /** Called when a comma-separated paste should fill multiple slots. */
  onBulkCommit: (outcome: PasteOutcome) => void;
  /** Cards already placed (used to grey-out duplicates). */
  placedCardIds: number[];
  /**
   * Q24 Fix 4 — when the seeker has an oracle/custom deck active,
   * pass its cards so the search index matches the active deck's
   * names instead of the standard tarot.
   */
  deckCards?: Array<{ cardId: number; name: string }>;
};

export function SmartCardInput({
  positionLabels,
  emptySlotCount,
  onCommit,
  onBulkCommit,
  placedCardIds,
  deckCards,
}: Props) {
  const index = useMemo(() => buildSearchIndex(deckCards), [deckCards]);
  const [value, setValue] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [open, setOpen] = useState(false);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [overflow, setOverflow] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resolveImage = useActiveDeckImage();

  // Parse out reversed suffix for the live query so dropdown stays in sync.
  const parsed = useMemo(() => parseReversed(value), [value]);
  const result = useMemo(
    () => searchCards(index, parsed.cleaned, 12),
    [index, parsed.cleaned],
  );

  useEffect(() => {
    setHighlight(0);
  }, [parsed.cleaned]);

  const flat = result.flat;
  const showDropdown = open && value.trim().length > 0 && flat.length > 0;

  const commit = (entry: CardSearchEntry, isReversed: boolean) => {
    onCommit({
      cardIndex: entry.cardId,
      cardName: entry.name,
      isReversed,
    });
    setValue("");
    setUnmatched([]);
    setOverflow(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handlePaste = (text: string) => {
    const segments = text
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (segments.length <= 1) return false;
    const picks: { pick: SmartPick; ambiguous: boolean }[] = [];
    const miss: string[] = [];
    let over = 0;
    for (const seg of segments) {
      if (picks.length >= emptySlotCount) {
        over += 1;
        continue;
      }
      const r = resolveSegment(index, seg);
      if (!r) {
        miss.push(seg);
        continue;
      }
      picks.push({
        pick: {
          cardIndex: r.entry.cardId,
          cardName: r.entry.name,
          isReversed: r.isReversed,
        },
        ambiguous: r.ambiguous,
      });
    }
    onBulkCommit({ picks, unmatched: miss, overflow: over });
    setValue("");
    setUnmatched(miss);
    setOverflow(over);
    return true;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      if (!flat.length) return;
      e.preventDefault();
      setHighlight((h) => (h + 1) % flat.length);
      return;
    }
    if (e.key === "ArrowUp") {
      if (!flat.length) return;
      e.preventDefault();
      setHighlight((h) => (h - 1 + flat.length) % flat.length);
      return;
    }
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const entry = flat[highlight];
      if (entry) commit(entry, parsed.isReversed);
      return;
    }
    if (e.key === "Tab") {
      const entry = flat[highlight];
      if (entry && value.trim().length > 0) {
        e.preventDefault();
        commit(entry, parsed.isReversed);
      }
      return;
    }
    if (e.key === ",") {
      const entry = flat[highlight];
      if (entry && value.trim().length > 0 && !value.includes(",")) {
        e.preventDefault();
        commit(entry, parsed.isReversed);
      }
    }
  };

  return (
    <div className="w-full max-w-md mx-auto relative">
      <p
        className="mb-2 text-center"
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-caption, 0.72rem)",
          opacity: 0.55,
        }}
      >
        Cards fill in spread order: {positionLabels.join(", ") || "as drawn"}
      </p>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Delay so click on dropdown row still fires.
          setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={onKeyDown}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text");
          if (text.includes(",") || text.includes("\n")) {
            e.preventDefault();
            handlePaste(text);
          }
        }}
        placeholder="Type or paste card names — e.g. The Tower, Three of Wands"
        className="w-full rounded-lg border border-gold/30 bg-foreground/[0.04] px-3 py-2 text-sm focus:border-gold/60 focus:outline-none placeholder:opacity-50"
        style={{ fontFamily: "var(--font-serif)" }}
      />
      {(unmatched.length > 0 || overflow > 0) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {unmatched.map((u) => (
            <span
              key={u}
              className="inline-flex items-center rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[11px] text-red-300"
            >
              Couldn't match: '{u}'
            </span>
          ))}
          {overflow > 0 && (
            <span className="inline-flex items-center rounded-full border border-yellow-500/40 bg-yellow-500/10 px-2 py-0.5 text-[11px] text-yellow-200">
              {overflow} card{overflow === 1 ? "" : "s"} would not fit
            </span>
          )}
        </div>
      )}
      {showDropdown && (
        <div
          className="absolute z-50 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border border-gold/30 bg-cosmos shadow-xl"
          onMouseDown={(e) => e.preventDefault()}
        >
          {result.groups.map((g) => (
            <div key={g.label}>
              <div
                className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-gold/70"
                style={{
                  background: "color-mix(in oklab, var(--gold) 6%, transparent)",
                }}
              >
                {g.label} ({g.entries.length})
              </div>
              {g.entries.map((entry) => {
                const flatIdx = flat.indexOf(entry);
                const isHi = flatIdx === highlight;
                const isUsed = placedCardIds.includes(entry.cardId);
                const img =
                  resolveImage(entry.cardId, "thumbnail") ??
                  getCardImagePath(entry.cardId);
                return (
                  <button
                    key={entry.cardId}
                    type="button"
                    onMouseEnter={() => setHighlight(flatIdx)}
                    onClick={() => commit(entry, parsed.isReversed)}
                    className={cn(
                      "flex w-full items-center gap-3 px-3 py-1.5 text-left text-sm transition-colors",
                      isHi ? "bg-gold/15 text-gold" : "hover:bg-foreground/5",
                      isUsed && "opacity-50",
                    )}
                  >
                    {img ? (
                      <img
                        src={img}
                        alt=""
                        className="h-8 w-5 rounded-sm object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <span className="h-8 w-5 rounded-sm bg-foreground/10" />
                    )}
                    <span className="flex-1 truncate" style={{ fontFamily: "var(--font-serif)" }}>
                      {entry.name}
                    </span>
                    {parsed.isReversed && isHi && (
                      <RotateCw className="h-3 w-3 text-gold" />
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}