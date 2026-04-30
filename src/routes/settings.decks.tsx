/**
 * /settings/decks — My Decks (Phase 9.5b, Stamp AT/AW).
 *
 * List custom decks, create new ones, photograph cards, set the active deck,
 * and delete. Free tier capped at FREE_DECK_LIMIT (Stamp AW); when the user
 * exceeds the cap the "New deck" button becomes a paywall hint.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Camera,
  Check,
  Loader2,
  Plus,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import {
  FREE_DECK_LIMIT,
  fetchDeckCards,
  fetchUserDecks,
  setActiveDeck,
  type CustomDeck,
  type CustomDeckCard,
} from "@/lib/custom-decks";
import { useActiveDeck } from "@/lib/active-deck";
import { PhotoCapture } from "@/components/photo/PhotoCapture";
import { CardPicker } from "@/components/cards/CardPicker";
import { getCardName, getCardImagePath } from "@/lib/tarot";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings/decks")({
  head: () => ({ meta: [{ title: "My Decks — Moonseed" }] }),
  component: DecksPage,
});

const DECK_BUCKET = "custom-deck-images";

/** Common physical tarot deck sizes (inches). */
const DIMENSION_PRESETS: { label: string; w: number; h: number }[] = [
  { label: "Standard", w: 2.75, h: 4.75 },
  { label: "Large Oracle", w: 3.5, h: 5 },
  { label: "Pocket", w: 2.5, h: 3.5 },
  { label: "Square", w: 3.5, h: 3.5 },
];

const CORNER_PRESETS: { label: string; value: number }[] = [
  { label: "Sharp", value: 0 },
  { label: "Slight", value: 4 },
  { label: "Heavy", value: 10 },
  { label: "Custom", value: 7 },
];

type WizardState =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "edit"; deck: CustomDeck };

function DecksPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { refresh: refreshActiveDeck } = useActiveDeck();
  const [decks, setDecks] = useState<CustomDeck[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<WizardState>({ kind: "list" });

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const list = await fetchUserDecks(user.id);
      setDecks(list);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSetActive = async (deck: CustomDeck) => {
    if (!user) return;
    await setActiveDeck(user.id, deck.is_active ? null : deck.id);
    await Promise.all([load(), refreshActiveDeck()]);
  };

  const handleDelete = async (deck: CustomDeck) => {
    if (!user) return;
    if (!confirm(`Delete deck "${deck.name}"? This removes all photographed cards.`)) return;
    // Try to clean storage objects (best-effort; cascade handles DB rows).
    try {
      const cards = await fetchDeckCards(deck.id);
      const paths = cards.flatMap((c) => [c.display_path, c.thumbnail_path]);
      if (deck.card_back_url) {
        // card_back_url is a signed URL — we don't store the path, skip.
      }
      if (paths.length) await supabase.storage.from(DECK_BUCKET).remove(paths);
    } catch {
      /* non-fatal */
    }
    await supabase.from("custom_decks").delete().eq("id", deck.id);
    await Promise.all([load(), refreshActiveDeck()]);
  };

  if (!user) return null;

  if (view.kind === "create" || view.kind === "edit") {
    return (
      <DeckEditor
        userId={user.id}
        existing={view.kind === "edit" ? view.deck : null}
        onClose={async (saved) => {
          setView({ kind: "list" });
          if (saved) await Promise.all([load(), refreshActiveDeck()]);
        }}
      />
    );
  }

  const overLimit = decks.length >= FREE_DECK_LIMIT;

  return (
    <section className="py-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">My Decks</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Photograph your physical deck so the app shows your art instead of the default.
          </p>
        </div>
        <button
          type="button"
          disabled={overLimit}
          onClick={() => setView({ kind: "create" })}
          className={cn(
            "inline-flex items-center gap-2 rounded-md border border-gold/40 px-3 py-2 text-sm",
            overLimit
              ? "cursor-not-allowed opacity-40"
              : "hover:bg-gold/10",
          )}
          title={overLimit ? `Free tier limited to ${FREE_DECK_LIMIT} decks` : undefined}
        >
          <Plus className="h-4 w-4" /> New deck
        </button>
      </header>

      {overLimit && (
        <div className="mb-4 rounded-md border border-gold/30 bg-gold/5 p-3 text-sm">
          You've reached the free tier limit of {FREE_DECK_LIMIT} decks. Delete one to add another, or upgrade for unlimited decks.
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : decks.length === 0 ? (
        <EmptyState onCreate={() => setView({ kind: "create" })} />
      ) : (
        <ul className="space-y-3">
          {decks.map((d) => (
            <DeckRow
              key={d.id}
              deck={d}
              onEdit={() => setView({ kind: "edit", deck: d })}
              onToggleActive={() => void handleSetActive(d)}
              onDelete={() => void handleDelete(d)}
            />
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => navigate({ to: "/settings/profile" })}
        className="mt-6 text-xs text-muted-foreground underline"
      >
        Back to settings
      </button>
    </section>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-gold/20 p-8 text-center">
      <p className="mb-3 text-sm text-muted-foreground">
        No custom decks yet. The app uses the Rider-Waite deck by default.
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="inline-flex items-center gap-2 rounded-md border border-gold/40 px-3 py-2 text-sm hover:bg-gold/10"
      >
        <Plus className="h-4 w-4" /> Photograph your first deck
      </button>
    </div>
  );
}

function DeckRow({
  deck,
  onEdit,
  onToggleActive,
  onDelete,
}: {
  deck: CustomDeck;
  onEdit: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
}) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { count } = await supabase
        .from("custom_deck_cards")
        .select("id", { count: "exact", head: true })
        .eq("deck_id", deck.id);
      if (!cancelled) setCount(count ?? 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [deck.id]);

  return (
    <li className="flex items-center gap-3 rounded-lg border border-gold/15 bg-card p-3">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-gold/15 bg-cosmos">
        {deck.card_back_thumb_url ? (
          <img src={deck.card_back_thumb_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <Camera className="h-5 w-5 opacity-40" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-medium">{deck.name}</p>
          {deck.is_active && (
            <span className="inline-flex items-center gap-1 rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-gold">
              <Star className="h-3 w-3" /> Active
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {count === null ? "…" : `${count}/78 photographed`} · {deck.shape}
        </p>
      </div>
      <button
        type="button"
        onClick={onToggleActive}
        className="rounded-md border border-gold/30 px-2 py-1 text-xs hover:bg-gold/10"
      >
        {deck.is_active ? "Deactivate" : "Set active"}
      </button>
      <button
        type="button"
        onClick={onEdit}
        className="rounded-md border border-gold/30 px-2 py-1 text-xs hover:bg-gold/10"
      >
        Edit
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="rounded-md border border-destructive/40 p-1.5 text-destructive hover:bg-destructive/10"
        aria-label="Delete deck"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/*  Deck editor (create + photograph cards)                            */
/* ------------------------------------------------------------------ */

type EditorMode =
  | { kind: "details" }
  | { kind: "grid"; deckId: string }
  | { kind: "picker"; deckId: string }
  | { kind: "capture"; deckId: string; cardId: number }
  | { kind: "back-capture"; deckId: string };

function DeckEditor({
  userId,
  existing,
  onClose,
}: {
  userId: string;
  existing: CustomDeck | null;
  onClose: (saved: boolean) => void;
}) {
  const [name, setName] = useState(existing?.name ?? "My Deck");
  const [shape, setShape] = useState<CustomDeck["shape"]>(existing?.shape ?? "rectangle");
  const [cornerRadius, setCornerRadius] = useState(existing?.corner_radius_percent ?? 4);
  const [widthInches, setWidthInches] = useState<number>(
    existing?.width_inches ?? 2.75,
  );
  const [heightInches, setHeightInches] = useState<number>(
    existing?.height_inches ?? 4.75,
  );
  const [mode, setMode] = useState<EditorMode>(
    existing ? { kind: "grid", deckId: existing.id } : { kind: "details" },
  );
  const [saving, setSaving] = useState(false);
  const [cards, setCards] = useState<CustomDeckCard[]>([]);
  const [deckBackUrl, setDeckBackUrl] = useState<string | null>(
    existing?.card_back_url ?? null,
  );

  const reloadCards = useCallback(async (deckId: string) => {
    const list = await fetchDeckCards(deckId);
    setCards(list);
  }, []);

  useEffect(() => {
    if (existing) void reloadCards(existing.id);
  }, [existing, reloadCards]);

  const photographedIds = useMemo(() => cards.map((c) => c.card_id), [cards]);

  const aspectRatio =
    shape === "square" || shape === "round"
      ? 1
      : widthInches > 0 && heightInches > 0
        ? widthInches / heightInches
        : 0.625;

  // ---------- Step 1: deck details ----------
  if (mode.kind === "details") {
    return (
      <section className="py-6">
        <header className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">New deck</h1>
          <button
            type="button"
            onClick={() => onClose(false)}
            className="rounded-md p-1.5 hover:bg-foreground/5"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium">Deck name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gold/20 bg-cosmos px-3 py-2 text-sm"
              maxLength={60}
            />
          </label>

          <div>
            <span className="text-sm font-medium">Card shape</span>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {(["rectangle", "square", "round"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setShape(s)}
                  className={cn(
                    "rounded-md border px-3 py-2 text-sm capitalize",
                    shape === s
                      ? "border-gold bg-gold/10 text-gold"
                      : "border-gold/20 text-muted-foreground hover:bg-gold/5",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {shape === "rectangle" && (
            <div>
              <span className="text-sm font-medium">Card dimensions</span>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {DIMENSION_PRESETS.map((p) => {
                  const active =
                    Math.abs(widthInches - p.w) < 0.01 &&
                    Math.abs(heightInches - p.h) < 0.01;
                  return (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => {
                        setWidthInches(p.w);
                        setHeightInches(p.h);
                      }}
                      className={cn(
                        "rounded-md border px-2 py-2 text-xs",
                        active
                          ? "border-gold bg-gold/10 text-gold"
                          : "border-gold/20 text-muted-foreground hover:bg-gold/5",
                      )}
                    >
                      <div className="font-medium">{p.label}</div>
                      <div className="text-[10px] opacity-70">
                        {p.w}″ × {p.h}″
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <label className="flex flex-1 items-center gap-1 text-xs">
                  <span className="text-muted-foreground">W</span>
                  <input
                    type="number"
                    step="0.05"
                    value={widthInches}
                    onChange={(e) => setWidthInches(Number(e.target.value))}
                    className="w-full rounded-md border border-gold/20 bg-cosmos px-2 py-1 text-xs"
                  />
                </label>
                <label className="flex flex-1 items-center gap-1 text-xs">
                  <span className="text-muted-foreground">H</span>
                  <input
                    type="number"
                    step="0.05"
                    value={heightInches}
                    onChange={(e) => setHeightInches(Number(e.target.value))}
                    className="w-full rounded-md border border-gold/20 bg-cosmos px-2 py-1 text-xs"
                  />
                </label>
              </div>
              {widthInches > 0 && heightInches > 0 && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Ratio: {(widthInches / heightInches).toFixed(2)}{" "}
                  ({widthInches / heightInches >= 1 ? "landscape" : "portrait"})
                  {" — only the proportion matters; absolute size is for reference."}
                </p>
              )}
            </div>
          )}

          {shape !== "round" && (
            <div>
              <span className="text-sm font-medium">
                Corner radius — {cornerRadius}%
              </span>
              <div className="mt-2 grid grid-cols-4 gap-2">
                {CORNER_PRESETS.map((p) => {
                  const active = cornerRadius === p.value;
                  return (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => setCornerRadius(p.value)}
                      className={cn(
                        "rounded-md border px-2 py-2 text-xs",
                        active
                          ? "border-gold bg-gold/10 text-gold"
                          : "border-gold/20 text-muted-foreground hover:bg-gold/5",
                      )}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
              <input
                type="range"
                min={0}
                max={15}
                value={cornerRadius}
                onChange={(e) => setCornerRadius(Number(e.target.value))}
                className="mt-2 block w-full"
                aria-label="Corner radius slider"
              />
            </div>
          )}

          <button
            type="button"
            disabled={saving || !name.trim()}
            onClick={async () => {
              setSaving(true);
              try {
                const { data, error } = await supabase
                  .from("custom_decks")
                  .insert({
                    user_id: userId,
                    name: name.trim(),
                    shape,
                    corner_radius_percent: cornerRadius,
                    width_inches: shape === "rectangle" ? widthInches : null,
                    height_inches: shape === "rectangle" ? heightInches : null,
                  })
                  .select("*")
                  .single();
                if (error) throw error;
                // Fix 5 — go straight to card-back capture so the user
                // sees their deck "exist" in the app immediately.
                setMode({ kind: "back-capture", deckId: (data as CustomDeck).id });
              } catch (err) {
                alert(`Couldn't create deck: ${(err as Error).message}`);
              } finally {
                setSaving(false);
              }
            }}
            className="inline-flex items-center gap-2 rounded-md border border-gold/40 bg-gold/10 px-4 py-2 text-sm font-medium hover:bg-gold/20 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Continue → photograph cards
          </button>
        </div>
      </section>
    );
  }

  // ---------- Step 2: card grid (overview + entry to picker) ----------
  if (mode.kind === "grid") {
    const deckId = mode.deckId;
    const photographedMap = new Map<number, CustomDeckCard>(
      cards.map((c) => [c.card_id, c]),
    );
    return (
      <section className="py-6">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{name}</h1>
            <p className="text-sm text-muted-foreground">
              {photographedIds.length}/78 cards photographed
            </p>
          </div>
          <button
            type="button"
            onClick={() => onClose(true)}
            className="rounded-md border border-gold/30 px-3 py-1.5 text-sm hover:bg-gold/10"
          >
            Done
          </button>
        </header>

        <div className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setMode({ kind: "picker", deckId })}
            className="inline-flex items-center gap-2 rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-sm hover:bg-gold/20"
          >
            <Camera className="h-4 w-4" /> Photograph a card
          </button>
          <button
            type="button"
            onClick={() => setMode({ kind: "back-capture", deckId })}
            className="inline-flex items-center gap-2 rounded-md border border-gold/30 px-3 py-2 text-sm hover:bg-gold/10"
          >
            <Camera className="h-4 w-4" />
            {deckBackUrl ? "Replace card back" : "Set card back"}
          </button>
        </div>

        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {Array.from({ length: 78 }, (_, i) => {
            const photo = photographedMap.get(i);
            return (
              <button
                key={i}
                type="button"
                onClick={() => setMode({ kind: "capture", deckId, cardId: i })}
                className="group relative aspect-[2/3] overflow-hidden rounded border border-gold/15 bg-cosmos"
                title={getCardName(i)}
              >
                <img
                  src={photo?.thumbnail_url ?? getCardImagePath(i)}
                  alt={getCardName(i)}
                  className={cn(
                    "h-full w-full object-cover",
                  )}
                  style={
                    !photo
                      ? { opacity: 0.3, filter: "grayscale(100%)" }
                      : undefined
                  }
                  loading="lazy"
                />
                {photo && (
                  <span className="absolute right-1 top-1 rounded-full bg-gold/90 p-0.5 text-cosmos">
                    <Check className="h-3 w-3" />
                  </span>
                )}
                {!photo && (
                  <span className="pointer-events-none absolute inset-x-0 bottom-1 text-center text-[8px] uppercase tracking-wider text-white/70">
                    Tap to photograph
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>
    );
  }

  // ---------- Step 3a: card picker (jump to capture) ----------
  if (mode.kind === "picker") {
    const deckId = mode.deckId;
    return (
      <CardPicker
        mode="photography"
        photographedIds={photographedIds}
        title={`${name} — choose card`}
        onCancel={() => setMode({ kind: "grid", deckId })}
        onSelect={(cardId) => setMode({ kind: "capture", deckId, cardId })}
      />
    );
  }

  // ---------- Step 3b: capture a card ----------
  if (mode.kind === "capture") {
    const { deckId, cardId } = mode;
    return (
      <PhotoCapture
        shape={shape === "round" ? "round" : shape === "square" ? "square" : "rectangle"}
        aspectRatio={aspectRatio}
        cornerRadiusPercent={cornerRadius}
        outputMaxDimension={900}
        guideText={`Photograph: ${getCardName(cardId)}`}
        onCancel={() => setMode({ kind: "grid", deckId })}
        onCapture={async (blob) => {
          await uploadAndStoreCard({
            userId,
            deckId,
            cardId,
            blob,
          });
          await reloadCards(deckId);
          setMode({ kind: "grid", deckId });
        }}
      />
    );
  }

  // ---------- Step 3c: capture card back ----------
  if (mode.kind === "back-capture") {
    const deckId = mode.deckId;
    return (
      <PhotoCapture
        shape={shape === "round" ? "round" : shape === "square" ? "square" : "rectangle"}
        aspectRatio={aspectRatio}
        cornerRadiusPercent={cornerRadius}
        outputMaxDimension={900}
        guideText="Photograph the card back"
        onCancel={() => setMode({ kind: "grid", deckId })}
        onCapture={async (blob) => {
          const url = await uploadDeckBack({ userId, deckId, blob });
          if (url) setDeckBackUrl(url);
          setMode({ kind: "grid", deckId });
        }}
      />
    );
  }

  return null;
}

/* ------------------------------------------------------------------ */
/*  Storage helpers                                                    */
/* ------------------------------------------------------------------ */

async function uploadAndStoreCard(args: {
  userId: string;
  deckId: string;
  cardId: number;
  blob: Blob;
}): Promise<void> {
  const { userId, deckId, cardId, blob } = args;
  const ts = Date.now();
  const displayPath = `${userId}/${deckId}/card-${cardId}-${ts}.webp`;
  const thumbnailPath = displayPath; // same file (no separate thumb pipeline yet)

  const { error: upErr } = await supabase.storage
    .from(DECK_BUCKET)
    .upload(displayPath, blob, { contentType: "image/webp", upsert: true });
  if (upErr) throw upErr;

  const { data: signed } = await supabase.storage
    .from(DECK_BUCKET)
    .createSignedUrl(displayPath, 60 * 60 * 24 * 365);
  const url = signed?.signedUrl ?? "";

  // Replace any prior row for this (deck, card).
  await supabase
    .from("custom_deck_cards")
    .delete()
    .eq("deck_id", deckId)
    .eq("card_id", cardId);

  const { error: insErr } = await supabase.from("custom_deck_cards").insert({
    deck_id: deckId,
    user_id: userId,
    card_id: cardId,
    display_url: url,
    thumbnail_url: url,
    display_path: displayPath,
    thumbnail_path: thumbnailPath,
  });
  if (insErr) throw insErr;

  // Mark complete if we now have all 78 cards.
  const { count } = await supabase
    .from("custom_deck_cards")
    .select("id", { count: "exact", head: true })
    .eq("deck_id", deckId);
  if ((count ?? 0) >= 78) {
    await supabase
      .from("custom_decks")
      .update({ is_complete: true })
      .eq("id", deckId);
  }
}

async function uploadDeckBack(args: {
  userId: string;
  deckId: string;
  blob: Blob;
}): Promise<string | null> {
  const { userId, deckId, blob } = args;
  const ts = Date.now();
  const path = `${userId}/${deckId}/back-${ts}.webp`;
  const { error } = await supabase.storage
    .from(DECK_BUCKET)
    .upload(path, blob, { contentType: "image/webp", upsert: true });
  if (error) {
    alert(`Couldn't save card back: ${error.message}`);
    return null;
  }
  const { data } = await supabase.storage
    .from(DECK_BUCKET)
    .createSignedUrl(path, 60 * 60 * 24 * 365);
  const url = data?.signedUrl ?? null;
  if (url) {
    await supabase
      .from("custom_decks")
      .update({ card_back_url: url, card_back_thumb_url: url })
      .eq("id", deckId);
  }
  return url;
}