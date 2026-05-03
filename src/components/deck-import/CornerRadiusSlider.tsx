/**
 * DX — Card corner radius slider section (deck edit view).
 *
 * Live CSS-only preview: the underlying card image element never
 * re-renders or re-encodes; only its inline `border-radius` updates as
 * the user drags. Saves a metadata-only update to
 * `custom_decks.corner_radius_px`.
 */
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchDeckCards, type CustomDeckCard } from "@/lib/custom-decks";
import { getCardImagePath, getCardName } from "@/lib/tarot";

/**
 * App default corner radius (PERCENTAGE) for cards when the deck has no
 * `corner_radius_px` override. The column name kept the legacy `_px`
 * suffix per DY-1A but the value is now a percentage (0–15).
 */
export const APP_DEFAULT_CARD_RADIUS_PCT = 4;

export function CornerRadiusSlider({
  deckId,
  initial,
  onSaved,
}: {
  deckId: string;
  /** Saved value from `custom_decks.corner_radius_px` (null = use default). */
  initial: number | null;
  /** Notify parent so subsequent renders use the new value immediately. */
  onSaved?: (next: number) => void;
}) {
  const [value, setValue] = useState<number>(initial ?? APP_DEFAULT_CARD_RADIUS_PCT);
  const [cards, setCards] = useState<CustomDeckCard[]>([]);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await fetchDeckCards(deckId);
        if (!cancelled) {
          // Sort by card_id so navigation feels deterministic.
          setCards([...list].sort((a, b) => a.card_id - b.card_id));
        }
      } catch {
        /* non-fatal — preview falls back to default art */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deckId]);

  // Build the preview card list. Always render at least the first
  // standard card so the slider has something to show before any custom
  // photos exist.
  const previewCards: { cardId: number; src: string }[] = (() => {
    if (cards.length > 0) {
      return cards.map((c) => ({ cardId: c.card_id, src: c.display_url }));
    }
    return [{ cardId: 0, src: getCardImagePath(0) }];
  })();
  const safeIdx = ((previewIdx % previewCards.length) + previewCards.length) % previewCards.length;
  const preview = previewCards[safeIdx];
  const canNavigate = previewCards.length > 1;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const { error: dbErr } = await supabase
        .from("custom_decks")
        .update({ corner_radius_px: value })
        .eq("id", deckId);
      if (dbErr) throw dbErr;
      onSaved?.(value);
    } catch (err) {
      setError("Couldn't save. Try again.");
      // eslint-disable-next-line no-console
      console.warn("[corner-radius-save]", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      className="mb-4 rounded-lg border p-4"
      style={{
        background: "var(--surface-card)",
        borderColor: "var(--border-subtle)",
      }}
      aria-label="Card corner radius"
    >
      <header className="mb-3">
        <h3
          className="italic"
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "var(--text-heading-sm)",
            color: "var(--color-foreground)",
          }}
        >
          Card corner radius
        </h3>
      </header>

      {/* Preview */}
      <div className="mb-3 flex flex-col items-center gap-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={!canNavigate}
            onClick={() => setPreviewIdx((i) => i - 1)}
            className="rounded-full p-1.5 disabled:opacity-30"
            style={{ color: "var(--color-foreground)" }}
            aria-label="Previous card"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div
            className="overflow-hidden border"
            style={{
              width: "min(60vw, 200px)",
              aspectRatio: "1 / 1.75",
              borderRadius: `${value}%`,
              borderColor: "var(--border-subtle)",
              background: "var(--cosmos, #0a0a14)",
            }}
          >
            <img
              src={preview.src}
              alt={getCardName(preview.cardId)}
              className="h-full w-full object-cover"
              style={{ borderRadius: `${value}%` }}
              loading="lazy"
              onError={(e) => {
                // Fallback to default art if a saved URL is broken.
                const t = e.currentTarget as HTMLImageElement;
                if (t.src !== getCardImagePath(preview.cardId)) {
                  t.src = getCardImagePath(preview.cardId);
                }
              }}
            />
          </div>
          <button
            type="button"
            disabled={!canNavigate}
            onClick={() => setPreviewIdx((i) => i + 1)}
            className="rounded-full p-1.5 disabled:opacity-30"
            style={{ color: "var(--color-foreground)" }}
            aria-label="Next card"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
        <div
          className="uppercase"
          style={{
            fontSize: "var(--text-caption, 0.7rem)",
            letterSpacing: "0.18em",
            color: "var(--color-foreground)",
            opacity: 0.6,
          }}
        >
          {value}%
        </div>
      </div>

      {/* Slider */}
      <label className="block">
        <span
          className="mb-2 block"
          style={{
            fontSize: "var(--text-body-sm)",
            color: "var(--color-foreground)",
            opacity: 0.85,
          }}
        >
          Adjust the corner curvature
        </span>
        <input
          type="range"
          min={0}
          max={15}
          step={1}
          value={value}
          onChange={(e) => setValue(Number(e.target.value))}
          className="block w-full"
          aria-label="Card corner radius slider"
        />
        <div
          className="mt-1 flex justify-between uppercase"
          style={{
            fontSize: "var(--text-caption, 0.7rem)",
            letterSpacing: "0.18em",
            color: "var(--color-foreground)",
            opacity: 0.6,
          }}
        >
          <span>Sharp</span>
          <span>Rounded</span>
        </div>
      </label>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
          style={{
            background: "var(--accent)",
            color: "var(--accent-foreground, #000)",
            borderRadius: "var(--radius-md, 8px)",
          }}
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Save corner radius
        </button>
        {error && (
          <span
            style={{
              fontSize: "var(--text-body-sm)",
              color: "#ef4444",
            }}
            role="alert"
          >
            {error}
          </span>
        )}
      </div>
    </section>
  );
}