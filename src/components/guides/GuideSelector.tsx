/**
 * Guide Selector — appears between the home spread tap and the draw
 * screen. Lets the user pick the reader voice (Guide), the lens depth,
 * and up to two facets of emphasis. Last-used selections are
 * preselected so a returning user can just tap "Begin Reading".
 */
import { useEffect, useMemo, useState } from "react";
import { Check, Plus, X } from "lucide-react";
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
import {
  BUILT_IN_GUIDES,
  FACETS,
  LENSES,
  MAX_ACTIVE_FACETS,
  type CustomGuide,
  type FacetId,
  type LensMode,
} from "@/lib/guides";
import { cn } from "@/lib/utils";

const FREE_CUSTOM_SLOTS = 1;

export function GuideSelector({
  onContinue,
  onSkip,
}: {
  /** Called when the user taps Begin Reading. */
  onContinue: () => void;
  /** X in the header — close without changing anything. */
  onSkip: () => void;
}) {
  const { user } = useAuth();
  const { isOracle } = useOracleMode();
  const premium = usePremium(user?.id);
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
      })),
    ],
    [customGuides],
  );

  return (
    <main
      className="fixed inset-0 z-50 flex flex-col bg-cosmos"
      style={{
        paddingTop: "calc(env(safe-area-inset-top, 0px) + 16px)",
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
      }}
    >
      <header className="flex items-start justify-between px-6 pb-4">
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
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setGuide(g.id)}
                  className={cn(
                    "snap-start shrink-0 rounded-2xl border p-4 text-left transition",
                    "w-[220px]",
                    active
                      ? "border-gold bg-gold/10 shadow-[0_0_24px_-8px_rgba(212,175,55,0.6)]"
                      : "border-border/50 bg-card/40 hover:border-gold/40",
                  )}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-2xl">{g.emoji}</span>
                    {active && <Check className="h-4 w-4 text-gold" />}
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
                        className="rounded-full border border-gold/25 px-2 py-0.5 text-[9px] uppercase tracking-wider text-gold/80"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                  {g.custom && (
                    <span className="mt-3 inline-block text-[9px] uppercase tracking-wider text-gold/60">
                      Custom
                    </span>
                  )}
                </button>
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
        <section className="mb-6 px-6">
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
                    "rounded-xl border px-2 py-2.5 text-center text-[11px] transition",
                    active
                      ? "border-gold bg-gold/10 text-gold"
                      : "border-border/40 text-muted-foreground hover:border-gold/40",
                  )}
                >
                  <div
                    className="italic"
                    style={{ fontFamily: "var(--font-serif)" }}
                  >
                    {isOracle ? lens.oracleName : lens.name}
                  </div>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {LENSES.find((l) => l.id === lensId)?.description}
          </p>
        </section>

        {/* Facets */}
        <section className="mb-6 px-6">
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
                    "rounded-full border px-3 py-1.5 text-[11px] transition",
                    active
                      ? "border-gold bg-gold/15 text-gold"
                      : "border-border/40 text-muted-foreground hover:border-gold/40",
                    disabled && "opacity-40",
                  )}
                  title={f.description}
                >
                  {f.name}
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
          {isOracle ? "Begin the Reading" : "Begin Reading"}
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
    </main>
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
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
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