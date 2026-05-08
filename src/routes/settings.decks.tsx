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
  MoreVertical,
  Pencil,
  Plus,
  Star,
  Trash2,
  X,
  Upload,
  Zap,
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
import { variantUrlFor } from "@/lib/active-deck";
import { PhotoCapture } from "@/components/photo/PhotoCapture";
import { CardPicker } from "@/components/cards/CardPicker";
import { getCardName, getCardImagePath } from "@/lib/tarot";
import { ZipImporter } from "@/components/deck-import/ZipImporter";
import { PerCardEditModal } from "@/components/deck-import/PerCardEditModal";
import { DeckOverviewScreen } from "@/components/deck-overview/DeckOverviewScreen";
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
          {/* 9-6-N — Rider-Waite default pseudo-row. Tapping it
              clears the active flag on all custom decks, restoring
              the default tarot deck. The 'active' badge appears here
              when no custom deck is is_active. */}
          <DefaultDeckRow
            anyActive={decks.some((d) => d.is_active)}
            onActivate={async () => {
              if (!user) return;
              await setActiveDeck(user.id, null);
              await Promise.all([load(), refreshActiveDeck()]);
            }}
          />
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

/**
 * 9-6-N — Default Rider-Waite pseudo-row. Lives at the top of the
 * My Decks list and represents the "no custom deck active" fallback.
 */
function DefaultDeckRow({
  anyActive,
  onActivate,
}: {
  anyActive: boolean;
  onActivate: () => void | Promise<void>;
}) {
  const isActive = !anyActive;
  return (
    <li className="flex flex-row items-center gap-3 rounded-lg border border-border/60 bg-card p-3">
      <button
        type="button"
        onClick={() => {
          if (anyActive) void onActivate();
        }}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        aria-label="Use default Rider-Waite deck"
      >
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/60 bg-cosmos">
          <Star className="h-5 w-5 opacity-60" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium sm:text-base">
              Rider-Waite (default)
            </p>
            {isActive && (
              <span className="inline-flex items-center gap-1 rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-gold">
                <Star className="h-3 w-3" /> Active
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground sm:text-xs">
            78 cards · classic tarot
          </p>
        </div>
      </button>
    </li>
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
  // 9-6-Q — track last failed cursor so user can resume optimize
  // from where it left off rather than restart at 0.
  const [lastFailedCursor, setLastFailedCursor] = useState<number | null>(null);
  // 9-6-L — mobile overflow menu for the deck row's actions.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDocDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [menuOpen]);
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

  const handleGenerateVariants = async (startCursor: number = 0) => {
    if (variantBusy) return;
    setVariantBusy(true);
    // FB-6 — loop chunked invocations until the function reports
    // nextCursor === null. Each call processes ~12 cards in well
    // under the Edge Function timeout. Progress is surfaced via a
    // single toast id that updates as chunks complete.
    const progressToastId = toast.loading("Optimizing deck images…");
    let cursor: number | null = startCursor;
    try {
      const { data: sess } = await supabase.auth.getSession();
      const jwt = sess.session?.access_token;
      if (!jwt) {
        toast.dismiss(progressToastId);
        toast.error("Sign in required.");
        return;
      }
      let totalGenerated = 0;
      let totalSkipped = 0;
      let totalFailed = 0;
      let totalCards = 0;
      // 9-6-Y — Pass 1: single-card invocations to (re)generate any
      // missing -full.webp masters. Each call gets fresh edge-function
      // memory, avoiding the 256MB cap that batch -full reconciliation
      // hit on high-DPI oracle scans.
      try {
        const { data: cardsList, error: listErr } = await supabase
          .from("custom_deck_cards")
          .select("id, card_id, display_path")
          .eq("deck_id", deck.id)
          .is("archived_at", null);
        if (listErr) throw listErr;
        const candidates = (cardsList ?? []).filter(
          (c) =>
            c.display_path &&
            !c.display_path.endsWith("-full.webp"),
        );
        if (candidates.length > 0) {
          let fullDone = 0;
          toast.loading(
            `Generating master images… 0/${candidates.length}`,
            { id: progressToastId },
          );
          for (const c of candidates) {
            const result = await supabase.functions.invoke(
              "generate-deck-variants",
              {
                body: { deckId: deck.id, cardId: c.card_id },
                headers: { Authorization: `Bearer ${jwt}` },
              },
            );
            if (result.error) {
              console.warn("[Optimize] single-card failed", {
                cardId: c.card_id,
                error: result.error,
              });
              totalFailed++;
            } else {
              totalGenerated++;
            }
            fullDone++;
            toast.loading(
              `Generating master images… ${fullDone}/${candidates.length}`,
              { id: progressToastId },
            );
          }
        }
      } catch (passErr) {
        console.warn("[Optimize] master-pass enumeration failed", passErr);
      }
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
          errors?: { card_id: number; reason: string }[];
        };
        if (Array.isArray(summary.errors) && summary.errors.length > 0) {
          console.error("[Optimize] per-card errors", summary.errors);
        }
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
      setLastFailedCursor(null);
    } catch (err) {
      toast.dismiss(progressToastId);
      console.error("[EZ-7] variant generation failed", {
        deckId: deck.id,
        cursor,
        error: err,
      });
      setLastFailedCursor(cursor as number);
      toast.error(
        err instanceof Error
          ? `Optimize failed at card ${cursor}: ${err.message}`
          : `Optimize failed at card ${cursor}.`,
      );
    } finally {
      setVariantBusy(false);
    }
  };

  return (
    <li className="flex flex-row items-center gap-3 rounded-lg border border-border/60 bg-card p-3">
      <button
        type="button"
        onClick={onEdit}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        aria-label={`Edit ${deck.name}`}
      >
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/60 bg-cosmos">
          {deck.card_back_thumb_url || deck.card_back_url ? (
            <img
              src={
                (variantUrlFor(
                  deck.card_back_thumb_url ?? deck.card_back_url,
                  "full",
                ) ?? (deck.card_back_thumb_url ?? deck.card_back_url)) as string
              }
              alt={`${deck.name} card back`}
              className="h-full w-full object-cover"
            />
          ) : (
            <Camera className="h-5 w-5 opacity-40" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium sm:text-base">{deck.name}</p>
            {deck.is_active && deck.deck_type !== "oracle" && (
              <span className="inline-flex items-center gap-1 rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-gold">
                <Star className="h-3 w-3" /> Active
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground sm:text-xs">
            {count === null
              ? "…"
              : deck.deck_type === "oracle"
                ? `${count} cards`
                : `${count}/78 customized`}{" "}
            · {deck.shape}
          </p>
        </div>
      </button>
      {/* 9-6-N — visible Edit pencil on mobile so the row's primary
          action is discoverable without opening the overflow menu. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
        className="rounded-md p-1.5 hover:bg-foreground/10 sm:hidden"
        aria-label={`Edit ${deck.name}`}
      >
        <Pencil className="h-4 w-4" />
      </button>
      {/* Mobile: compact overflow menu */}
      <div className="relative flex sm:hidden" ref={menuRef}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          className="rounded-md p-1.5 hover:bg-foreground/10"
          aria-label="Deck actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <MoreVertical className="h-4 w-4" />
        </button>
        {menuOpen && (
          <div
            role="menu"
            className="absolute right-0 top-full mt-1 flex min-w-[180px] flex-col rounded-md border p-1 shadow-lg"
            style={{
              background: "var(--surface-elevated, var(--background))",
              borderColor: "var(--border-subtle)",
              zIndex: "var(--z-popover, 50)" as unknown as number,
            }}
          >
            {deck.deck_type !== "oracle" && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  onToggleActive();
                }}
                className="rounded px-2 py-1.5 text-left text-sm hover:bg-foreground/10"
              >
                {deck.is_active ? "Deactivate" : "Set active"}
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                onImportZip();
              }}
              className="rounded px-2 py-1.5 text-left text-sm hover:bg-foreground/10"
            >
              Replace from zip
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                void handleGenerateVariants();
              }}
              disabled={variantBusy}
              className="rounded px-2 py-1.5 text-left text-sm hover:bg-foreground/10 disabled:opacity-50"
            >
              {variantBusy ? "Optimizing…" : "Optimize images"}
            </button>
            {lastFailedCursor !== null && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  void handleGenerateVariants(lastFailedCursor);
                }}
                disabled={variantBusy}
                className="rounded px-2 py-1.5 text-left text-sm hover:bg-foreground/10 disabled:opacity-50"
              >
                Resume optimize (from card {lastFailedCursor})
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                onDelete();
              }}
              className="rounded px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
            >
              Delete deck
            </button>
          </div>
        )}
      </div>
      {/* Desktop: original button group */}
      <div className="hidden flex-wrap items-center gap-2 sm:flex sm:flex-nowrap">
        {deck.deck_type !== "oracle" && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleActive(); }}
            className="rounded-md border border-gold/30 px-2 py-1 text-xs hover:bg-gold/10"
          >
            {deck.is_active ? "Deactivate" : "Set active"}
          </button>
        )}
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
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="rounded-md border border-destructive/40 p-1.5 text-destructive hover:bg-destructive/10"
          aria-label="Delete deck"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
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
  // 9-6-A — deck type chosen at creation time. Drives oracle-vs-tarot
  // import flow downstream (skip matcher, hide suit chips, etc.).
  const [deckType, setDeckType] = useState<"tarot" | "oracle">(
    existing?.deck_type ?? "tarot",
  );
  const [mode, setMode] = useState<EditorMode>(
    existing
      ? startInUploadPhase
        ? {
            kind: "workspace",
            deckId: existing.id,
            initialPhase: "upload",
          }
        : // 9-6-V — landing on the saved-cards grid for existing decks
          // matches user intent ("Edit" should show what's saved, not
          // re-open the import workspace with default ghosts).
          { kind: "grid", deckId: existing.id }
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
  // 9-6-W — tap a tile to open the per-card crop + radius editor.
  const [editingCardId, setEditingCardId] = useState<number | null>(null);
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
    const handleContinue = async () => {
      setSaving(true);
      try {
        const { data, error } = await supabase
          .from("custom_decks")
          .insert({
            user_id: userId,
            name: name.trim(),
            shape,
            corner_radius_percent: cornerRadius,
            deck_type: deckType,
          })
          .select("*")
          .single();
        if (error) throw error;
        setMode({ kind: "back-capture", deckId: (data as CustomDeck).id });
      } catch (err) {
        toast.error(`Couldn't create deck: ${(err as Error).message}`);
      } finally {
        setSaving(false);
      }
    };
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
          {/* 9-6-A — deck type selector. First choice in the form. */}
          <div>
            <span className="text-sm font-medium">Deck type</span>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(["tarot", "oracle"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setDeckType(t)}
                  className={cn(
                    "rounded-md border px-3 py-2 text-sm capitalize",
                    deckType === t
                      ? "border-gold bg-gold/10 text-gold"
                      : "border-border/60 text-muted-foreground hover:bg-gold/5",
                  )}
                >
                  {t === "tarot" ? "Tarot (78 cards)" : "Oracle / Other"}
                </button>
              ))}
            </div>
            {deckType === "oracle" && (
              <p
                className="mt-2 text-xs italic"
                style={{
                  color: "var(--color-foreground)",
                  opacity: 0.6,
                  fontFamily: "var(--font-serif)",
                }}
              >
                Any number of cards. You'll name each card after importing.
              </p>
            )}
          </div>

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

          {/* 9-6-C — corner radius moved to workspace (per-card or oracle slider). */}

          {shape === "round" && (
            <div className="text-center">
              <RoundShapePreview />
              <p className="mt-2 text-xs text-muted-foreground italic">
                Round decks always use a circular mask.
              </p>
            </div>
          )}

          {/* 9-6-O — desktop only; sticky version below is mobile only. */}
          <button
            type="button"
            disabled={saving || !name.trim()}
            onClick={handleContinue}
            className="hidden sm:inline-flex w-full items-center justify-center gap-2 rounded-md border border-gold/40 bg-gold/10 px-6 py-3 text-base font-medium hover:bg-gold/20 disabled:opacity-50"
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
                      deck_type: deckType,
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

          {/* 9-6-P — sticky Continue: anchored above bottom nav, smaller. */}
          <div
            className="sticky -mx-4 mt-6 border-t px-4 py-2 sm:hidden"
            style={{
              bottom: "calc(var(--bottom-nav-height) + env(safe-area-inset-bottom, 0px))",
              background: "var(--background)",
              borderColor: "var(--border-subtle)",
            }}
          >
            <button
              type="button"
              disabled={saving || !name.trim()}
              onClick={handleContinue}
              className="flex w-full items-center justify-center gap-2 rounded-md border border-gold/40 bg-gold/10 px-4 py-2 text-sm font-medium hover:bg-gold/20 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Continue → photograph cards
            </button>
          </div>
        </div>
      </section>
    );
  }

  // ---------- Step 2: card grid (overview + entry to picker) ----------
  if (mode.kind === "grid") {
    const deckId = mode.deckId;
    if (!existing) return null;
    return (
      <>
        <DeckOverviewScreen
          userId={userId}
          deckId={deckId}
          deck={{ ...existing, name, card_back_url: deckBackUrl } as CustomDeck}
          name={name}
          defaultRadiusPercent={cornerRadius}
          onNameChange={(next) => setName(next)}
          onClose={() => onClose(true)}
          onAction={(action) => {
            if (action.kind === "capture-card") {
              setMode({ kind: "capture", deckId, cardId: action.cardId });
            } else if (action.kind === "capture-back") {
              setMode({ kind: "back-capture", deckId });
            } else if (action.kind === "upload") {
              setMode({ kind: "import", deckId });
            }
          }}
        />
        {resumePrompt && createPortal(
          <ResumePromptModal
            assigned={resumePrompt.assigned}
            unassigned={resumePrompt.unassigned}
            skipped={resumePrompt.skipped}
            onResume={() => {
              setResumePrompt(null);
              setMode({ kind: "import", deckId });
            }}
            onDiscard={async () => {
              if (!existing) return;
              await deleteSession(existing.id);
              setResumePrompt(null);
              toast("Import session discarded");
            }}
          />,
          document.body,
        )}
      </>
    );
  }

  // legacy grid retained below for reference; replaced by DeckOverviewScreen above.
  // eslint-disable-next-line no-constant-condition
  if (false as boolean) {
    const deckId = (mode as { deckId: string }).deckId;
    const photographedMap = new Map<number, CustomDeckCard>(
      cards.map((c) => [c.card_id, c]),
    );
    return (
      <section className="py-6">
        {/* EH-4 — close affordance moved to global FloatingMenu */}
        <header className="mb-6">
          <h1 className="truncate text-2xl font-semibold">{name}</h1>
          <p className="text-sm text-muted-foreground">
          {deckType === "oracle"
            ? `${photographedIds.length} cards`
            : `${photographedIds.length}/78 cards customized`}
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
          {(() => {
            // 9-6-Z — generic grid: tarot shows 78 fixed positions; oracle/other
            // shows only saved cards plus an Add tile.
            const isTarot = deckType === "tarot";
            type Tile =
              | { kind: "existing"; cardId: number; photo: CustomDeckCard }
              | { kind: "empty-tarot"; cardId: number }
              | { kind: "add-new" };
            let tiles: Tile[];
            if (isTarot) {
              tiles = Array.from({ length: 78 }, (_, i) => {
                const photo = photographedMap.get(i);
                return photo
                  ? ({ kind: "existing", cardId: i, photo } as Tile)
                  : ({ kind: "empty-tarot", cardId: i } as Tile);
              });
            } else {
              const entries = [...photographedMap.entries()]
                .map(([cardId, photo]) => ({ cardId, photo }))
                .sort((a, b) => a.cardId - b.cardId);
              tiles = [
                ...entries.map(
                  ({ cardId, photo }) =>
                    ({ kind: "existing", cardId, photo } as Tile),
                ),
                { kind: "add-new" } as Tile,
              ];
            }
            const ORACLE_BASE = 1000;
            const nextOracleId = () => {
              const ids = [...photographedMap.keys()].filter(
                (id) => id >= ORACLE_BASE,
              );
              return ids.length === 0 ? ORACLE_BASE : Math.max(...ids) + 1;
            };
            return tiles.map((tile) => {
              if (tile.kind === "add-new") {
                return (
                  <button
                    key="add-new"
                    type="button"
                    onClick={() =>
                      setMode({
                        kind: "capture",
                        deckId,
                        cardId: nextOracleId(),
                      })
                    }
                    className="group relative flex aspect-[2/3] items-center justify-center overflow-hidden rounded border border-dashed border-border/60"
                  >
                    <Plus className="h-8 w-8 text-muted-foreground" />
                  </button>
                );
              }
              if (tile.kind === "empty-tarot") {
                const tileSrc = getCardImagePath(tile.cardId);
                return (
                  <button
                    key={tile.cardId}
                    type="button"
                    onClick={() =>
                      setMode({ kind: "capture", deckId, cardId: tile.cardId })
                    }
                    className="group relative aspect-[2/3] overflow-hidden rounded border border-border/60"
                    title={getCardName(tile.cardId)}
                  >
                    <img
                      src={tileSrc}
                      alt={getCardName(tile.cardId)}
                      className="h-full w-full object-contain"
                      style={{ opacity: 0.25 }}
                      loading="lazy"
                    />
                    <span className="pointer-events-none absolute inset-x-0 bottom-1 text-center text-[8px] uppercase tracking-wider text-white/70">
                      Tap to add
                    </span>
                  </button>
                );
              }
              const rawSrc =
                tile.photo.thumbnail_url ?? tile.photo.display_url ?? null;
              const tileSrc = rawSrc
                ? variantUrlFor(rawSrc, "md") ?? rawSrc
                : null;
              const label =
                tile.photo.card_name ??
                (tile.cardId < 1000
                  ? getCardName(tile.cardId)
                  : `Card ${tile.cardId}`);
              return (
                <button
                  key={tile.cardId}
                  type="button"
                  onClick={() => setEditingCardId(tile.cardId)}
                  className="group relative aspect-[2/3] overflow-hidden rounded border border-border/60"
                  title={label}
                >
                  {tileSrc && (
                    <img
                      src={tileSrc}
                      alt={label}
                      className="h-full w-full object-contain"
                      loading="lazy"
                    />
                  )}
                  <span className="absolute right-1 top-1 rounded-full bg-gold/90 p-0.5 text-cosmos">
                    <Check className="h-3 w-3" />
                  </span>
                </button>
              );
            });
          })()}
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

        {editingCardId !== null && (
          <PerCardEditModal
            deckId={deckId}
            deckName={name}
            defaultRadiusPercent={cornerRadius}
            initialCardId={editingCardId}
            onClose={async () => {
              setEditingCardId(null);
              await reloadCards(deckId);
            }}
          />
        )}

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
        deckType={deckType}
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
      <WorkspaceWithCornerEditor
        userId={userId}
        deckId={deckId}
        deckName={name}
        shape={shape === "round" ? "round" : "rectangle"}
        cornerRadiusPercent={cornerRadius}
        existingBackUrl={deckBackUrl}
        existingCornerRadiusPx={cornerRadiusPx}
        initialPhase={mode.initialPhase}
        deckType={existing?.deck_type ?? deckType}
        onClose={async () => {
          await reloadCards(deckId);
          onClose(true);
        }}
      />
    );
  }

  return null;
}

/* ------------------------------------------------------------------ */
/*  Workspace + per-card corner editor overlay (Phase 9-5-B Part 1)    */
/* ------------------------------------------------------------------ */

function WorkspaceWithCornerEditor({
  userId,
  deckId,
  deckName,
  shape,
  cornerRadiusPercent,
  existingBackUrl,
  existingCornerRadiusPx,
  initialPhase,
  deckType,
  onClose,
}: {
  userId: string;
  deckId: string;
  deckName: string;
  shape: "rectangle" | "round";
  cornerRadiusPercent: number;
  existingBackUrl: string | null;
  existingCornerRadiusPx: number | null;
  initialPhase?: "upload" | "workspace";
  deckType: "tarot" | "oracle";
  onClose: () => void | Promise<void>;
}) {
  // 9-5-D — liveRadius is owned here so both ZipImporter (preview)
  // and any per-card editor opened from inside it see the freshly
  // saved value without a page reload.
  const [liveRadius, setLiveRadius] = useState(cornerRadiusPercent);
  useEffect(() => { setLiveRadius(cornerRadiusPercent); }, [cornerRadiusPercent]);
  return (
    <ZipImporter
      userId={userId}
      deckId={deckId}
      shape={shape}
      cornerRadiusPercent={liveRadius}
      existingBackUrl={existingBackUrl}
      entryMode="edit"
      initialPhase={initialPhase}
      deckName={deckName}
      existingCornerRadiusPx={existingCornerRadiusPx}
      deckType={deckType}
      onRadiusSaved={(next) => setLiveRadius(next)}
      onCancel={onClose}
      onDone={onClose}
    />
  );
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
          className="h-full w-full object-contain"
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
          className="h-full w-full object-contain"
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