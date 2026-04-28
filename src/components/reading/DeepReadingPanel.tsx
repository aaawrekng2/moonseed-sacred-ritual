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

  // Compute mist intensity from the user's last 30 readings.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      const { data: rows } = await supabase
        .from("readings")
        .select("card_ids")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(30);
      if (cancelled) return;
      setMist(
        computeMistIntensity(
          (rows ?? []) as Array<{ card_ids: number[] | null }>,
        ),
      );
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
      <>
        <DeepReadingMist
          level={mist.level}
          whisper={mist.whisper}
          onTap={() => {}}
          disabled
        />
        <div className="deep-lens__loading">Reading…</div>
      </>
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
        <Lens label={LENS_LABELS[0]} body={lenses.present_resonance} />
      )}
      {revealed >= 2 && lenses.thread_awareness && (
        <Lens label={LENS_LABELS[1]} body={lenses.thread_awareness} />
      )}
      {revealed >= 3 && (
        <Lens label={LENS_LABELS[2]} body={lenses.shadow_layer} />
      )}
      {revealed < 4 && (
        <div className="deep-lens__loading">Reading…</div>
      )}
      {revealed >= 4 && (
        <div className="deep-mirror" data-saved={mirrorSaved ? "true" : undefined}>
          <p className="deep-mirror__label">Mirror Artifact</p>
          <p className="deep-mirror__body">
            {stripMarkdown(lenses.mirror_artifact)}
          </p>
          <button
            type="button"
            className="deep-mirror__action"
            onClick={handleSaveMirror}
          >
            {mirrorSaved ? "Mirror saved" : "Save this mirror"}
          </button>
        </div>
      )}
    </div>
  );
}

function Lens({ label, body }: { label: string; body: string }) {
  return (
    <section className="deep-lens">
      <div className="deep-lens__label">{label}</div>
      <div className="deep-lens__divider" aria-hidden />
      <div className="deep-lens__body">{stripMarkdown(body)}</div>
    </section>
  );
}