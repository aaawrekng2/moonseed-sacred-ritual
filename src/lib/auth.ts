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

    const INTERACTION_EVENTS = [
      "pointerdown",
      "keydown",
      "touchstart",
      "scroll",
    ] as const;

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
      const { data: anon, error } = await supabase.auth.signInAnonymously();
      if (!cancelled && !error && anon.user) {
        setUser(anon.user);
      }
    };

    const onFirstInteraction = () => {
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