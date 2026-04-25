import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

/**
 * Anonymous-first auth. On first mount we check for an existing session; if
 * none exists we sign the user in anonymously so every visitor gets a
 * persistent UUID before they ever create a real account. The session is
 * persisted in localStorage by the Supabase client.
 *
 * Returns `{ user, loading }` — `loading` is true until the initial session
 * check (and any anonymous sign-in) settles.
 */
export function useAuth(): { user: User | null; loading: boolean } {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    // Subscribe FIRST so we don't miss the auth event that fires when
    // signInAnonymously resolves.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      setUser(session?.user ?? null);
    });

    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        if (data.session?.user) {
          setUser(data.session.user);
        } else {
          // No session — create an anonymous one. The onAuthStateChange
          // listener above will receive the resulting SIGNED_IN event.
          const { data: anon, error } = await supabase.auth.signInAnonymously();
          if (!cancelled && !error && anon.user) {
            setUser(anon.user);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
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