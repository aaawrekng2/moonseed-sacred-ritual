import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

/**
 * Interaction-gated anonymous auth. We check for an existing session on
 * mount. If none exists we DO NOT create one immediately — instead we wait
 * for the visitor's first real gesture (pointerdown / keydown / touchstart
 * / scroll) and only then call `signInAnonymously()`. This prevents
 * crawlers, link-preview bots, and security scanners (which load the page
 * but never interact) from flooding `auth.users` with throwaway rows.
 *
 * Returns `{ user, loading }`. `loading` is true only until the initial
 * `getSession()` check resolves; after that, `user` may still be null
 * until the first interaction creates the anonymous account. Callers
 * already handle a null user (see `isAnonymous = !user?.email`).
 */
export function useAuth(): { user: User | null; loading: boolean } {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let signingIn = false;

    // Subscribe FIRST so we don't miss the auth event that fires when
    // signInAnonymously resolves.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      setUser(session?.user ?? null);
    });

    const INTERACTION_EVENTS = ["pointerdown", "keydown", "touchstart", "scroll"] as const;

    const removeInteractionListeners = () => {
      if (typeof window === "undefined") return;
      for (const ev of INTERACTION_EVENTS) {
        window.removeEventListener(ev, onFirstInteraction, true);
      }
    };

    const ensureAnonymousSession = async () => {
      if (signingIn || cancelled) return;
      signingIn = true;
      const { data: existing } = await supabase.auth.getSession();
      if (existing.session?.user) {
        if (!cancelled) setUser(existing.session.user);
        return;
      }
      // EJ43 — surface signInAnonymously failures so eruda can show
      // them. Previously errors were swallowed silently, which made it
      // impossible to diagnose mobile sessions where anonymous auth was
      // failing (quota exhausted, anonymous sign-in disabled at the
      // project level, stale invalid token, network/CORS, etc.).
      const { data: anon, error } = await supabase.auth.signInAnonymously();
      if (error) {
        console.warn("[auth] signInAnonymously failed:", {
          message: error.message,
          status: (error as { status?: number }).status,
          code: (error as { code?: string }).code,
          name: error.name,
        });
      }
      if (!cancelled && !error && anon.user) {
        setUser(anon.user);
      }
    };

    const onFirstInteraction = () => {
      // EJ43 — log to confirm the gate unlocked.
      console.warn("[auth] interaction fired; signing in anonymously");
      removeInteractionListeners();
      void ensureAnonymousSession();
    };

    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        if (data.session?.user) {
          setUser(data.session.user);
        } else if (typeof window !== "undefined") {
          // Defer anonymous sign-in until the visitor actually interacts
          // with the page. Bots/crawlers don't fire these events.
          // EJ43 — log so eruda surfaces whether the interaction gate is
          // armed. If you never see "[auth] interaction fired" after
          // tapping, the gate or the listeners are broken.
          console.warn("[auth] no session yet; arming interaction listeners");
          for (const ev of INTERACTION_EVENTS) {
            window.addEventListener(ev, onFirstInteraction, {
              capture: true,
              once: false,
              passive: true,
            });
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      removeInteractionListeners();
      sub.subscription.unsubscribe();
    };
  }, []);

  return { user, loading };
}

/**
 * Upgrade an anonymous user to a named account by attaching an email.
 * Sends a magic link to confirm the address. UI for this comes later —
 * exposing the function now so future work can call it directly.
 */
export async function upgradeWithEmail(email: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ email });
  if (error) throw error;
}

/**
 * EK37 — Force-trigger anonymous sign-in. The default useAuth flow
 * defers anonymous sign-in until the visitor's first interaction
 * (pointerdown / keydown / touchstart / scroll). For surfaces that
 * land users with no session and no interaction yet (e.g. /settings
 * loaded from a direct URL or a deep link), this helper kicks the
 * gate manually so the user gets a session immediately.
 *
 * Returns the new user on success, or throws on failure. The Settings
 * fallback now calls this on mount when there's no user, so the
 * generic "Couldn't set up your session" error only surfaces when the
 * underlying Supabase call truly fails — making it actionable rather
 * than a routine first-paint state.
 */
export async function triggerAnonymousSession(): Promise<User> {
  const { data: existing } = await supabase.auth.getSession();
  if (existing.session?.user) return existing.session.user;
  const { data: anon, error } = await supabase.auth.signInAnonymously();
  if (error) {
    // Surface the underlying error so the caller can show a real
    // diagnostic instead of a generic message. Most common cause:
    // anonymous sign-in is disabled in the Supabase Auth settings.
    throw new Error(
      `signInAnonymously failed: ${error.message}` +
        ((error as { code?: string }).code
          ? ` (code: ${(error as { code?: string }).code})`
          : ""),
    );
  }
  if (!anon.user) throw new Error("signInAnonymously returned no user");
  return anon.user;
}
