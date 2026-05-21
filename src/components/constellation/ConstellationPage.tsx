/**
 * Phase 17 — /constellation page.
 *
 * Top: 10-slot row (additive picks). Tap a filled slot to focus it as
 * the hero. Below: left column shows the constellation SVG, right
 * column shows the chip grid + matching readings panel. Full-width
 * 6-month overlap strip sits below.
 */
import { useEffect, useState } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { CardPicker } from "@/components/cards/CardPicker";
import { CardImage } from "@/components/card/CardImage";
import { ChipGrid, OverlapStrip } from "@/components/tabletop/QuickLog";
import { ConstellationWeb } from "@/components/constellation/ConstellationWeb";
import { MatchingReadingsPanel } from "@/components/constellation/MatchingReadingsPanel";
import {
  getQuickLogCardStats,
  getQuickLogOverlap,
  getCardConstellation,
  type QuickLogCardStats,
  type QuickLogOverlap,
  type CardConstellation,
} from "@/lib/quicklog.functions";
import type { ManualPick } from "@/components/tabletop/ManualEntryBuilder";
import { useAuth } from "@/lib/auth";
import { useTimezone } from "@/lib/use-timezone";
import { useNavigate } from "@tanstack/react-router";

const SLOT_W = 70;
const SLOT_H = Math.round(SLOT_W * 1.55);

export function ConstellationPage() {
  const { user } = useAuth();
  const { effectiveTz } = useTimezone();
  const navigate = useNavigate();

  const [picks, setPicks] = useState<ManualPick[]>([]);
  const [focusedSlotIdx, setFocusedSlotIdx] = useState<number | null>(null);
  const [companionFilterCardId, setCompanionFilterCardId] = useState<
    number | null
  >(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const heroIdx =
    picks.length === 0
      ? null
      : focusedSlotIdx !== null && focusedSlotIdx < picks.length
        ? focusedSlotIdx
        : picks.length - 1;
  const heroPick = heroIdx === null ? null : picks[heroIdx];

  // Reset companion filter whenever the hero changes.
  useEffect(() => {
    setCompanionFilterCardId(null);
  }, [heroPick?.cardIndex]);

  // 1. Chip stats
  const [cardStats, setCardStats] = useState<QuickLogCardStats | null>(null);
  useEffect(() => {
    if (!user?.id || !heroPick) {
      setCardStats(null);
      return;
    }
    let cancelled = false;
    void getQuickLogCardStats({
      data: { cardId: heroPick.cardIndex, tz: effectiveTz },
    })
      .then((d) => {
        if (!cancelled) setCardStats(d);
      })
      .catch(() => {
        if (!cancelled) setCardStats(null);
      });
    return () => {
      cancelled = true;
    };
  }, [heroPick?.cardIndex, user?.id, effectiveTz, heroPick]);

  // 2. Overlap (calendar strip)
  const [overlap, setOverlap] = useState<QuickLogOverlap | null>(null);
  const [overlapMode, setOverlapMode] = useState<"pull" | "day">("pull");
  useEffect(() => {
    if (!user?.id) {
      setOverlap(null);
      return;
    }
    let cancelled = false;
    void getQuickLogOverlap({
      data: { heroCardId: heroPick?.cardIndex ?? null, tz: effectiveTz },
    })
      .then((d) => {
        if (!cancelled) setOverlap(d);
      })
      .catch(() => {
        if (!cancelled) setOverlap(null);
      });
    return () => {
      cancelled = true;
    };
  }, [heroPick?.cardIndex, user?.id, effectiveTz]);

  // 3. Constellation data
  const [constellationData, setConstellationData] =
    useState<CardConstellation | null>(null);
  useEffect(() => {
    if (!user?.id || !heroPick) {
      setConstellationData(null);
      return;
    }
    let cancelled = false;
    void getCardConstellation({
      data: { heroCardId: heroPick.cardIndex, tz: effectiveTz },
    })
      .then((d) => {
        if (!cancelled) setConstellationData(d);
      })
      .catch(() => {
        if (!cancelled) setConstellationData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [heroPick?.cardIndex, user?.id, effectiveTz]);

  const placedIds = picks.map((p) => p.cardIndex);

  return (
    <div
      className="bg-cosmos text-foreground"
      style={{ minHeight: "100vh", padding: "16px 0 32px" }}
    >
      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px 16px",
        }}
      >
        <div>
          <p
            style={{
              margin: 0,
              fontFamily: "var(--font-display)",
              fontStyle: "italic",
              fontSize: 26,
              color: "var(--color-foreground)",
            }}
          >
            the constellation
          </p>
          <p
            style={{
              margin: "2px 0 0 0",
              fontSize: 10,
              letterSpacing: "0.3em",
              fontFamily: "var(--font-serif)",
              color: "var(--color-foreground-muted, var(--color-foreground))",
              textTransform: "uppercase",
              opacity: 0.75,
            }}
          >
            pick up to 10 cards — the focused card becomes hero
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate({ to: "/draw" })}
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: 11,
            color: "var(--accent, var(--gold))",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            textDecoration: "underline",
            padding: 4,
          }}
        >
          ← back to draw
        </button>
      </div>

      {/* Slot row */}
      <div style={{ padding: "0 24px 16px" }}>
        <p
          style={{
            fontSize: 10,
            letterSpacing: "0.3em",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            color: "var(--accent, var(--gold))",
            margin: "0 0 8px",
            textTransform: "uppercase",
            opacity: 0.85,
          }}
        >
          your pull — 10 slots
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {Array.from({ length: 10 }).map((_, idx) => {
            const pick = picks[idx];
            if (!pick) {
              return (
                <button
                  key={`empty-${idx}`}
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  aria-label="add a card"
                  style={{
                    width: SLOT_W,
                    height: SLOT_H,
                    borderRadius: 6,
                    border: "1px dashed var(--border-default)",
                    background: "transparent",
                    cursor: "pointer",
                    color:
                      "var(--color-foreground-muted, var(--color-foreground))",
                    fontSize: 18,
                  }}
                >
                  +
                </button>
              );
            }
            const isFocused = idx === heroIdx;
            return (
              <button
                key={pick.id}
                type="button"
                onClick={() => setFocusedSlotIdx(idx)}
                style={{
                  position: "relative",
                  width: SLOT_W,
                  padding: 0,
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  borderRadius: 6,
                  outline: isFocused
                    ? "2px solid var(--accent, var(--gold))"
                    : "none",
                  outlineOffset: 2,
                }}
              >
                <CardImage
                  variant="face"
                  cardId={pick.cardIndex}
                  reversed={pick.isReversed}
                  deckId={pick.deckId ?? undefined}
                  size="custom"
                  widthPx={SLOT_W}
                />
              </button>
            );
          })}
        </div>
      </div>

      {/* Two-column layout */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "500px 1fr",
          gap: 24,
          padding: "0 24px",
        }}
      >
        <ConstellationWeb
          heroPick={heroPick}
          constellation={constellationData}
          onCompanionClick={(cardId) =>
            setCompanionFilterCardId((prev) =>
              prev === cardId ? null : cardId,
            )
          }
          selectedCompanion={companionFilterCardId}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {heroPick ? (
            <ChipGrid heroPick={heroPick} stats={cardStats} />
          ) : (
            <p
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: 13,
                color:
                  "var(--color-foreground-muted, var(--color-foreground))",
                margin: 0,
                opacity: 0.7,
              }}
            >
              add a card to see its patterns.
            </p>
          )}
          <MatchingReadingsPanel
            heroPick={heroPick}
            companionFilter={companionFilterCardId}
            matches={constellationData?.matches ?? []}
          />
        </div>
      </div>

      {/* Calendar strip */}
      <div style={{ padding: "24px 24px 0" }}>
        <OverlapStrip
          overlap={overlap}
          heroCardId={heroPick?.cardIndex ?? null}
          pullCardIds={picks.map((p) => p.cardIndex)}
          mode={overlapMode}
          onModeChange={setOverlapMode}
        />
      </div>

      {/* Picker sheet */}
      <Sheet open={pickerOpen} onOpenChange={setPickerOpen}>
        <SheetContent
          side="bottom"
          className="h-[75vh] rounded-t-2xl p-0"
          style={{ zIndex: "var(--z-modal-nested)" as unknown as number }}
        >
          {pickerOpen && (
            <CardPicker
              mode="manual-entry"
              embedded
              deckId={undefined}
              excludeCardIds={placedIds}
              title="Pick a card"
              onCancel={() => setPickerOpen(false)}
              onSelect={(cardIndex, isReversed, _deckId, cardName) => {
                setFocusedSlotIdx(picks.length);
                setPicks((prev) => [
                  ...prev,
                  {
                    id: Date.now() + prev.length,
                    cardIndex,
                    isReversed,
                    deckId: null,
                    cardName,
                  },
                ]);
                setPickerOpen(false);
              }}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}