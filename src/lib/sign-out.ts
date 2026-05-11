import { supabase } from "@/integrations/supabase/client";

/**
 * Q43 — Bulletproof sign-out. Clears all moonseed-prefixed localStorage
 * keys, the active-deck cache, and reloads the page to wipe any
 * in-memory React state from the previous session.
 */
export async function signOutAndClear(): Promise<void> {
  try {
    await supabase.auth.signOut();
  } catch {
    // continue with client cleanup regardless
  }
  if (typeof window !== "undefined") {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && (k.startsWith("moonseed:") || k.startsWith("moonseed_"))) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach((k) => window.localStorage.removeItem(k));
    } catch {
      // non-fatal
    }
    window.location.replace("/");
  }
}
