/**
 * Phase 2 feature gate — per-seeker.
 *
 * Architecture (mirrors the AI gate, minus the global switch):
 *   - The per-seeker flag lives in user_preferences.phase2_enabled.
 *   - Default is false: nobody sees Phase 2 features until an admin turns
 *     the flag on for a specific seeker from the per-user drill-down at
 *     /admin/usage/users/$userId.
 *
 * Every UI surface that exposes a Phase 2 feature — currently the Gallery
 * tab on Journal and the photo-add affordance on journal entries — gates
 * rendering on usePhase2Enabled() (directly or via <Phase2Gate>). When the
 * flag is off the surface is hidden entirely, not disabled.
 *
 * Wrapping a new Phase 2 feature later is a one-line change: drop it inside
 * <Phase2Gate> (or read the hook). Flipping the whole phase live for a seeker
 * is a single admin toggle.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const getPhase2Enabled = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ enabled: boolean }> => {
    const { supabase: supa, userId } = context;
    const { data: userRow } = await supa
      .from("user_preferences" as never)
      .select("phase2_enabled")
      .eq("user_id", userId as never)
      .maybeSingle();
    const v = (userRow as { phase2_enabled?: boolean | null } | null)
      ?.phase2_enabled;
    return { enabled: v === true };
  });

/**
 * usePhase2Enabled — client hook returning the effective Phase 2 state for
 * the current authenticated seeker. Returns null while loading so surfaces
 * render a stable hidden initial state until the resolution lands.
 */
export function usePhase2Enabled(): boolean | null {
  const [state, setState] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session?.user) {
          if (!cancelled) setState(false);
          return;
        }
        const result = await getPhase2Enabled();
        if (!cancelled) setState(result.enabled);
      } catch {
        if (!cancelled) setState(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}
