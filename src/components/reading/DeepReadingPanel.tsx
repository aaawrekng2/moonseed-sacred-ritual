/**
 * Phase 8 — Deep Reading panel.
 *
 * Sits below the standard interpretation + enrichment. Owns the mist
 * doorway, the limit overlay, the four sequential lens reveals, and
 * the mirror-artifact save action.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  computeMistIntensity,
  dawnCycleDateLocal,
  getNextDawn,
  type MistState,
} from "@/lib/deep-reading";
import {
  interpretDeepReading,
  setMirrorSaved,
  type DeepLenses,
  type DeepReadingResult,
} from "@/lib/deep-reading.functions";
import { DeepReadingMist } from "./DeepReadingMist";
import { stripMarkdown } from "@/lib/strip-markdown";
import { Share2 } from "lucide-react";
import { ShareBuilder, type ShareBuilderExtras } from "@/components/share/ShareBuilder";
import type { ShareContext, ShareLevel } from "@/components/share/share-types";
import type { DeepLensSelection } from "@/components/share/levels/Level4DeepLens";
import { isValidSpreadMode, SPREAD_META, type SpreadMode } from "@/lib/spreads";
import { getGuideById } from "@/lib/guides";
import { HelpIcon } from "@/components/help/HelpIcon";
import { publishMistLevel } from "@/components/dev/DevOverlay";

type Props = {
  readingId: string;
  guideId?: string;
  lensId?: string;
  facetIds?: string[];
  /** Optional initial state for re-opens from journal. */
  initialLenses?: DeepLenses | null;
  initialMirrorSaved?: boolean;
};

type FlowState =
  | { kind: "mist" }
  | { kind: "loading" }
  | { kind: "limit"; nextDawn: string }
  | { kind: "lenses"; lenses: DeepLenses; revealed: number }
  | { kind: "error"; message: string };

const LENS_LABELS = [
  "Present Resonance",
  "Thread Awareness",
  "Shadow Layer",
  "Mirror Artifact",
] as const;

export function DeepReadingPanel({
  readingId,
  guideId,
  lensId,
  facetIds,
  initialLenses,
  initialMirrorSaved,
}: Props) {
  const { user } = useAuth();
  const [mist, setMist] = useState<MistState>({
    level: 0,
    whisper: "The cards are listening.",
    patternDetected: false,
    patternTeaser: "",
  });
  const [flow, setFlow] = useState<FlowState>(
    initialLenses
      ? { kind: "lenses", lenses: initialLenses, revealed: 4 }
      : { kind: "mist" },
  );
  const [mirrorSaved, setMirrorSavedState] = useState(
    !!initialMirrorSaved,
  );

  // --- Share builder state (Levels 4 + 5 from a Deep Reading) ---
  // We lazy-load the reading row + per-lens context the first time the
  // user opens the share sheet so the panel stays cheap when nobody
  // shares anything. The fetched picks/spread/guide are reused across
  // subsequent shares within the same panel mount.
  const [shareOpen, setShareOpen] = useState(false);
  const [shareLevel, setShareLevel] = useState<ShareLevel>("lens");
  const [shareLens, setShareLens] = useState<DeepLensSelection | null>(null);
  const [shareCtx, setShareCtx] = useState<ShareContext | null>(null);
  const [shareLoading, setShareLoading] = useState(false);

  /**
   * Fetch (or reuse) the reading row needed to populate the share
   * card with cards + spread + guide name. Returns a synthesized
   * ShareContext suitable for the builder. Errors are swallowed —
   * a failed fetch just leaves the share button unresponsive instead
   * of poisoning the lens UI.
   */
  const ensureShareContext = async (): Promise<ShareContext | null> => {
    if (shareCtx) return shareCtx;
    setShareLoading(true);
    try {
      const { data, error } = await supabase
        .from("readings")
        .select("spread_type, card_ids, card_orientations, question, guide_id, deck_id")
        .eq("id", readingId)
        .maybeSingle();
      if (error || !data) return null;
      const spread: SpreadMode = isValidSpreadMode(data.spread_type)
        ? data.spread_type
        : "single";
      const cardIds = (data.card_ids ?? []) as number[];
      const orientations = (data.card_orientations ?? []) as boolean[];
      const picks = cardIds.map((cardIndex, i) => ({
        id: i,
        cardIndex,
        isReversed: orientations[i] ?? false,
      }));
      const positionLabels = SPREAD_META[spread].positions ?? picks.map((_, i) => `Card ${i + 1}`);
      const ctx: ShareContext = {
        question: data.question ?? undefined,
        spread,
        picks,
        positionLabels,
        interpretation: { overview: "", positions: [], closing: "" },
        guideName: getGuideById(data.guide_id ?? guideId).name,
        isOracle: false,
        deckId: (data as { deck_id?: string | null }).deck_id ?? null,
      };
      setShareCtx(ctx);
      return ctx;
    } catch (e) {
      console.warn("[DeepReadingPanel] share context fetch failed", e);
      return null;
    } finally {
      setShareLoading(false);
    }
  };

  const openShareForLens = async (label: string, body: string) => {
    const ctx = await ensureShareContext();
    if (!ctx) return;
    setShareLens({ label, body: stripMarkdown(body) });
    setShareLevel("lens");
    setShareOpen(true);
  };
  const openShareForMirror = async (body: string) => {
    const ctx = await ensureShareContext();
    if (!ctx) return;
    // Re-use the lens slot too so users can switch to Lens view and
    // see the mirror text styled as a lens if they want — the builder
    // auto-prunes if the body is empty.
    setShareLens({ label: "Mirror Artifact", body: stripMarkdown(body) });
    setShareLevel("artifact");
    setShareOpen(true);
  };

  // Compute mist intensity from the user's last 30 readings.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      const { data: rows } = await supabase
        .from("readings")
        .select("card_ids")
        .eq("user_id", user.id)
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(30);
      if (cancelled) return;
      const next = computeMistIntensity(
        (rows ?? []) as Array<{ card_ids: number[] | null }>,
      );
      setMist(next);
      publishMistLevel(next.level);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Sequentially reveal lenses 1..4 with a small gap so each can breathe.
  useEffect(() => {
    if (flow.kind !== "lenses") return;
    if (flow.revealed >= 4) return;
    // Skip thread_awareness if it came back null.
    const next = flow.revealed + 1;
    const isThreadStep = next === 2;
    if (isThreadStep && flow.lenses.thread_awareness === null) {
      setFlow({ ...flow, revealed: next });
      return;
    }
    const t = window.setTimeout(() => {
      setFlow((prev) =>
        prev.kind === "lenses" ? { ...prev, revealed: next } : prev,
      );
    }, 1400);
    return () => window.clearTimeout(t);
  }, [flow]);

  const handleMistTap = async () => {
    setFlow({ kind: "loading" });
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        setFlow({
          kind: "error",
          message: "You need to be signed in for a Deep Reading.",
        });
        return;
      }
      const result = (await interpretDeepReading({
        data: {
          reading_id: readingId,
          dawn_cycle_date: dawnCycleDateLocal(),
          guideId,
          lensId,
          facetIds,
        },
        headers: { Authorization: `Bearer ${token}` },
      })) as DeepReadingResult;
      if (result.ok) {
        setFlow({ kind: "lenses", lenses: result.lenses, revealed: 1 });
      } else if (result.reason === "limit_reached") {
        setFlow({ kind: "limit", nextDawn: getNextDawn().iso });
      } else {
        setFlow({ kind: "error", message: result.message });
      }
    } catch (e) {
      console.error("[DeepReadingPanel] interpret threw", e);
      setFlow({
        kind: "error",
        message: "The deep reader could not be reached.",
      });
    }
  };

  const handleSaveMirror = async () => {
    const next = !mirrorSaved;
    setMirrorSavedState(next);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        setMirrorSavedState(!next);
        return;
      }
      await setMirrorSaved({
        data: { reading_id: readingId, saved: next },
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (e) {
      console.warn("[DeepReadingPanel] save mirror failed", e);
      setMirrorSavedState(!next);
    }
  };

  const dawnLabel = useMemo(() => {
    if (flow.kind !== "limit") return "";
    const d = new Date(flow.nextDawn);
    return d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }, [flow]);

  if (flow.kind === "mist") {
    return (
      <DeepReadingMist
        level={mist.level}
        whisper={mist.whisper}
        onTap={handleMistTap}
      />
    );
  }

  if (flow.kind === "loading") {
    return (
      <DeepReadingMist
        level={mist.level}
        whisper="The deep layer stirs…"
        onTap={() => {}}
        disabled
        loading
      />
    );
  }

  if (flow.kind === "limit") {
    return (
      <>
        <DeepReadingMist
          level={mist.level}
          whisper={mist.whisper}
          onTap={() => {}}
          disabled
        />
        <div className="deep-limit">
          <p className="deep-limit__line">
            {mist.patternTeaser ||
              "The cards are listening. Keep drawing and the deeper patterns will begin to speak."}
          </p>
          <p className="deep-limit__dawn">
            The dawn of your new day is at {dawnLabel}. Return for renewal.
          </p>
          <button
            type="button"
            className="deep-limit__upgrade"
            onClick={() => {
              window.dispatchEvent(new CustomEvent("moonseed:open-premium"));
            }}
          >
            Or continue without waiting.
          </button>
        </div>
      </>
    );
  }

  if (flow.kind === "error") {
    return (
      <div className="deep-limit">
        <p className="deep-limit__line">{flow.message}</p>
        <button
          type="button"
          className="deep-limit__upgrade"
          onClick={() => setFlow({ kind: "mist" })}
        >
          Try again
        </button>
      </div>
    );
  }

  // flow.kind === "lenses"
  const { lenses, revealed } = flow;
  return (
    <div className="w-full">
      {revealed >= 1 && (
        <Lens
          label={LENS_LABELS[0]}
          body={lenses.present_resonance}
          shareDisabled={shareLoading}
          onShare={() => void openShareForLens(LENS_LABELS[0], lenses.present_resonance)}
        />
      )}
      {revealed >= 2 && lenses.thread_awareness && (
        <Lens
          label={LENS_LABELS[1]}
          body={lenses.thread_awareness}
          shareDisabled={shareLoading}
          onShare={() => void openShareForLens(LENS_LABELS[1], lenses.thread_awareness ?? "")}
        />
      )}
      {revealed >= 3 && (
        <Lens
          label={LENS_LABELS[2]}
          body={lenses.shadow_layer}
          shareDisabled={shareLoading}
          onShare={() => void openShareForLens(LENS_LABELS[2], lenses.shadow_layer)}
        />
      )}
      {revealed < 4 && (
        <div className="deep-lens__loading">Reading…</div>
      )}
      {revealed >= 4 && (
        <div className="deep-mirror" data-saved={mirrorSaved ? "true" : undefined}>
          <p className="deep-mirror__label">
            Mirror Artifact
            <HelpIcon articleId="four-lenses" />
          </p>
          <p className="deep-mirror__body">
            {stripMarkdown(lenses.mirror_artifact)}
          </p>
          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              className="deep-mirror__action"
              onClick={handleSaveMirror}
            >
              {mirrorSaved ? "Saved to journal" : "Save to journal"}
            </button>
            <ShareIconButton
              ariaLabel="Share mirror artifact"
              disabled={shareLoading}
              onClick={() => void openShareForMirror(lenses.mirror_artifact)}
            />
          </div>
        </div>
      )}
      {shareCtx && (
        <ShareBuilder
          open={shareOpen}
          onOpenChange={setShareOpen}
          context={shareCtx}
          defaultLevel={shareLevel}
          availableLevels={["lens", "artifact", "reading", "pull"]}
          extras={
            {
              lens: shareLens ?? undefined,
              artifactText: shareLevel === "artifact"
                ? stripMarkdown(
                    flow.kind === "lenses" ? flow.lenses.mirror_artifact : "",
                  )
                : undefined,
            } satisfies ShareBuilderExtras
          }
        />
      )}
    </div>
  );
}

function Lens({
  label,
  body,
  onShare,
  shareDisabled,
}: {
  label: string;
  body: string;
  onShare: () => void;
  shareDisabled: boolean;
}) {
  const clean = stripMarkdown(body);
  return (
    <section className="deep-lens">
      <div className="deep-lens__label">
        {label}
        <HelpIcon articleId="four-lenses" />
      </div>
      <div className="deep-lens__divider" aria-hidden />
      <div className="deep-lens__body">{clean}</div>
      <div className="mt-2 flex justify-end">
        <ShareIconButton
          ariaLabel={`Share ${label}`}
          disabled={shareDisabled}
          onClick={onShare}
        />
      </div>
    </section>
  );
}

/**
 * Tiny ghost-icon trigger matching the rest of the app's share affordance.
 * Opens the new ShareBuilder via its onClick — no text fallback any more.
 */
function ShareIconButton({
  ariaLabel,
  onClick,
  disabled,
}: {
  ariaLabel: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className="inline-flex items-center justify-center rounded-full p-1.5 text-gold transition-opacity hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 disabled:opacity-40"
      style={{ opacity: "var(--ro-plus-20)" }}
      title="Share"
    >
      <Share2 size={18} strokeWidth={1.5} aria-hidden />
    </button>
  );
}