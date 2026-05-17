/**
 * DW-1 — Helper for invoking server functions that require auth.
 *
 * The `requireSupabaseAuth` middleware reads the bearer token from the
 * `Authorization` request header. TanStack's `useServerFn` does not
 * forward Supabase session cookies, so callers must read the access
 * token from the local Supabase session and pass it explicitly.
 */
import { supabase } from "@/integrations/supabase/client";

export async function getAuthHeaders(): Promise<Record<string, string>> {
  try {
    // Q86 — refresh the session if the access token is missing or about
    // to expire (< 60s). Mirrors the Q84 admin pattern and prevents the
    // intermittent "blank page on one device" issue where a stale token
    // caused server fns to silently 401.
    const { data } = await supabase.auth.getSession();
    let token = data.session?.access_token;
    const expiresAt = data.session?.expires_at ?? 0;
    const now = Math.floor(Date.now() / 1000);
    if (!token || expiresAt - now < 60) {
      try {
        const { data: refreshed } = await supabase.auth.refreshSession();
        token = refreshed.session?.access_token ?? token;
      } catch {
        // fall through with whatever token we have
      }
    }
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}