/**
 * EK37 — AI features gate. Centralized two-layer check.
 *
 * Architecture:
 *   1. Global default lives in admin_settings.ai_features_default
 *      (today: false; launch day: flip to true with one row update).
 *   2. Per-user override lives in user_preferences.ai_features_enabled
 *      (null = follow global; true = explicit grant; false = explicit
 *      revoke even when global is true).
 *
 * The effective state for a user is computed by getAIFeaturesEnabled
 * below. The client useAIEnabled hook caches the result for the
 * current user and re-fetches on user change.
 *
 * Every UI surface that exposes AI — Let Them Speak, Deep Reading
 * lenses, CreditBadge, /credits, pattern interpretations, memory
 * surfaces — gates rendering on useAIEnabled(userId). When false,
 * the surface is hidden entirely (not disabled, not greyed out —
 * gone). This way the seeker uses Tarot Seed as a pure journaling
 * app with no awareness that AI features even exist.
 *
 * Forward-thinking: removing the gate later is a single change. Set
 * admin_settings.ai_features_default = true, and every user without
 * an explicit override gets AI. The per-user toggle keeps working as
 * a revoke mechanism.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const getAIFeaturesEnabled = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ enabled: boolean }> => {
    const { supabase: supa, userId } = context;
    // v2.13 — the admin master AI switch gates everyone. When
    // admin_settings.ai_enabled_globally is explicitly false, AI is hidden
    // for every seeker regardless of their per-user grant. Absent/true = on.
    const { data: gRow } = await supa
      .from("admin_settings" as never)
      .select("value")
      .eq("key", "ai_enabled_globally" as never)
      .maybeSingle();
    const gVal = (gRow as { value?: unknown } | null)?.value;
    const globalOn = !(gVal === false || gVal === "false");
    if (!globalOn) return { enabled: false };
    // EK51 — DEFAULT-DENY model. AI is hidden for every user unless
    // their `user_preferences.ai_features_enabled` is explicitly
    // `true`. The legacy global flag (`admin_settings.ai_features_default`)
    // is no longer consulted — having a global "on" switch left every
    // user without an override exposed to AI by default, which is the
    // opposite of the intended behavior (per the per-user opt-in
    // model: nobody sees AI until you grant them access). The flag
    // can be re-introduced later as a fast "force-on for everyone"
    // override, but the safer default is to require explicit user-
    // level grant.
    const { data: userRow } = await supa
      .from("user_preferences" as never)
      .select("ai_features_enabled")
      .eq("user_id", userId as never)
      .maybeSingle();
    const override = (userRow as { ai_features_enabled?: boolean | null } | null)
      ?.ai_features_enabled;
    return { enabled: override === true };
  });

/**
 * useAIEnabled — client hook returning the effective AI-enabled state
 * for the current authenticated user. Returns null while loading so
 * surfaces can render a stable initial state (typically hidden) until
 * the resolution lands.
 */
export function useAIEnabled(): boolean | null {
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
        const result = await getAIFeaturesEnabled();
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
