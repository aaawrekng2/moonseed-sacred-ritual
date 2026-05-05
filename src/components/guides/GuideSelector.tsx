/**
 * Guide Selector — appears between the home spread tap and the draw
 * screen. Lets the user pick the reader voice (Guide), the lens depth,
 * and up to two facets of emphasis. Last-used selections are
 * preselected so a returning user can just tap "Begin Reading".
 */
import { useEffect, useMemo, useState } from "react";
import { Check, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useOracleMode } from "@/lib/use-oracle-mode";
import { useActiveGuide } from "@/lib/use-active-guide";
import { usePremium } from "@/lib/premium";
import { useUIDensity } from "@/lib/use-ui-density";
import {
  BUILT_IN_GUIDES,
  DEFAULT_GUIDE_ID,
  FACETS,
  LENSES,
  MAX_ACTIVE_FACETS,
  type CustomGuide,
  type FacetId,
  type LensMode,
} from "@/lib/guides";
import { cn } from "@/lib/utils";
import { FullScreenSheet } from "@/components/ui/full-screen-sheet";
import { Modal } from "@/components/ui/modal";

const FREE_CUSTOM_SLOTS = 1;

export function GuideSelector({
  onContinue,
  onSkip,
  ctaLabel,
  isEmbedded = false,
}: {
  /** Called when the user taps Begin Reading. */
  onContinue: () => void;
  /** X in the header — close without changing anything. */
  onSkip: () => void;
  /** Override the default CTA label (e.g. "Read for me"). */
  ctaLabel?: string;
  /**
   * BQ Fix 2A — when true, hide the inner page header (title + X) and
   * render as a normal in-flow block, since the parent SettingsSection
   * already provides the title/back affordances.
   */
  isEmbedded?: boolean;
}) {
  const { user } = useAuth();
  const { isOracle } = useOracleMode();
  const premium = usePremium(user?.id);
  // The Clarity (Seen/Glimpse/Veiled) dims non-essential surface chrome
  // on this screen so the global tap-to-peek affordance has something
  // visible to flash back to full opacity. We bind opacity to the
  // CSS var that tap-to-peek writes (`--resting-opacity` via
  // `--ro-plus-N`) so a tap on empty space momentarily lifts the
  // dimmed surfaces back toward full visibility, exactly as on the
  // tabletop.
  const { level } = useUIDensity();
  const peekOpacity: string | number =
    level === 3
      ? "var(--ro-plus-10)"
      : level === 2
        ? "var(--ro-plus-40)"
        : 1;
  const {
    guideId,
    lensId,
    facetIds,
    setGuide,
    setLens,
    toggleFacet,
  } = useActiveGuide();

  const [customGuides, setCustomGuides] = useState<CustomGuide[]>([]);
  const [creating, setCreating] = useState(false);
  const [editingGuide, setEditingGuide] = useState<CustomGuide | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CustomGuide | null>(null);

  // Load custom guides for the carousel.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => {
          select: (q: string) => {
            eq: (
              col: string,
              val: string,
            ) => {
              order: (
                col: string,
                opts: { ascending: boolean },
              ) => Promise<{ data: CustomGuide[] | null; error: unknown }>;
            };
          };
        };
      })
        .from("custom_guides")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true });
      if (cancelled) return;
      if (error) {
        console.error("[GuideSelector] load custom guides failed", error);
        return;
      }
      setCustomGuides((data as CustomGuide[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const slotsRemaining = premium.isPremium
    ? Number.POSITIVE_INFINITY
    : Math.max(0, FREE_CUSTOM_SLOTS - customGuides.length);

  const allGuideCards = useMemo(
    () => [
      ...BUILT_IN_GUIDES.map((g) => ({
        id: g.id,
        name: g.name,
        tagline: g.tagline,
        emoji: g.accentEmoji,
        traits: g.voiceTraits,
        custom: false as const,
        raw: null as CustomGuide | null,
      })),
      ...customGuides.map((cg) => ({
        id: cg.id,
        name: cg.name,
        tagline:
          BUILT_IN_GUIDES.find((g) => g.id === cg.base_guide_id)?.tagline ??
          "Custom guide",
        emoji: "✦",
        traits:
          BUILT_IN_GUIDES.find((g) => g.id === cg.base_guide_id)?.voiceTraits ??
          [],
        custom: true as const,
        raw: cg,
      })),
    ],
    [customGuides],
  );

  const inner = (
    <main
      className={isEmbedded ? "flex flex-col" : "flex h-full flex-col"}
      style={
        isEmbedded
          ? undefined
          : {
              paddingTop: "calc(env(safe-area-inset-top, 0px) + 16px)",
              paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
            }
      }
    >
      {!isEmbedded && (
      <header
        className="flex items-start justify-between px-6 pb-4"
        style={{ opacity: peekOpacity, transition: "opacity 400ms ease" }}
      >
        <div>
          <h1
            className="text-xl italic text-gold"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            {isOracle ? "Who reads with you today?" : "Choose Your Guide"}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {isOracle
              ? "A voice, a lens, and the emphases that shape the reading."
              : "Select a reader, a depth, and any emphases."}
          </p>
        </div>
        <button
          type="button"
          aria-label="Skip guide selection"
          onClick={onSkip}
          className="ml-2 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gold/70 transition hover:text-gold"
        >
          <X className="h-5 w-5" strokeWidth={1.5} />
        </button>
      </header>
      )}

      <div className="flex-1 overflow-y-auto px-2">
        {/* Guide carousel */}
        <section className="mb-6">
          <div
            className="flex gap-3 overflow-x-auto px-4 py-2 scrollbar-none snap-x snap-mandatory"
            style={{ scrollPaddingLeft: 16 }}
          >
            {allGuideCards.map((g) => {
              const active = g.id === guideId;
              return (
                <div
                  key={g.id}
                  className={cn(
                    "snap-start shrink-0 rounded-2xl border p-4 text-left transition",
                    "w-[220px]",
                    active
                      ? "border-gold bg-gold/10 shadow-[0_0_24px_-8px_rgba(212,175,55,0.6)]"
                      : "border-border/50 bg-card/40 hover:border-gold/40",
                  )}
                  style={{
                    position: "relative",
                    zIndex: 0,
                    isolation: "isolate",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setGuide(g.id)}
                    className="block w-full text-left"
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <span className="text-2xl">{g.emoji}</span>
                      {g.custom && g.raw && (
                        <button
                          type="button"
                          aria-label="Delete custom guide"
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            setDeleteTarget(g.raw!);
                          }}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-gold/60 transition-colors hover:bg-gold/10 hover:text-gold"
                          style={{ opacity: "var(--ro-plus-30)" }}
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                        </button>
                      )}
                      {active && !g.custom && <Check className="h-4 w-4 text-gold" />}
                    </div>
                    <h3
                      className="text-base italic text-foreground"
                      style={{ fontFamily: "var(--font-serif)" }}
                    >
                      {g.name}
                    </h3>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {g.tagline}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1">
                      {g.traits.slice(0, 4).map((t) => (
                        <span
                          key={t}
                          className="text-[9px] uppercase tracking-wider"
                          style={{
                            color: "var(--gold)",
                            opacity: "var(--ro-plus-20)",
                          }}
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                    {g.custom && (
                      <span className="mt-3 inline-block text-[9px] uppercase tracking-wider text-gold/60">
                        {active ? "Custom · Active" : "Custom"}
                      </span>
                    )}
                  </button>
                  {/* Edit/delete affordances must sit ABOVE the card-body
                      button — render after it in DOM order, with explicit
                      inline z-index so nothing in the cascade hides them. */}
                  {/* Pencil stays absolute top-right; trash moved inline
                      next to the emoji above to free up vertical space. */}
                  {g.custom && g.raw && (
                    <button
                      type="button"
                      aria-label="Edit custom guide"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingGuide(g.raw!);
                      }}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full text-gold/60 transition-opacity hover:text-gold hover:bg-gold/10 hover:!opacity-100"
                      style={{
                        position: "absolute",
                        top: 8,
                        right: 8,
                        zIndex: 30,
                        opacity: "var(--ro-plus-30)",
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </button>
                  )}
                </div>
              );
            })}

            {/* Create custom slot */}
            <button
              type="button"
              onClick={() => {
                if (slotsRemaining <= 0) {
                  toast.message("You've used your custom guide slot", {
                    description:
                      "Premium unlocks more — coming soon.",
                  });
                  return;
                }
                setCreating(true);
              }}
              className="snap-start shrink-0 w-[160px] rounded-2xl border border-dashed border-gold/40 bg-card/20 p-4 text-center transition hover:border-gold hover:bg-gold/5"
            >
              <Plus className="mx-auto h-6 w-6 text-gold/70" strokeWidth={1.5} />
              <p
                className="mt-3 text-sm italic text-gold"
                style={{ fontFamily: "var(--font-serif)" }}
              >
                Create from Guide
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {slotsRemaining === Number.POSITIVE_INFINITY
                  ? "Unlimited"
                  : `${slotsRemaining} slot left`}
              </p>
            </button>
          </div>
        </section>

        {/* Lens selector */}
        <section
          className="mb-6 px-6"
          style={{ opacity: peekOpacity, transition: "opacity 400ms ease" }}
        >
          <h2 className="mb-2 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            {isOracle ? "Lens" : "Depth"}
          </h2>
          <div className="grid grid-cols-3 gap-2">
            {LENSES.map((lens) => {
              const active = lens.id === lensId;
              return (
                <button
                  key={lens.id}
                  type="button"
                  onClick={() => setLens(lens.id as LensMode)}
                  className={cn(
                    "breathing-text-toggle px-2 py-2.5 text-center text-[12px]",
                    active && "is-active",
                  )}
                  data-active={active ? "true" : "false"}
                >
                  <span
                    className="italic breathing-text-label"
                    style={{ fontFamily: "var(--font-serif)" }}
                  >
                    {isOracle ? lens.oracleName : lens.name}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {LENSES.find((l) => l.id === lensId)?.description}
          </p>
        </section>

        {/* Facets */}
        <section
          className="mb-6 px-6"
          style={{ opacity: peekOpacity, transition: "opacity 400ms ease" }}
        >
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              Add emphasis
            </h2>
            <span className="text-[10px] text-muted-foreground">
              max {MAX_ACTIVE_FACETS}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {FACETS.map((f) => {
              const active = facetIds.includes(f.id);
              const disabled = !active && facetIds.length >= MAX_ACTIVE_FACETS;
              return (
                <button
                  key={f.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => toggleFacet(f.id as FacetId)}
                  className={cn(
                    "breathing-text-toggle px-2 py-1.5 text-[12px]",
                    active && "is-active",
                    disabled && "opacity-40",
                  )}
                  data-active={active ? "true" : "false"}
                  title={f.description}
                >
                  <span
                    className="breathing-text-label"
                    style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}
                  >
                    {f.name}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </div>

      <footer className="border-t border-border/30 px-6 pt-4">
        <Button
          onClick={onContinue}
          className="w-full bg-gold text-cosmos hover:bg-gold/90"
        >
          {ctaLabel ?? (isOracle ? "Begin the Reading" : "Begin Reading")}
        </Button>
      </footer>

      {creating && (
        <CreateCustomGuideDialog
          onClose={() => setCreating(false)}
          onCreated={(g) => {
            setCustomGuides((prev) => [...prev, g]);
            setGuide(g.id);
            setCreating(false);
          }}
        />
      )}

      {editingGuide && (
        <EditCustomGuideDialog
          guide={editingGuide}
          onClose={() => setEditingGuide(null)}
          onSaved={(updated) => {
            setCustomGuides((prev) =>
              prev.map((cg) => (cg.id === updated.id ? updated : cg)),
            );
            setEditingGuide(null);
          }}
          onDeleteRequest={(g) => {
            setEditingGuide(null);
            setDeleteTarget(g);
          }}
        />
      )}

      {deleteTarget && (
        <DeleteGuideConfirm
          guide={deleteTarget}
          isOracle={isOracle}
          onCancel={() => setDeleteTarget(null)}
          onConfirmed={(id) => {
            setCustomGuides((prev) => prev.filter((cg) => cg.id !== id));
            // If the deleted guide was active, fall back to default.
            if (guideId === id) setGuide(DEFAULT_GUIDE_ID);
            setDeleteTarget(null);
          }}
        />
      )}
    </main>
  );

  if (isEmbedded) return inner;

  return (
    <FullScreenSheet open onClose={onSkip} entry="fade" showCloseButton={false}>
      {inner}
    </FullScreenSheet>
  );
}

/* -------------------------------------------------------------------- */
/*  Create Custom Guide                                                  */
/* -------------------------------------------------------------------- */

function CreateCustomGuideDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (g: CustomGuide) => void;
}) {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [baseId, setBaseId] = useState<string>(BUILT_IN_GUIDES[0].id);
  const [voiceNotes, setVoiceNotes] = useState("");
  const [defaultFacets, setDefaultFacets] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const toggleFacet = (id: string) =>
    setDefaultFacets((prev) =>
      prev.includes(id)
        ? prev.filter((f) => f !== id)
        : [...prev, id].slice(0, MAX_ACTIVE_FACETS),
    );

  const save = async () => {
    if (!user) return;
    if (!name.trim()) {
      toast.error("Name your guide");
      return;
    }
    setSaving(true);
    const { data, error } = await (supabase as unknown as {
      from: (t: string) => {
        insert: (row: Record<string, unknown>) => {
          select: (q: string) => {
            single: () => Promise<{ data: CustomGuide | null; error: unknown }>;
          };
        };
      };
    })
      .from("custom_guides")
      .insert({
        user_id: user.id,
        name: name.trim().slice(0, 40),
        base_guide_id: baseId,
        voice_overrides: voiceNotes.trim()
          ? { notes: voiceNotes.trim().slice(0, 200) }
          : {},
        facets: defaultFacets,
      })
      .select("*")
      .single();
    setSaving(false);
    if (error || !data) {
      console.error("[CreateCustomGuide] insert failed", error);
      toast.error("Couldn't save your guide");
      return;
    }
    onCreated(data as CustomGuide);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Create custom guide"
      className="modal-scrim fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex: "var(--z-modal)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-gold/30 bg-cosmos p-5 shadow-2xl"
        style={{ maxHeight: "90vh", overflowY: "auto" }}
      >
        <div className="mb-4 flex items-start justify-between">
          <h3
            className="text-lg italic text-gold"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Forge a Custom Guide
          </h3>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="text-gold/60 hover:text-gold"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <Label className="text-xs text-muted-foreground">Base guide</Label>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {BUILT_IN_GUIDES.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setBaseId(g.id)}
                  className={cn(
                    "rounded-lg border px-2 py-2 text-left text-[11px] transition",
                    baseId === g.id
                      ? "border-gold bg-gold/10"
                      : "border-border/40 hover:border-gold/40",
                  )}
                >
                  <div className="text-base">{g.accentEmoji}</div>
                  <div className="italic" style={{ fontFamily: "var(--font-serif)" }}>
                    {g.name}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label htmlFor="guide-name" className="text-xs text-muted-foreground">
              Name (max 40)
            </Label>
            <Input
              id="guide-name"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 40))}
              placeholder="e.g. The Hearth Keeper"
              maxLength={40}
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="guide-voice" className="text-xs text-muted-foreground">
              Voice notes (optional, max 200)
            </Label>
            <Textarea
              id="guide-voice"
              value={voiceNotes}
              onChange={(e) => setVoiceNotes(e.target.value.slice(0, 200))}
              placeholder="Tone, vocabulary, anything you want this guide to honour."
              maxLength={200}
              className="mt-1 min-h-[72px]"
            />
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">
              Default facets
            </Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {FACETS.map((f) => {
                const active = defaultFacets.includes(f.id);
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => toggleFacet(f.id)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-[11px] transition",
                      active
                        ? "border-gold bg-gold/15 text-gold"
                        : "border-border/40 text-muted-foreground hover:border-gold/40",
                    )}
                  >
                    {f.name}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => void save()}
            disabled={saving || !name.trim()}
            className="bg-gold text-cosmos hover:bg-gold/90"
          >
            {saving ? "Saving…" : "Save Guide"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/*  Edit Custom Guide                                                    */
/* -------------------------------------------------------------------- */

function EditCustomGuideDialog({
  guide,
  onClose,
  onSaved,
  onDeleteRequest,
}: {
  guide: CustomGuide;
  onClose: () => void;
  onSaved: (g: CustomGuide) => void;
  onDeleteRequest: (g: CustomGuide) => void;
}) {
  const { user } = useAuth();
  const { isOracle } = useOracleMode();
  const [name, setName] = useState(guide.name);
  const [baseId, setBaseId] = useState<string>(guide.base_guide_id);
  const [voiceNotes, setVoiceNotes] = useState<string>(
    typeof (guide.voice_overrides as Record<string, unknown>)?.notes === "string"
      ? ((guide.voice_overrides as Record<string, unknown>).notes as string)
      : "",
  );
  const [defaultFacets, setDefaultFacets] = useState<string[]>(guide.facets ?? []);
  const [saving, setSaving] = useState(false);
  const [confirmRealign, setConfirmRealign] = useState(false);

  const toggleFacet = (id: string) =>
    setDefaultFacets((prev) =>
      prev.includes(id)
        ? prev.filter((f) => f !== id)
        : [...prev, id].slice(0, MAX_ACTIVE_FACETS),
    );

  const realign = () => {
    // Reset name to base guide's name and clear customisations.
    const base = BUILT_IN_GUIDES.find((g) => g.id === baseId) ?? BUILT_IN_GUIDES[0];
    setName(base.name);
    setVoiceNotes("");
    setDefaultFacets([]);
    setConfirmRealign(false);
    toast.success(
      isOracle
        ? "Guide returned to its original alignment."
        : "Guide reset to base defaults.",
    );
  };

  const save = async () => {
    if (!user) return;
    if (!name.trim()) {
      toast.error("Name your guide");
      return;
    }
    setSaving(true);
    const { data, error } = await (supabase as unknown as {
      from: (t: string) => {
        update: (row: Record<string, unknown>) => {
          eq: (
            col: string,
            val: string,
          ) => {
            select: (q: string) => {
              single: () => Promise<{
                data: CustomGuide | null;
                error: unknown;
              }>;
            };
          };
        };
      };
    })
      .from("custom_guides")
      .update({
        name: name.trim().slice(0, 40),
        base_guide_id: baseId,
        voice_overrides: voiceNotes.trim()
          ? { notes: voiceNotes.trim().slice(0, 200) }
          : {},
        facets: defaultFacets,
      })
      .eq("id", guide.id)
      .select("*")
      .single();
    setSaving(false);
    if (error || !data) {
      console.error("[EditCustomGuide] update failed", error);
      toast.error("Couldn't save your changes");
      return;
    }
    onSaved(data as CustomGuide);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit custom guide"
      className="modal-scrim fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex: "var(--z-modal)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-gold/30 bg-cosmos p-5 shadow-2xl"
        style={{ maxHeight: "90vh", overflowY: "auto" }}
      >
        {/* No on-screen X — the Close affordance lives in the global
            FloatingMenu pill (the `···`). Backdrop tap and ESC also
            dismiss this dialog (handled by the wrapper). */}
        <div className="mb-4 flex items-start justify-between">
          <h3
            className="text-lg italic text-gold"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            {isOracle ? "Refine this Guide" : "Edit Guide"}
          </h3>
        </div>

        <div className="space-y-4">
          <div>
            <Label className="text-xs text-muted-foreground">Base guide</Label>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {BUILT_IN_GUIDES.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setBaseId(g.id)}
                  className={cn(
                    "rounded-lg border px-2 py-2 text-left text-[11px] transition",
                    baseId === g.id
                      ? "border-gold bg-gold/10"
                      : "border-border/40 hover:border-gold/40",
                  )}
                >
                  <div className="text-base">{g.accentEmoji}</div>
                  <div className="italic" style={{ fontFamily: "var(--font-serif)" }}>
                    {g.name}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label htmlFor="edit-guide-name" className="text-xs text-muted-foreground">
              Name (max 40)
            </Label>
            <Input
              id="edit-guide-name"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 40))}
              maxLength={40}
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="edit-guide-voice" className="text-xs text-muted-foreground">
              Voice notes (optional, max 200)
            </Label>
            <Textarea
              id="edit-guide-voice"
              value={voiceNotes}
              onChange={(e) => setVoiceNotes(e.target.value.slice(0, 200))}
              maxLength={200}
              className="mt-1 min-h-[72px]"
            />
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Default facets</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {FACETS.map((f) => {
                const active = defaultFacets.includes(f.id);
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => toggleFacet(f.id)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-[11px] transition",
                      active
                        ? "border-gold bg-gold/15 text-gold"
                        : "border-border/40 text-muted-foreground hover:border-gold/40",
                    )}
                  >
                    {f.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Realign */}
          <div className="rounded-xl border border-border/40 p-3">
            <p className="text-[11px] text-muted-foreground">
              {isOracle
                ? "Return this Guide to its original alignment."
                : "Reset all fields to the base guide's defaults."}
            </p>
            {!confirmRealign ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setConfirmRealign(true)}
                className="mt-2 h-8 px-2 text-[11px] text-gold/80 hover:text-gold"
              >
                <RotateCcw className="mr-1 h-3.5 w-3.5" /> Realign
              </Button>
            ) : (
              <div className="mt-2 space-y-2">
                <p className="text-[11px] text-foreground">
                  This will reset your customisations. Continue?
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => setConfirmRealign(false)}
                    className="h-8 px-3 text-[11px]"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={realign}
                    className="h-8 bg-gold px-3 text-[11px] text-cosmos hover:bg-gold/90"
                  >
                    Realign
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            onClick={() => onDeleteRequest(guide)}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="mr-1 h-4 w-4" /> Delete
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={() => void save()}
              disabled={saving || !name.trim()}
              className="bg-gold text-cosmos hover:bg-gold/90"
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/*  Delete Custom Guide confirmation                                     */
/* -------------------------------------------------------------------- */

function DeleteGuideConfirm({
  guide,
  isOracle,
  onCancel,
  onConfirmed,
}: {
  guide: CustomGuide;
  isOracle: boolean;
  onCancel: () => void;
  onConfirmed: (id: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);

  const confirm = async () => {
    setDeleting(true);
    const { error } = await (supabase as unknown as {
      from: (t: string) => {
        delete: () => {
          eq: (col: string, val: string) => Promise<{ error: unknown }>;
        };
      };
    })
      .from("custom_guides")
      .delete()
      .eq("id", guide.id);
    setDeleting(false);
    if (error) {
      console.error("[DeleteGuide] delete failed", error);
      toast.error("Couldn't delete this guide");
      return;
    }
    onConfirmed(guide.id);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Confirm delete guide"
      className="modal-scrim fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex: "var(--z-modal-nested)" }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border border-gold/30 bg-cosmos p-5 shadow-2xl"
      >
        <h3
          className="text-base italic text-gold"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          {isOracle ? "Release this Guide?" : "Delete this Guide?"}
        </h3>
        <p className="mt-2 text-[12px] text-muted-foreground">
          This cannot be undone. Your custom guide will be permanently removed.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={deleting}>
            Cancel
          </Button>
          <Button
            onClick={() => void confirm()}
            disabled={deleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </div>
    </div>
  );
}