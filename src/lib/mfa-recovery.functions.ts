/**
 * Server-side MFA recovery code generation and verification.
 *
 * Codes are generated server-side, returned to the caller exactly
 * ONCE (so the user can save them), and only their SHA-256 hashes
 * are persisted to `user_preferences.mfa_recovery_codes`. The raw
 * codes never live in the database, so an admin SELECT or a DB dump
 * yields no usable credentials.
 *
 * Recovery codes are high-entropy (10 chars × log2(32) ≈ 50 bits) so
 * plain SHA-256 (no per-code salt) is sufficient — rainbow tables at
 * that entropy are infeasible.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createHash, randomBytes } from "crypto";
import { z } from "zod";

const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // omit I, O, 0, 1
const HASH_PREFIX = "sha256:";

function generateOne(): string {
  const bytes = randomBytes(10);
  let s = "";
  for (let j = 0; j < 10; j++) {
    s += ALPHA[bytes[j] % ALPHA.length];
    if (j === 4) s += "-";
  }
  return s;
}

function hashCode(code: string): string {
  return HASH_PREFIX + createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

export const generateMfaRecoveryCodes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const codes: string[] = [];
    for (let i = 0; i < 10; i++) codes.push(generateOne());
    const hashes = codes.map(hashCode);
    const { error } = await supabase
      .from("user_preferences")
      .upsert(
        { user_id: userId, mfa_recovery_codes: hashes } as never,
        { onConflict: "user_id" },
      );
    if (error) throw new Error(error.message);
    return { codes };
  });

export const clearMfaRecoveryCodes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("user_preferences")
      .update({ mfa_recovery_codes: null } as never)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const ConsumeInput = z.object({ code: z.string().min(4).max(32) });

export const consumeMfaRecoveryCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ConsumeInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("user_preferences")
      .select("mfa_recovery_codes")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const stored = ((row as { mfa_recovery_codes?: string[] | null } | null)
      ?.mfa_recovery_codes ?? []) as string[];
    const target = hashCode(data.code);
    const idx = stored.indexOf(target);
    if (idx === -1) return { matched: false };
    const remaining = stored.filter((_, i) => i !== idx);
    const { error: uErr } = await supabase
      .from("user_preferences")
      .update({ mfa_recovery_codes: remaining } as never)
      .eq("user_id", userId);
    if (uErr) throw new Error(uErr.message);
    return { matched: true, remaining: remaining.length };
  });