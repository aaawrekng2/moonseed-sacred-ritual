/**
 * /settings/decks — My Decks (Phase 9.5b, Stamp AT/AW).
 *
 * List custom decks, create new ones, photograph cards, set the active deck,
 * and delete. Free tier capped at FREE_DECK_LIMIT (Stamp AW); when the user
 * exceeds the cap the "New deck" button becomes a paywall hint.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Camera,
  Check,
  Loader2,
  Plus,
  Star,
  Trash2,
  X,
  Upload,
  Zap,
  Scissors,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { useConfirm } from "@/hooks/use-confirm";
import { LoadingText } from "@/components/ui/loading-text";
import { EmptyHero } from "@/components/ui/empty-hero";
import { useRegisterCloseHandler } from "@/lib/floating-menu-context";
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
import { ZipImporter } from "@/components/deck-import/ZipImporter";
import { PerCardEditModal } from "@/components/deck-import/PerCardEditModal";
import { deleteSession, getSession } from "@/lib/import-session";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { SettingsSection } from "@/components/settings/sections";

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
];

const CORNER_PRESETS: { label: string; value: number }[] = [
  { label: "Sharp", value: 0 },
  { label: "Slight", value: 4 },
  { label: "Heavy", value: 10 },
  { label: "Custom", value: 7 },
];

const SAMPLE_PREVIEW_CARD_ID = 17; // The Star — generally pretty

type WizardState =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "edit"; deck: CustomDeck }
  // CC G5 — open the deck editor and force-route into the upload phase
  // so the user sees the "Choose zip file" picker immediately.
  | { kind: "edit-import"; deck: CustomDeck };

function DecksPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { refresh: refreshActiveDeck } = useActiveDeck();
  const [decks, setDecks] = useState<CustomDeck[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<WizardState>({ kind: "list" });
  const confirm = useConfirm();

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
    const ok = await confirm({
      title: `Delete deck "${deck.name}"?`,
      description: "This removes all customized cards.",
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (!ok) return;
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
        startInUploadPhase={false}
        onClose={async (saved) => {
          setView({ kind: "list" });
          // Always refresh on return — Save inside the editor may have
          // mutated rows even when 'saved' is false.
          await Promise.all([load(), refreshActiveDeck()]);
        }}
      />
    );
  }

  if (view.kind === "edit-import") {
    return (
      <DeckEditor
        userId={user.id}
        existing={view.deck}
        startInUploadPhase={true}
        onClose={async (saved) => {
          setView({ kind: "list" });
          await Promise.all([load(), refreshActiveDeck()]);
        }}
      />
    );
  }

  const overLimit = decks.length >= FREE_DECK_LIMIT;

  return (
    <SettingsSection
      title="My Decks"
      description="Customize tarot decks with your own card images. The app uses Rider-Waite by default."
    >
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

      {overLimit && (
        <div className="rounded-md border border-gold/30 bg-gold/5 p-3 text-sm">
          You've reached the free tier limit of {FREE_DECK_LIMIT} decks. Delete one to add another, or upgrade for unlimited decks.
        </div>
      )}

      {loading ? (
        <LoadingText>Loading decks…</LoadingText>
      ) : decks.length === 0 ? (
        <EmptyState onCreate={() => setView({ kind: "create" })} />
      ) : (
        <ul className="space-y-3">
          {decks.map((d) => (
            <DeckRow
              key={d.id}
              deck={d}
              onEdit={() => setView({ kind: "edit", deck: d })}
              onImportZip={() => setView({ kind: "edit-import", deck: d })}
              onToggleActive={() => void handleSetActive(d)}
              onDelete={() => void handleDelete(d)}
            />
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => navigate({ to: "/settings/profile" })}
        className="text-xs text-muted-foreground underline"
      >
        Back to settings
      </button>
    </SettingsSection>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <EmptyHero
      title="No custom decks yet."
      subtitle="The app uses the Rider-Waite deck by default."
      cta={{
        label: "Create your first deck",
        onClick: onCreate,
      }}
    />
  );
}

function DeckRow({
  deck,
  onEdit,
  onImportZip,
  onToggleActive,
  onDelete,
}: {
  deck: CustomDeck;
  onEdit: () => void;
  onImportZip: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
}) {
  const [count, setCount] = useState<number | null>(null);
  // EZ-7 — One-tap backfill of pre-resized small/medium variants
  // for every card in this deck. Speeds up journal/insights renders
  // by 10-50× on decks with multi-MB scans.
  const [variantBusy, setVariantBusy] = useState(false);
  // FD-2 — open the per-card rounded-corner editor.
  const [showRoundEditor, setShowRoundEditor] = useState(false);
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

  const handleGenerateVariants = async () => {
    if (variantBusy) return;
    setVariantBusy(true);
    // FB-6 — loop chunked invocations until the function reports
    // nextCursor === null. Each call processes ~12 cards in well
    // under the Edge Function timeout. Progress is surfaced via a
    // single toast id that updates as chunks complete.
    const progressToastId = toast.loading("Optimizing deck images…");
    try {
      const { data: sess } = await supabase.auth.getSession();
      const jwt = sess.session?.access_token;
      if (!jwt) {
        toast.dismiss(progressToastId);
        toast.error("Sign in required.");
        return;
      }
      let cursor: number | null = 0;
      let totalGenerated = 0;
      let totalSkipped = 0;
      let totalFailed = 0;
      let totalCards = 0;
      // Safety cap — even with 78 cards and BATCH_SIZE=12 we expect
      // ≤ 7 invocations. Cap loops at 50 to avoid pathological cycles.
      let safety = 50;
      while (cursor !== null && safety-- > 0) {
        const { data, error } = await supabase.functions.invoke(
          "generate-deck-variants",
          {
            body: { deckId: deck.id, cursor },
            headers: { Authorization: `Bearer ${jwt}` },
          },
        );
        if (error) throw error;
        const summary = (data ?? {}) as {
          generated?: number;
          skipped?: number;
          failed?: number;
          totalCards?: number;
          processed?: number;
          nextCursor?: number | null;
        };
        totalGenerated += summary.generated ?? 0;
        totalSkipped += summary.skipped ?? 0;
        totalFailed += summary.failed ?? 0;
        totalCards = summary.totalCards ?? totalCards;
        const processed = summary.processed ?? 0;
        toast.loading(
          totalCards > 0
            ? `Optimizing… ${processed}/${totalCards} cards`
            : "Optimizing…",
          { id: progressToastId },
        );
        cursor = summary.nextCursor ?? null;
      }
      toast.dismiss(progressToastId);
      if (totalGenerated === 0) {
        toast.success(
          `Already optimized (${totalSkipped} variants present).`,
        );
      } else {
        toast.success(
          `Generated ${totalGenerated} variants` +
            (totalFailed > 0 ? ` · ${totalFailed} failed` : ""),
        );
      }
    } catch (err) {
      toast.dismiss(progressToastId);
      console.error("[EZ-7] variant generation failed", err);
      toast.error(
        err instanceof Error
          ? `Optimize failed: ${err.message}`
          : "Optimize failed.",
      );
    } finally {
      setVariantBusy(false);
    }
  };

  return (
    <li className="flex items-center gap-3 rounded-lg border border-border/60 bg-card p-3">
      <button
        type="button"
        onClick={onEdit}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        aria-label={`Edit ${deck.name}`}
      >
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/60 bg-cosmos">
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
            {count === null ? "…" : `${count}/78 customized`} · {deck.shape}
          </p>
        </div>
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggleActive(); }}
        className="rounded-md border border-gold/30 px-2 py-1 text-xs hover:bg-gold/10"
      >
        {deck.is_active ? "Deactivate" : "Set active"}
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onEdit(); }}
        className="rounded-md border border-gold/30 px-2 py-1 text-xs hover:bg-gold/10"
      >
        Edit
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onImportZip(); }}
        className="rounded-md border border-gold/30 px-2 py-1 text-xs hover:bg-gold/10"
        title="Import / replace from zip"
      >
        <Upload className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          void handleGenerateVariants();
        }}
        disabled={variantBusy}
        className="rounded-md border border-gold/30 px-2 py-1 text-xs hover:bg-gold/10 disabled:opacity-50"
        title="Optimize for fast loading (generate small/medium variants)"
        aria-label="Optimize deck images"
      >
        {variantBusy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Zap className="h-3.5 w-3.5" />
        )}
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setShowRoundEditor(true);
        }}
        className="rounded-md border border-gold/30 px-2 py-1 text-xs hover:bg-gold/10"
        title="Round corners per card (FD)"
        aria-label="Round corners per card"
      >
        <Scissors className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="rounded-md border border-destructive/40 p-1.5 text-destructive hover:bg-destructive/10"
        aria-label="Delete deck"
      >
        <Trash2 className="h-4 w-4" />
      </button>
      {showRoundEditor ? (
        <PerCardEditModal
          deckId={deck.id}
          deckName={deck.name}
          defaultRadiusPercent={deck.corner_radius_percent ?? 4}
          onClose={() => setShowRoundEditor(false)}
        />
      ) : null}
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
  | { kind: "back-capture"; deckId: string }
  | { kind: "import"; deckId: string }
  // CC G5 — Unified deck-editor workspace. Routes "Edit" straight to
  // the ZipImporter component in edit-mode so the user lands in the
  // 78-slot workspace without an intermediate grid view.
  | { kind: "workspace"; deckId: string; initialPhase?: "upload" | "workspace" };

function DeckEditor({
  userId,
  existing,
  startInUploadPhase = false,
  onClose,
}: {
  userId: string;
  existing: CustomDeck | null;
  startInUploadPhase?: boolean;
  onClose: (saved: boolean) => void;
}) {
  const [name, setName] = useState(existing?.name ?? "My Deck");
  const [shape, setShape] = useState<CustomDeck["shape"]>(existing?.shape ?? "rectangle");
  const [cornerRadius, setCornerRadius] = useState(existing?.corner_radius_percent ?? 4);
  const cornerRadiusPx = existing?.corner_radius_px ?? null;
  const [mode, setMode] = useState<EditorMode>(
    existing
      ? {
          kind: "workspace",
          deckId: existing.id,
          initialPhase: startInUploadPhase ? "upload" : "workspace",
        }
      : { kind: "details" },
  );
  // EH-4 — wire FloatingMenu X icon to close back to deck list when
  // we're in the grid overview. Workspace mode is handled inside
  // ZipImporter itself.
  useRegisterCloseHandler(
    mode.kind === "grid" ? () => onClose(true) : null,
  );
  const [saving, setSaving] = useState(false);
  const [cards, setCards] = useState<CustomDeckCard[]>([]);
  const [deckBackUrl, setDeckBackUrl] = useState<string | null>(
    existing?.card_back_url ?? null,
  );
  // Grid-view "Retake / Done" review modal — Stamp BI Fix 2.
  const [reviewingCardId, setReviewingCardId] = useState<number | null>(null);
  // BL Fix 8 — resume-prompt state
  const [resumePrompt, setResumePrompt] = useState<
    | null
    | {
        assigned: number;
        unassigned: number;
        skipped: number;
      }
  >(null);

  const reloadCards = useCallback(async (deckId: string) => {
    const list = await fetchDeckCards(deckId);
    setCards(list);
  }, []);

  useEffect(() => {
    if (existing) void reloadCards(existing.id);
  }, [existing, reloadCards]);

  // BL Fix 8 — check for in-progress import session on existing-deck mount.
  useEffect(() => {
    if (!existing) return;
    let cancelled = false;
    void (async () => {
      try {
        const session = await getSession(existing.id);
        if (cancelled || !session) return;
        const ageMs = Date.now() - (session.updatedAt ?? session.createdAt ?? 0);
        if (ageMs > 30 * 24 * 60 * 60 * 1000) {
          await deleteSession(existing.id);
          return;
        }
        // BLa Fix C — EXISTING:* markers only appear in session.assigned
        // now (Fix B), so unassigned/skipped counts are clean. Filter
        // EXISTING:* out of assigned so we only prompt when there's real
        // user work in progress.
        const assignedCount = Object.entries(session.assigned).filter(
          ([, k]) => !String(k).startsWith("EXISTING:"),
        ).length;
        const unassignedCount = Object.keys(session.unassigned).length;
        const skippedCount = Object.keys(session.skipped).length;
        if (assignedCount + unassignedCount + skippedCount === 0) return;
        setResumePrompt({
          assigned: assignedCount,
          unassigned: unassignedCount,
          skipped: skippedCount,
        });
      } catch (err) {
        console.warn("[settings.decks] session check failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [existing]);

  const photographedIds = useMemo(() => cards.map((c) => c.card_id), [cards]);

  const aspectRatio = shape === "round" ? 1 : 0.625;

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
              onFocus={(e) => e.target.select()}
              className="mt-1 block w-full rounded-md border border-border/60 bg-cosmos px-3 py-2 text-sm"
              maxLength={60}
            />
          </label>

          <div>
            <span className="text-sm font-medium">Card shape</span>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(["rectangle", "round"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setShape(s)}
                  className={cn(
                    "rounded-md border px-3 py-2 text-sm capitalize",
                    shape === s
                      ? "border-gold bg-gold/10 text-gold"
                      : "border-border/60 text-muted-foreground hover:bg-gold/5",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

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
                          : "border-border/60 text-muted-foreground hover:bg-gold/5",
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
                max={20}
                step={1}
                value={cornerRadius}
                onChange={(e) => setCornerRadius(Number(e.target.value))}
                className="mt-2 block w-full"
                aria-label="Corner radius slider"
              />
              <CornerRadiusPreview cornerRadiusPercent={cornerRadius} />
            </div>
          )}

          {shape === "round" && (
            <div className="text-center">
              <RoundShapePreview />
              <p className="mt-2 text-xs text-muted-foreground italic">
                Round decks always use a circular mask.
              </p>
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
                  })
                  .select("*")
                  .single();
                if (error) throw error;
                // Fix 5 — go straight to card-back capture so the user
                // sees their deck "exist" in the app immediately.
                setMode({ kind: "back-capture", deckId: (data as CustomDeck).id });
              } catch (err) {
                toast.error(`Couldn't create deck: ${(err as Error).message}`);
              } finally {
                setSaving(false);
              }
            }}
            className="inline-flex items-center gap-2 rounded-md border border-gold/40 bg-gold/10 px-4 py-2 text-sm font-medium hover:bg-gold/20 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Continue → photograph cards
          </button>

          {/* Bulk import entry — Stamp BH. Creates the deck row first so a
              cancelled import still leaves a recoverable empty deck. */}
          <div className="pt-2">
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
                    })
                    .select("*")
                    .single();
                  if (error) throw error;
                  setMode({ kind: "import", deckId: (data as CustomDeck).id });
                } catch (err) {
                  toast.error(`Couldn't create deck: ${(err as Error).message}`);
                } finally {
                  setSaving(false);
                }
              }}
              className="italic underline disabled:opacity-50"
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: "var(--text-body-sm)",
                color: "var(--color-foreground)",
                opacity: 0.85,
                background: "none",
                border: "none",
                padding: 0,
              }}
            >
              Already have your deck digitized? Import from zip
            </button>
          </div>
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
        {/* EH-4 — close affordance moved to global FloatingMenu */}
        <header className="mb-6">
          <h1 className="truncate text-2xl font-semibold">{name}</h1>
          <p className="text-sm text-muted-foreground">
            {photographedIds.length}/78 cards customized
          </p>
        </header>

        <div className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setMode({ kind: "picker", deckId })}
            className="inline-flex items-center gap-2 rounded-md border border-gold/30 px-3 py-2 text-sm hover:bg-gold/10"
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
          <button
            type="button"
            onClick={() => setMode({ kind: "import", deckId })}
            className="inline-flex items-center gap-2 rounded-md border border-gold/30 px-3 py-2 text-sm hover:bg-gold/10"
            title="Open the bulk import workspace. Resumes saved progress if any."
          >
            <Upload className="h-4 w-4" />
            Import / replace from zip
          </button>
        </div>

        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {Array.from({ length: 78 }, (_, i) => {
            const photo = photographedMap.get(i);
            return (
              <button
                key={i}
                type="button"
                onClick={() => {
                  if (photo) {
                    setReviewingCardId(i);
                  } else {
                    setMode({ kind: "capture", deckId, cardId: i });
                  }
                }}
                className="group relative aspect-[2/3] overflow-hidden rounded border border-border/60 bg-cosmos"
                title={getCardName(i)}
              >
                <img
                  src={photo?.thumbnail_url ?? getCardImagePath(i)}
                  alt={getCardName(i)}
                  className={cn(
                    "h-full w-full object-cover",
                  )}
                  style={{ opacity: photo ? 1 : 0.3 }}
                  loading="lazy"
                />
                {photo && (
                  <span className="absolute right-1 top-1 rounded-full bg-gold/90 p-0.5 text-cosmos">
                    <Check className="h-3 w-3" />
                  </span>
                )}
                {!photo && (
                  <span className="pointer-events-none absolute inset-x-0 bottom-1 text-center text-[8px] uppercase tracking-wider text-white/70">
                    Tap to add
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {reviewingCardId !== null && (() => {
          const photo = photographedMap.get(reviewingCardId);
          if (!photo) return null;
          const cardId = reviewingCardId;
          return (
            <PerCardReviewModal
              userId={userId}
              deckId={deckId}
              cardId={cardId}
              photo={photo}
              shape={shape}
              cornerRadius={cornerRadius}
              onClose={() => setReviewingCardId(null)}
              onRetake={() => {
                setMode({ kind: "capture", deckId, cardId });
                setReviewingCardId(null);
              }}
              onChanged={async () => {
                await reloadCards(deckId);
                setReviewingCardId(null);
              }}
            />
          );
        })()}

        {resumePrompt && createPortal(
          <div
            className="fixed inset-0 z-[115] flex items-center justify-center p-6"
            style={{
              background:
                "var(--surface-overlay, color-mix(in oklab, var(--color-background) 80%, black))",
            }}
          >
            <div
              className="flex w-full max-w-sm flex-col gap-4 rounded-xl border"
              style={{
                background: "var(--surface-card)",
                borderColor: "var(--border-subtle)",
                color: "var(--color-foreground)",
                padding: "var(--space-5, 1.25rem)",
                borderRadius: "var(--radius-lg, 0.75rem)",
              }}
            >
              <h3
                className="italic"
                style={{
                  fontFamily: "var(--font-serif)",
                  fontSize: "var(--text-heading-sm)",
                  color: "var(--color-foreground)",
                }}
              >
                Resume your import?
              </h3>
              <p
                style={{
                  fontSize: "var(--text-body-sm)",
                  color: "var(--color-foreground)",
                }}
              >
                You have an in-progress import for this deck (
                {resumePrompt.assigned} assigned, {resumePrompt.unassigned}{" "}
                unassigned, {resumePrompt.skipped} skipped).
              </p>
              <p
                style={{
                  fontSize: "var(--text-caption)",
                  color: "var(--color-foreground)",
                  opacity: 0.6,
                  fontStyle: "italic",
                }}
              >
                Available on this device only
              </p>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setResumePrompt(null);
                    setMode({ kind: "import", deckId });
                  }}
                  className="rounded-md px-4 py-2 font-medium"
                  style={{
                    background: "var(--accent)",
                    color: "var(--accent-foreground, #000)",
                    fontSize: "var(--text-body-sm)",
                  }}
                >
                  Resume
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!existing) return;
                    await deleteSession(existing.id);
                    setResumePrompt(null);
                    toast("Import session discarded");
                  }}
                  className="rounded-md px-4 py-2"
                  style={{
                    color: "var(--color-foreground)",
                    fontSize: "var(--text-body-sm)",
                    background: "transparent",
                  }}
                >
                  Discard and start over
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
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
        shape={shape === "round" ? "round" : "rectangle"}
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
        shape={shape === "round" ? "round" : "rectangle"}
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

  // ---------- Step 3d: bulk zip import (Stamp BH) ----------
  if (mode.kind === "import") {
    const deckId = mode.deckId;
    return (
      <ZipImporter
        userId={userId}
        deckId={deckId}
        shape={shape === "round" ? "round" : "rectangle"}
        cornerRadiusPercent={cornerRadius}
        existingBackUrl={deckBackUrl}
        entryMode="import"
        initialPhase="upload"
        deckName={name}
        existingCornerRadiusPx={cornerRadiusPx}
        onCancel={() => onClose(true)}
        onDone={async () => {
          await reloadCards(deckId);
          onClose(true);
        }}
      />
    );
  }

  // ---------- CC G5: Unified deck-editor workspace ----------
  if (mode.kind === "workspace") {
    const deckId = mode.deckId;
    return (
      <ZipImporter
        userId={userId}
        deckId={deckId}
        shape={shape === "round" ? "round" : "rectangle"}
        cornerRadiusPercent={cornerRadius}
        existingBackUrl={deckBackUrl}
        entryMode="edit"
        initialPhase={mode.initialPhase}
        deckName={name}
        existingCornerRadiusPx={cornerRadiusPx}
        onCancel={async () => {
          await reloadCards(deckId);
          onClose(true);
        }}
        onDone={async () => {
          await reloadCards(deckId);
          onClose(true);
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
    toast.error(`Couldn't save card back: ${error.message}`);
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

/* ------------------------------------------------------------------ */
/*  Corner radius previews (BM Fix 4.3)                                */
/* ------------------------------------------------------------------ */

function CornerRadiusPreview({ cornerRadiusPercent }: { cornerRadiusPercent: number }) {
  const w = 160;
  const h = 240;
  const radiusPx = (cornerRadiusPercent / 100) * Math.min(w, h) / 2;
  return (
    <div className="mt-3 flex justify-center">
      <div
        className="overflow-hidden border"
        style={{
          width: w,
          height: h,
          borderRadius: radiusPx,
          borderColor: "var(--border-subtle)",
          background: "var(--surface-card)",
        }}
      >
        <img
          src={getCardImagePath(SAMPLE_PREVIEW_CARD_ID)}
          alt="Sample card preview"
          className="h-full w-full object-cover"
          style={{ borderRadius: radiusPx }}
          loading="lazy"
        />
      </div>
    </div>
  );
}

function RoundShapePreview() {
  const size = 180;
  return (
    <div className="mt-3 flex justify-center">
      <div
        className="overflow-hidden border"
        style={{
          width: size,
          height: size,
          borderRadius: "9999px",
          borderColor: "var(--border-subtle)",
          background: "var(--surface-card)",
        }}
      >
        <img
          src={getCardImagePath(SAMPLE_PREVIEW_CARD_ID)}
          alt="Round sample card preview"
          className="h-full w-full object-cover"
          loading="lazy"
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Per-card review modal (BM Fix 4.1)                                 */
/* ------------------------------------------------------------------ */

function PerCardReviewModal({
  userId,
  deckId,
  cardId,
  photo,
  shape,
  cornerRadius,
  onClose,
  onRetake,
  onChanged,
}: {
  userId: string;
  deckId: string;
  cardId: number;
  photo: CustomDeckCard;
  shape: CustomDeck["shape"];
  cornerRadius: number;
  onClose: () => void;
  onRetake: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const previewBorderRadius =
    shape === "round"
      ? "9999px"
      : `${(cornerRadius / 100) * 200}px`; // approximate visible rounding

  const handleReset = async () => {
    setBusy(true);
    try {
      const { error } = await supabase
        .from("custom_deck_cards")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", photo.id);
      if (error) throw error;
      toast("Reverted to default. Photo archived.");
      await onChanged();
    } catch (err) {
      toast.error(`Reset failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleReplaceFromFile = async (file: File) => {
    setBusy(true);
    try {
      const { encodeOne } = await import("@/lib/deck-image-pipeline");
      const key = `replace-${cardId}-${Date.now()}`;
      const asset = await encodeOne(key, file, {
        shape: shape === "round" ? "round" : "rectangle",
        cornerRadiusPercent: cornerRadius,
      });
      const ts = Date.now();
      const displayPath = `${userId}/${deckId}/card-${cardId}-${ts}.webp`;
      const thumbPath = `${userId}/${deckId}/card-${cardId}-${ts}-thumb.webp`;
      const { error: e1 } = await supabase.storage
        .from(DECK_BUCKET)
        .upload(displayPath, asset.displayBlob, { contentType: "image/webp", upsert: true });
      if (e1) throw e1;
      const { error: e2 } = await supabase.storage
        .from(DECK_BUCKET)
        .upload(thumbPath, asset.thumbnailBlob, { contentType: "image/webp", upsert: true });
      if (e2) throw e2;
      const yearSecs = 60 * 60 * 24 * 365;
      const [{ data: d1 }, { data: d2 }] = await Promise.all([
        supabase.storage.from(DECK_BUCKET).createSignedUrl(displayPath, yearSecs),
        supabase.storage.from(DECK_BUCKET).createSignedUrl(thumbPath, yearSecs),
      ]);
      // Archive old, insert new.
      await supabase
        .from("custom_deck_cards")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", photo.id);
      const { error: insErr } = await supabase.from("custom_deck_cards").insert({
        deck_id: deckId,
        user_id: userId,
        card_id: cardId,
        display_url: d1?.signedUrl ?? "",
        thumbnail_url: d2?.signedUrl ?? d1?.signedUrl ?? "",
        display_path: displayPath,
        thumbnail_path: thumbPath,
        source: "imported",
      });
      if (insErr) throw insErr;
      toast("Image replaced.");
      await onChanged();
    } catch (err) {
      toast.error(`Replace failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center p-6"
      style={{
        background:
          "var(--surface-overlay, color-mix(in oklab, var(--color-background) 80%, black))",
        zIndex: "var(--z-modal-nested)",
      }}
      onClick={busy ? undefined : onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-sm flex-col items-center gap-4 rounded-xl border"
        style={{
          background: "var(--surface-card)",
          borderColor: "var(--border-subtle)",
          color: "var(--color-foreground)",
          padding: "var(--space-5, 1.25rem)",
          borderRadius: "var(--radius-lg, 0.75rem)",
        }}
      >
        <h3
          className="italic"
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "var(--text-heading-sm)",
            color: "var(--color-foreground)",
          }}
        >
          {getCardName(cardId)}
        </h3>
        <img
          src={photo.display_url}
          alt={getCardName(cardId)}
          style={{
            maxHeight: "60vh",
            maxWidth: "100%",
            borderRadius: previewBorderRadius,
          }}
        />
        {!confirmReset ? (
          <div className="flex w-full flex-col gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onRetake}
              className="w-full rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
              style={{
                background: "var(--accent)",
                color: "var(--accent-foreground, #000)",
              }}
            >
              Retake
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
              className="w-full rounded-md border px-4 py-2 text-sm disabled:opacity-50"
              style={{
                borderColor: "var(--border-subtle)",
                color: "var(--color-foreground)",
              }}
            >
              Replace from file
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleReplaceFromFile(f);
                e.currentTarget.value = "";
              }}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmReset(true)}
              className="w-full px-4 py-2 text-sm italic underline disabled:opacity-50"
              style={{ color: "var(--color-foreground)", opacity: 0.7 }}
            >
              Reset to default
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="w-full px-4 py-2 text-sm disabled:opacity-50"
              style={{ color: "var(--color-foreground)", opacity: 0.7 }}
            >
              Done
            </button>
            {busy && (
              <p className="text-center text-xs text-muted-foreground">
                <Loader2 className="inline h-3 w-3 animate-spin" /> working…
              </p>
            )}
          </div>
        ) : (
          <div className="flex w-full flex-col gap-3">
            <p className="text-sm">
              Remove your custom image and use the default? Your photo will be
              archived and can be restored later.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmReset(false)}
                className="flex-1 rounded-md border px-4 py-2 text-sm disabled:opacity-50"
                style={{ borderColor: "var(--border-subtle)" }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleReset}
                className="flex-1 rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
                style={{
                  background: "var(--accent)",
                  color: "var(--accent-foreground, #000)",
                }}
              >
                {busy ? "Working…" : "Confirm reset"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}