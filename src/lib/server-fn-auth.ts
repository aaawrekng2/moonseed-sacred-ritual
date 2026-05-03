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
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}