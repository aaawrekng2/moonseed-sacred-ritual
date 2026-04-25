/**
 * Idempotently ensures the current user has a `user_preferences` row.
 *
 * The row is normally created on signup, but legacy accounts, rare race
 * conditions, or accidental row deletion can leave a user without one.
 * When the row is missing, any `.update()` call silently affects 0 rows
 * and the UI appears to "lose" preferences after a refresh.
 *
 * `ensureUserPreferencesRow` performs an idempotent insert keyed on
 * `user_id`. The success result is cached per session so repeat calls
 * for the same user are no-ops. On failure we DO NOT cache, so the next
 * call retries.
 */
import { supabase } from "@/integrations/supabase/client";

const ensured = new Set<string>();
const inflight = new Map<string, Promise<{ ok: boolean; error: Error | null }>>();

export type EnsureResult = { ok: boolean; error: Error | null };

export function ensureUserPreferencesRow(userId: string): Promise<EnsureResult> {
  if (ensured.has(userId)) return Promise.resolve({ ok: true, error: null });
  const existing = inflight.get(userId);
  if (existing) return existing;
  const p = (async (): Promise<EnsureResult> => {
    const { error } = await supabase
      .from("user_preferences")
      .upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
    if (!error) {
      ensured.add(userId);
      return { ok: true, error: null };
    }
    return { ok: false, error: new Error(error.message) };
  })().finally(() => {
    inflight.delete(userId);
  });
  inflight.set(userId, p);
  return p;
}

export async function revalidateUserPreferencesRow(userId: string): Promise<EnsureResult> {
  ensured.delete(userId);
  return ensureUserPreferencesRow(userId);
}

export function resetEnsuredUserPreferences() {
  ensured.clear();
  inflight.clear();
}