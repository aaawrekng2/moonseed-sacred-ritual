/**
 * Hook for the user's currently selected Guide / Lens / Facets.
 *
 * Reads from `user_preferences` on mount, mirrors to localStorage for
 * instant hydration on subsequent visits, and writes changes back to
 * Supabase fire-and-forget. Other components can subscribe via the
 * `tarotseed:active-guide-changed` event so every surface (home screen
 * badge, selector modal, draw flow) updates in lockstep.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { updateUserPreferences } from "@/lib/user-preferences-write";
import {
  DEFAULT_GUIDE_ID,
  DEFAULT_LENS_ID,
  MAX_ACTIVE_FACETS,
  type FacetId,
  type GuideId,
  type LensMode,
} from "@/lib/guides";

const LS_KEY = "tarotseed:active-guide";
const EVENT_NAME = "tarotseed:active-guide-changed";

type GuideState = {
  guideId: string;
  lensId: LensMode;
  facetIds: string[];
};

function readLocal(): GuideState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GuideState>;
    if (typeof parsed.guideId !== "string") return null;
    return {
      guideId: parsed.guideId,
      lensId: (parsed.lensId as LensMode) ?? DEFAULT_LENS_ID,
      facetIds: Array.isArray(parsed.facetIds) ? parsed.facetIds : [],
    };
  } catch {
    return null;
  }
}

function writeLocal(state: GuideState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(state));
    window.dispatchEvent(new CustomEvent<GuideState>(EVENT_NAME, { detail: state }));
  } catch {
    /* storage full or blocked — non-fatal */
  }
}

const DEFAULT_STATE: GuideState = {
  guideId: DEFAULT_GUIDE_ID,
  lensId: DEFAULT_LENS_ID,
  facetIds: [],
};

export function useActiveGuide() {
  const { user } = useAuth();
  const [state, setState] = useState<GuideState>(() => readLocal() ?? DEFAULT_STATE);

  // Hydrate from Supabase on mount / when the user changes.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("user_preferences")
        .select("active_guide_id, guide_lens, guide_facets")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled || !data) return;
      const next: GuideState = {
        guideId: (data.active_guide_id as string) ?? DEFAULT_GUIDE_ID,
        lensId: (data.guide_lens as LensMode) ?? DEFAULT_LENS_ID,
        facetIds: Array.isArray(data.guide_facets) ? (data.guide_facets as string[]) : [],
      };
      setState(next);
      writeLocal(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Cross-component sync via custom event.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<GuideState>).detail;
      if (!detail) return;
      setState(detail);
    };
    window.addEventListener(EVENT_NAME, handler);
    return () => window.removeEventListener(EVENT_NAME, handler);
  }, []);

  const persist = useCallback(
    (next: GuideState) => {
      setState(next);
      writeLocal(next);
      if (user) {
        void updateUserPreferences(user.id, {
          active_guide_id: next.guideId,
          guide_lens: next.lensId,
          guide_facets: next.facetIds,
        });
      }
    },
    [user],
  );

  const setGuide = useCallback(
    (guideId: string) => persist({ ...state, guideId }),
    [state, persist],
  );

  const setLens = useCallback(
    (lensId: LensMode) => persist({ ...state, lensId }),
    [state, persist],
  );

  const setFacets = useCallback(
    (facetIds: string[]) =>
      persist({ ...state, facetIds: facetIds.slice(0, MAX_ACTIVE_FACETS) }),
    [state, persist],
  );

  const toggleFacet = useCallback(
    (id: FacetId | string) => {
      const has = state.facetIds.includes(id);
      const next = has
        ? state.facetIds.filter((f) => f !== id)
        : [...state.facetIds, id].slice(0, MAX_ACTIVE_FACETS);
      persist({ ...state, facetIds: next });
    },
    [state, persist],
  );

  return {
    guideId: state.guideId as GuideId | string,
    lensId: state.lensId,
    facetIds: state.facetIds,
    setGuide,
    setLens,
    setFacets,
    toggleFacet,
  };
}