/**
 * Admin server functions (vF).
 *
 * Every function:
 *   1. Requires an authenticated session (auth middleware).
 *   2. Re-checks the caller's role via the `has_admin_role` security
 *      definer function before doing anything privileged.
 *   3. Uses the service-role admin client only for the narrow
 *      privileged step (listing emails, sending password resets,
 *      deactivating accounts, snapshot writes), never to bypass RLS
 *      for arbitrary data.
 *   4. Writes an immutable row to `admin_audit_log` for every action.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getCardName } from "@/lib/tarot";
import { detectWeavesForUser, previewWeavesForUser, type WeavePreview } from "@/lib/weaves.server";
import { evaluateDetectWeavesAlerts } from "@/lib/detect-weaves-alerts.server";
import { addDaysInTz } from "@/lib/time";

async function assertAdmin(supabase: any, userId: string): Promise<void> {
  const { data, error } = await supabase.rpc("has_admin_role", {
    _user_id: userId,
  });
  if (error || data !== true) {
    throw new Error("not authorized");
  }
}

async function logAction(
  actorId: string,
  actorEmail: string | null,
  action: string,
  targetUserId: string | null,
  targetEmail: string | null,
  details: Record<string, unknown>,
) {
  await supabaseAdmin.from("admin_audit_log" as never).insert({
    admin_user_id: actorId,
    admin_email: actorEmail,
    action,
    target_user_id: targetUserId,
    target_email: targetEmail,
    details,
  } as never);
}

/**
 * Q82 — Insert a row into `email_log`. Used by every server action that
 * sends an email so admins get end-to-end visibility.
 */
async function logEmail(params: {
  user_id?: string | null;
  email_to: string;
  email_type:
    | "confirmation"
    | "password_reset"
    | "resend_confirmation"
    | "manual_confirm"
    | "welcome";
  triggered_by: "system" | "admin" | "user";
  triggered_by_user_id?: string | null;
  status?: "sent" | "failed" | "bounced";
  error_message?: string | null;
}): Promise<void> {
  try {
    await supabaseAdmin.from("email_log" as never).insert({
      user_id: params.user_id ?? null,
      email_to: params.email_to,
      email_type: params.email_type,
      triggered_by: params.triggered_by,
      triggered_by_user_id: params.triggered_by_user_id ?? null,
      status: params.status ?? "sent",
      error_message: params.error_message ?? null,
    } as never);
  } catch (e) {
    // Never let logging fail the parent action.
    console.error("logEmail failed", e);
  }
}

/* ---------- listUsers ---------- */

export const listAdminUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    // CQ — paginate listUsers so growth past 1000 is visible. Safety
    // cap at 100k to avoid runaway loops.
    const allUsers: Array<
      Awaited<ReturnType<typeof supabaseAdmin.auth.admin.listUsers>>["data"]["users"][number]
    > = [];
    {
      let page = 1;
      const perPage = 1000;
      while (true) {
        const { data, error } = await supabaseAdmin.auth.admin.listUsers({
          page,
          perPage,
        });
        if (error) throw new Error(error.message);
        allUsers.push(...data.users);
        if (data.users.length < perPage) break;
        page += 1;
        if (page > 100) break;
      }
    }

    const ids = allUsers.map((u) => u.id);
    // DL-4 — Chunk the prefs IN(...) query. With ~1k users the encoded
    // URL exceeded PostgREST limits and silently returned empty, which
    // surfaced as blank emails (display_name null) and "0 PREMIUM /
    // 0 ADMINS" counts on the Users tab. 200 IDs per chunk keeps each
    // request comfortably under typical 8KB URL caps.
    const PREF_CHUNK = 200;
    const prefs: Array<Record<string, unknown>> = [];
    if (ids.length === 0) {
      // No-op — leave prefs empty.
    } else {
      for (let i = 0; i < ids.length; i += PREF_CHUNK) {
        const slice = ids.slice(i, i + PREF_CHUNK);
        const { data: chunk, error: chunkErr } = await supabaseAdmin
          .from("user_preferences")
          .select(
            "user_id, display_name, role, subscription_type, is_premium, premium_since, premium_expires_at, premium_months_used, admin_note, ai_features_enabled",
          )
          .in("user_id", slice);
        if (chunkErr) throw new Error(chunkErr.message);
        if (chunk) prefs.push(...(chunk as Array<Record<string, unknown>>));
      }
    }
    // Q84 — readings count moved to a separate, non-blocking server fn
    // (`getAdminUserReadingCounts`). listAdminUsers must never be blocked
    // by a slow/failing readings query.
    const prefMap = new Map<string, any>();
    for (const p of prefs) prefMap.set((p as any).user_id, p);

    // Q84 — include only users with an email. Anonymous auth sessions
    // (no email) never appear in the admin user list, regardless of role.
    return allUsers
      .filter((u) => !!u.email)
      .map((u) => {
        const p = prefMap.get(u.id) ?? {};
        return {
          user_id: u.id,
          email: u.email ?? null,
          email_confirmed_at: (u as any).email_confirmed_at ?? null,
          email_confirmed: !!(u as any).email_confirmed_at,
          is_anonymous: !u.email,
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at ?? null,
          banned_until: (u as any).banned_until ?? null,
          display_name: p.display_name ?? null,
          role: (p.role as "user" | "admin" | "super_admin") ?? "user",
          subscription_type: p.subscription_type ?? "none",
          is_premium: !!p.is_premium,
          premium_since: p.premium_since ?? null,
          premium_expires_at: p.premium_expires_at ?? null,
          premium_months_used: p.premium_months_used ?? 0,
          admin_note: p.admin_note ?? null,
          // EK37 — Per-user AI features override.
          ai_features_enabled:
            (p.ai_features_enabled as boolean | null | undefined) ?? null,
          reading_count: 0,
          last_reading: null as string | null,
        };
      });
  });

/* ---------- getAdminUserReadingCounts (Q84) ---------- */

/**
 * Q84 — Separate, non-blocking fetch of per-user reading counts.
 * Split out of `listAdminUsers` so a slow/failing readings query
 * never blocks the Users tab from rendering. The UsersTab calls this
 * in parallel and merges counts client-side; on failure the user list
 * still renders with `—` for counts.
 */
export const getAdminUserReadingCounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const { data: readings, error } = await supabaseAdmin
      .from("readings")
      .select("user_id, created_at");
    if (error) throw new Error(error.message);

    const out: Record<string, { count: number; lastReading: string | null }> = {};
    for (const r of (readings ?? []) as Array<{
      user_id: string;
      created_at: string;
    }>) {
      const c = out[r.user_id] ?? { count: 0, lastReading: null };
      c.count += 1;
      if (!c.lastReading || r.created_at > c.lastReading) c.lastReading = r.created_at;
      out[r.user_id] = c;
    }
    return out;
  });

/* ---------- adminAction (single mutation entrypoint) ---------- */

/* ---------- getAnonymousSessionCounts ---------- */

/**
 * CQ — Counts of anonymous (email IS NULL) auth users for the Dashboard
 * "Anonymous Sessions" card. Reuses the paginated listUsers loop because
 * the admin API does not expose a server-side count for filtered users.
 */
export const getAnonymousSessionCounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const startToday = new Date();
    startToday.setHours(0, 0, 0, 0);
    const start30 = addDaysInTz(new Date(), -30, "UTC");

    let today = 0;
    let last30Days = 0;
    let total = 0;
    let page = 1;
    const perPage = 1000;
    while (true) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage,
      });
      if (error) throw new Error(error.message);
      for (const u of data.users) {
        if (u.email) continue;
        total += 1;
        const created = u.created_at ? new Date(u.created_at).getTime() : 0;
        if (created >= startToday.getTime()) today += 1;
        if (created >= start30.getTime()) last30Days += 1;
      }
      if (data.users.length < perPage) break;
      page += 1;
      if (page > 100) break;
    }
    return { today, last30Days, total } as const;
  });

/* ---------- getPendingSignupCount (9-6-F) ---------- */

/**
 * 9-6-F — Count of users with an email but no email_confirmed_at,
 * surfaced separately so admins can see pending signup attempts
 * without polluting the Users tab.
 */
export const getPendingSignupCount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    let count = 0;
    let page = 1;
    const perPage = 1000;
    while (true) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage,
      });
      if (error) throw new Error(error.message);
      for (const u of data.users) {
        if (u.email && !(u as any).email_confirmed_at) count += 1;
      }
      if (data.users.length < perPage) break;
      page += 1;
      if (page > 100) break;
    }
    return { count } as const;
  });

/* ---------- listPendingSignups (Q68) ---------- */

/**
 * Q68 — Returns users who started signup (have an email) but never
 * confirmed it. Surfaced in the Admin dashboard so we can spot stuck
 * onboarding flows (e.g. typo'd address, deliverability issues).
 */
export const listPendingSignups = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const out: Array<{
      id: string;
      email: string;
      created_at: string;
      last_sign_in_at: string | null;
    }> = [];
    let page = 1;
    const perPage = 1000;
    while (true) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage,
      });
      if (error) throw new Error(error.message);
      for (const u of data.users) {
        if (u.email && !(u as any).email_confirmed_at) {
          out.push({
            id: u.id,
            email: u.email,
            created_at: u.created_at,
            last_sign_in_at: (u as any).last_sign_in_at ?? null,
          });
        }
      }
      if (data.users.length < perPage) break;
      page += 1;
      if (page > 100) break;
    }
    out.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return out;
  });

const ActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("grant_premium"),
    targetUserId: z.string().uuid(),
    months: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("extend_premium"),
    targetUserId: z.string().uuid(),
    months: z.number().int().positive(),
  }),
  z.object({ type: z.literal("revoke_premium"), targetUserId: z.string().uuid() }),
  z.object({
    type: z.literal("assign_admin"),
    targetUserId: z.string().uuid(),
    role: z.enum(["admin", "super_admin"]),
  }),
  z.object({ type: z.literal("remove_admin"), targetUserId: z.string().uuid() }),
  z.object({ type: z.literal("password_reset"), targetUserId: z.string().uuid() }),
  z.object({
    type: z.literal("set_password"),
    targetUserId: z.string().uuid(),
    newPassword: z.string().min(1),
  }),
  z.object({ type: z.literal("deactivate_user"), targetUserId: z.string().uuid() }),
  z.object({ type: z.literal("reactivate_user"), targetUserId: z.string().uuid() }),
  z.object({
    type: z.literal("set_note"),
    targetUserId: z.string().uuid(),
    note: z.string().nullable(),
  }),
  z.object({ type: z.literal("resend_confirmation"), targetUserId: z.string().uuid() }),
  z.object({ type: z.literal("manual_confirm"), targetUserId: z.string().uuid() }),
]);

export const adminAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => ActionSchema.parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId, claims } = context;
    await assertAdmin(supabase, userId);
    const actorEmail = (claims as any)?.email ?? null;

    // Resolve target email + role for guardrails / logging.
    const { data: targetUser } = await supabaseAdmin.auth.admin.getUserById(data.targetUserId);
    const targetEmail = targetUser?.user?.email ?? null;

    // Super-admin-only protections.
    const requiresSuper = data.type === "assign_admin" || data.type === "remove_admin";
    if (requiresSuper) {
      const { data: actorPref } = await supabaseAdmin
        .from("user_preferences")
        .select("role")
        .eq("user_id", userId)
        .maybeSingle();
      if ((actorPref as any)?.role !== "super_admin") {
        throw new Error("super_admin only");
      }
      if (data.targetUserId === userId) {
        throw new Error("cannot change own role");
      }
    }

    // CQ — extra self-protection for deactivate. UI hides the button
    // when the target is the current admin, but defend the server too.
    if (data.type === "deactivate_user" && data.targetUserId === userId) {
      throw new Error("cannot deactivate self");
    }
    // CR — defense-in-depth: refuse to remove your own admin role even
    // if the UI guard is bypassed.
    if (data.type === "remove_admin" && data.targetUserId === userId) {
      throw new Error("Cannot remove your own admin role.");
    }

    switch (data.type) {
      case "grant_premium": {
        const expires = new Date();
        expires.setUTCMonth(expires.getUTCMonth() + data.months);
        await supabaseAdmin.from("user_preferences").upsert(
          {
            user_id: data.targetUserId,
            is_premium: true,
            subscription_type: "gifted",
            premium_since: new Date().toISOString(),
            premium_expires_at: expires.toISOString(),
            gifted_by: userId,
          },
          { onConflict: "user_id" },
        );
        await logAction(userId, actorEmail, "grant_premium", data.targetUserId, targetEmail, {
          months: data.months,
        });
        break;
      }
      case "extend_premium": {
        // Extend from the existing expiration if still in the future,
        // otherwise extend from now.
        const { data: current } = await supabaseAdmin
          .from("user_preferences")
          .select("premium_expires_at")
          .eq("user_id", data.targetUserId)
          .maybeSingle();
        const prev = (current as { premium_expires_at?: string | null } | null)?.premium_expires_at;
        const base = prev && new Date(prev).getTime() > Date.now() ? new Date(prev) : new Date();
        base.setUTCMonth(base.getUTCMonth() + data.months);
        await supabaseAdmin.from("user_preferences").upsert(
          {
            user_id: data.targetUserId,
            is_premium: true,
            subscription_type: "gifted",
            premium_expires_at: base.toISOString(),
          },
          { onConflict: "user_id" },
        );
        await logAction(userId, actorEmail, "extend_premium", data.targetUserId, targetEmail, {
          months: data.months,
          previous_expires_at: prev ?? null,
          expires_at: base.toISOString(),
        });
        break;
      }
      case "revoke_premium": {
        const { data: prevRow } = await supabaseAdmin
          .from("user_preferences")
          .select("premium_expires_at")
          .eq("user_id", data.targetUserId)
          .maybeSingle();
        await supabaseAdmin.from("user_preferences").upsert(
          {
            user_id: data.targetUserId,
            is_premium: false,
            subscription_type: "none",
            premium_expires_at: null,
          },
          { onConflict: "user_id" },
        );
        await logAction(userId, actorEmail, "revoke_premium", data.targetUserId, targetEmail, {
          previous_expires_at:
            (prevRow as { premium_expires_at?: string | null } | null)?.premium_expires_at ?? null,
        });
        break;
      }
      case "assign_admin": {
        if (!targetEmail) {
          throw new Error("Cannot assign admin role to a user without an email address.");
        }
        await supabaseAdmin
          .from("user_preferences")
          .update({ role: data.role })
          .eq("user_id", data.targetUserId);
        await logAction(userId, actorEmail, "assign_admin", data.targetUserId, targetEmail, {
          role: data.role,
        });
        break;
      }
      case "remove_admin": {
        await supabaseAdmin
          .from("user_preferences")
          .update({ role: "user" })
          .eq("user_id", data.targetUserId);
        await logAction(userId, actorEmail, "remove_admin", data.targetUserId, targetEmail, {});
        break;
      }
      case "password_reset": {
        if (!targetEmail) throw new Error("user has no email");
        await supabaseAdmin.auth.admin.generateLink({
          type: "recovery",
          email: targetEmail,
        });
        await logAction(userId, actorEmail, "password_reset", data.targetUserId, targetEmail, {});
        await logEmail({
          user_id: data.targetUserId,
          email_to: targetEmail,
          email_type: "password_reset",
          triggered_by: "admin",
          triggered_by_user_id: userId,
        });
        break;
      }
      case "set_password": {
        // CW — Self-protection: admin cannot change own password via this tool.
        if (data.targetUserId === userId) {
          throw new Error("Cannot set your own password through admin actions. Use Settings.");
        }
        const { error } = await supabaseAdmin.auth.admin.updateUserById(data.targetUserId, {
          password: data.newPassword,
        });
        if (error) throw new Error(error.message);
        // CW — never log the actual password; record only its length so
        // the audit log proves the action without exposing the credential.
        await logAction(userId, actorEmail, "set_password", data.targetUserId, targetEmail, {
          password_length: data.newPassword.length,
        });
        break;
      }
      case "deactivate_user": {
        // Ban for 100 years — effectively deactivate.
        await supabaseAdmin.auth.admin.updateUserById(data.targetUserId, {
          ban_duration: "876000h",
        });
        await logAction(userId, actorEmail, "deactivate_user", data.targetUserId, targetEmail, {});
        break;
      }
      case "reactivate_user": {
        // ban_duration: "none" lifts the ban.
        await supabaseAdmin.auth.admin.updateUserById(data.targetUserId, {
          ban_duration: "none",
        });
        await logAction(userId, actorEmail, "reactivate_user", data.targetUserId, targetEmail, {});
        break;
      }
      case "set_note": {
        await supabaseAdmin
          .from("user_preferences")
          .update({ admin_note: data.note })
          .eq("user_id", data.targetUserId);
        await logAction(userId, actorEmail, "set_note", data.targetUserId, targetEmail, {
          note: data.note,
        });
        break;
      }
      case "resend_confirmation": {
        if (!targetEmail) throw new Error("user has no email");
        const { error: resendErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(targetEmail);
        if (resendErr) throw new Error(resendErr.message);
        await logAction(
          userId,
          actorEmail,
          "resend_confirmation",
          data.targetUserId,
          targetEmail,
          {},
        );
        await logEmail({
          user_id: data.targetUserId,
          email_to: targetEmail,
          email_type: "resend_confirmation",
          triggered_by: "admin",
          triggered_by_user_id: userId,
        });
        break;
      }
      case "manual_confirm": {
        if (!targetEmail) throw new Error("user has no email");
        const { error: confirmErr } = await supabaseAdmin.auth.admin.updateUserById(
          data.targetUserId,
          {
            email_confirm: true,
          },
        );
        if (confirmErr) throw new Error(confirmErr.message);
        await logAction(userId, actorEmail, "manual_confirm", data.targetUserId, targetEmail, {});
        await logEmail({
          user_id: data.targetUserId,
          email_to: targetEmail,
          email_type: "manual_confirm",
          triggered_by: "admin",
          triggered_by_user_id: userId,
        });
        break;
      }
    }

    return { ok: true } as const;
  });

/* ---------- DL-6 — Backfill long Story (pattern) names ---------- */

/**
 * Build a short, evocative 1–3 word name for a Story from one of its
 * threads. Mirrors the helper in memory.functions but lives here so the
 * admin backfill can run independently of the runtime detector.
 */
function buildShortNameForBackfill(t: {
  title?: string | null;
  summary?: string | null;
  card_ids?: number[] | null;
}): string {
  const dominantCardId = t.card_ids?.[0] ?? null;
  const cardName = typeof dominantCardId === "number" ? getCardName(dominantCardId) : null;
  const text = (t.title || t.summary || "").toLowerCase();
  const stopwords = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "as",
    "in",
    "of",
    "to",
    "across",
    "multiple",
    "reading",
    "readings",
    "appears",
    "force",
    "with",
    "this",
    "that",
    "your",
    "you",
    "for",
    "from",
    "into",
    "over",
    "under",
    "than",
    "then",
    "them",
    "their",
    "there",
    "have",
    "has",
    "had",
    "been",
    "being",
  ]);
  const words = text.split(/[\s,.;:!?]+/).filter((w) => w.length > 3 && !stopwords.has(w));
  const keyWord = words[0] ?? null;
  const cardCore = cardName ? cardName.replace(/^The\s+/i, "") : null;
  if (keyWord && cardCore) {
    // DW-5 / EA-3 — Skip the keyword when it's already part of the
    // card name (e.g. 'nine' extracted from a thread about Nine of
    // Wands would produce 'Nine Nine of Wands'). Fall back to
    // cardCore alone.
    if (cardCore.toLowerCase().includes(keyWord.toLowerCase())) {
      return cardCore.slice(0, 60);
    }
    const cap = keyWord.charAt(0).toUpperCase() + keyWord.slice(1);
    return `${cap} ${cardCore}`.slice(0, 60);
  }
  if (cardCore) return cardCore;
  return "Recurring Symbols";
}

/**
 * Admin-only: shorten existing pattern.name values that are longer than
 * 30 characters by reading the dominant card from the pattern's first
 * thread. Patterns the user has manually renamed (`is_user_named`) are
 * left untouched.
 */
export const backfillPatternNames = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const { data: patternRows, error: patErr } = await supabaseAdmin
      .from("patterns")
      .select("id, name, thread_ids, is_user_named");
    if (patErr) throw new Error(patErr.message);

    const patterns = (patternRows ?? []) as Array<{
      id: string;
      name: string;
      thread_ids: string[] | null;
      is_user_named: boolean | null;
    }>;

    let updated = 0;
    let skipped = 0;
    for (const p of patterns) {
      if (p.is_user_named) {
        skipped += 1;
        continue;
      }
      if ((p.name ?? "").length <= 30) {
        skipped += 1;
        continue;
      }
      const firstThreadId = p.thread_ids?.[0];
      if (!firstThreadId) {
        skipped += 1;
        continue;
      }
      const { data: thread } = await supabaseAdmin
        .from("symbolic_threads")
        .select("title, summary, card_ids")
        .eq("id", firstThreadId)
        .maybeSingle();
      if (!thread) {
        skipped += 1;
        continue;
      }
      const newName = buildShortNameForBackfill(
        thread as {
          title: string | null;
          summary: string | null;
          card_ids: number[] | null;
        },
      );
      if (newName === p.name) {
        skipped += 1;
        continue;
      }
      const { error: updErr } = await supabaseAdmin
        .from("patterns")
        .update({ name: newName })
        .eq("id", p.id);
      if (updErr) throw new Error(updErr.message);
      updated += 1;
    }

    await logAction(userId, null, "backfill_pattern_names", null, null, {
      updated,
      skipped,
      considered: patterns.length,
    });
    return { ok: true, updated, skipped, considered: patterns.length } as const;
  });

/* ---------- createBackup ---------- */

export const createAdminBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId, claims } = context;
    await assertAdmin(supabase, userId);
    const actorEmail = (claims as any)?.email ?? null;

    const [{ data: readings }, { data: prefs }] = await Promise.all([
      supabaseAdmin.from("readings").select("*"),
      supabaseAdmin.from("user_preferences").select("*"),
    ]);
    const payload = {
      created_at: new Date().toISOString(),
      readings: readings ?? [],
      user_preferences: prefs ?? [],
    };
    const blob = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(blob);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const path = `manual/${stamp}.json`;

    const { error: upErr } = await supabaseAdmin.storage.from("admin-backups").upload(path, bytes, {
      contentType: "application/json",
      upsert: false,
    });
    if (upErr) throw new Error(upErr.message);

    const { data: row, error: insErr } = await supabaseAdmin
      .from("admin_backups" as never)
      .insert({
        created_by: userId,
        kind: "manual",
        status: "ready",
        size_bytes: bytes.byteLength,
        storage_path: path,
      } as never)
      .select()
      .single();
    if (insErr) throw new Error(insErr.message);

    await logAction(userId, actorEmail, "create_backup", null, null, {
      path,
      size_bytes: bytes.byteLength,
    });

    return row;
  });

/* ---------- downloadBackupUrl ---------- */

export const getBackupDownloadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ storagePath: z.string() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data: signed, error } = await supabaseAdmin.storage
      .from("admin-backups")
      .createSignedUrl(data.storagePath, 300);
    if (error) throw new Error(error.message);
    return { url: signed.signedUrl };
  });

/* ---------- restoreBackup (stub: marks but never overwrites) ---------- */

export const restoreAdminBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ backupId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId, claims } = context;
    await assertAdmin(supabase, userId);
    const actorEmail = (claims as any)?.email ?? null;

    // For safety this endpoint is intentionally non-destructive in app
    // code. It logs the intent so an operator can perform the actual
    // restore manually from the snapshot file. This protects seekers
    // from a misclick wiping live data.
    await logAction(userId, actorEmail, "restore_backup_requested", null, null, {
      backup_id: data.backupId,
    });
    return { ok: true, requiresManualRun: true } as const;
  });

/* ---------- runDetectWeavesAdmin ---------- */

/**
 * Admin-only manual trigger for the Weave detector.
 *
 * Scope is either:
 *  - { mode: "user", userId } — run for a single user
 *  - { mode: "all" }          — run for every user with ≥2 active patterns
 *
 * Persists a row in `detect_weaves_runs` with mode="manual" and the
 * triggering admin id, plus an entry in `admin_audit_log`.
 */
const MAX_USERS_PER_MANUAL_RUN = 500;

export const runDetectWeavesAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .union([
        z.object({ scope: z.literal("all") }),
        z.object({ scope: z.literal("user"), userId: z.string().uuid() }),
      ])
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId, claims } = context;
    await assertAdmin(supabase, userId);
    const actorEmail = (claims as any)?.email ?? null;

    const startedAt = Date.now();
    let candidates: string[] = [];

    try {
      if (data.scope === "user") {
        candidates = [data.userId];
      } else {
        const { data: rows, error } = await supabaseAdmin
          .from("patterns")
          .select("user_id")
          .in("lifecycle_state", ["emerging", "active", "reawakened"]);
        if (error) throw new Error(error.message);
        const counts = new Map<string, number>();
        for (const r of (rows ?? []) as Array<{ user_id: string }>) {
          counts.set(r.user_id, (counts.get(r.user_id) ?? 0) + 1);
        }
        candidates = Array.from(counts.entries())
          .filter(([, c]) => c >= 2)
          .map(([u]) => u)
          .slice(0, MAX_USERS_PER_MANUAL_RUN);
      }

      let totalDetected = 0;
      let totalExisting = 0;
      const perUserErrors: Array<{ user_id: string; error: string }> = [];
      const perUser: Array<{
        user_id: string;
        inserted: number;
        existing: number;
        error?: string;
      }> = [];
      for (const uid of candidates) {
        try {
          const { inserted, existing } = await detectWeavesForUser(supabaseAdmin, uid);
          totalDetected += inserted;
          totalExisting += existing;
          perUser.push({ user_id: uid, inserted, existing });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          perUserErrors.push({
            user_id: uid,
            error: msg,
          });
          perUser.push({ user_id: uid, inserted: 0, existing: 0, error: msg });
        }
      }

      const finishedAt = Date.now();
      const status =
        perUserErrors.length === candidates.length && candidates.length > 0
          ? "error"
          : perUserErrors.length > 0
            ? "partial"
            : "success";

      const { data: insertedRun } = await supabaseAdmin
        .from("detect_weaves_runs" as never)
        .insert({
          started_at: new Date(startedAt).toISOString(),
          finished_at: new Date(finishedAt).toISOString(),
          duration_ms: finishedAt - startedAt,
          users_scanned: candidates.length,
          weaves_detected: totalDetected,
          weaves_existing: totalExisting,
          status,
          message:
            data.scope === "user"
              ? `manual run for user ${data.userId}`
              : "manual run for all eligible users",
          per_user_errors: perUserErrors,
          mode: "manual",
          triggered_by: userId,
        } as never)
        .select("id")
        .single();

      const manualRunId = (insertedRun as { id?: string } | null)?.id ?? null;
      if (manualRunId) {
        await evaluateDetectWeavesAlerts(manualRunId).catch((err) =>
          console.error("[detect-weaves alerts] eval failed", err),
        );
      }

      await logAction(
        userId,
        actorEmail,
        "run_detect_weaves",
        data.scope === "user" ? data.userId : null,
        null,
        {
          scope: data.scope,
          users_scanned: candidates.length,
          weaves_detected: totalDetected,
          weaves_existing: totalExisting,
          errors: perUserErrors.length,
          duration_ms: finishedAt - startedAt,
        },
      );

      return {
        ok: true,
        users_scanned: candidates.length,
        weaves_detected: totalDetected,
        weaves_existing: totalExisting,
        errors: perUserErrors.length,
        status,
        per_user: perUser,
      } as const;
    } catch (e) {
      const finishedAt = Date.now();
      const message = e instanceof Error ? e.message : String(e);
      const { data: failedRun } = await supabaseAdmin
        .from("detect_weaves_runs" as never)
        .insert({
          started_at: new Date(startedAt).toISOString(),
          finished_at: new Date(finishedAt).toISOString(),
          duration_ms: finishedAt - startedAt,
          users_scanned: candidates.length,
          weaves_detected: 0,
          status: "error",
          message: `manual run failed: ${message}`,
          per_user_errors: [],
          mode: "manual",
          triggered_by: userId,
        } as never)
        .select("id")
        .single();
      const failedRunId = (failedRun as { id?: string } | null)?.id ?? null;
      if (failedRunId) {
        await evaluateDetectWeavesAlerts(failedRunId).catch((err) =>
          console.error("[detect-weaves alerts] eval failed", err),
        );
      }
      throw e;
    }
  });

/* ---------- previewDetectWeavesAdmin ---------- */

/**
 * Admin-only preview ("dry run") for the Weave detector.
 *
 * Returns the weaves that WOULD be created on a real run for either a
 * single user or every user with ≥2 active patterns, WITHOUT writing
 * anything to the `weaves` table or the `detect_weaves_runs` log. Useful
 * for inspecting what the detector is about to do before actually
 * triggering it.
 */
export const previewDetectWeavesAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .union([
        z.object({ scope: z.literal("all") }),
        z.object({ scope: z.literal("user"), userId: z.string().uuid() }),
      ])
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId, claims } = context;
    await assertAdmin(supabase, userId);
    const actorEmail = (claims as any)?.email ?? null;

    const startedAt = Date.now();
    let candidates: string[] = [];

    if (data.scope === "user") {
      candidates = [data.userId];
    } else {
      const { data: rows, error } = await supabaseAdmin
        .from("patterns")
        .select("user_id")
        .in("lifecycle_state", ["emerging", "active", "reawakened"]);
      if (error) throw new Error(error.message);
      const counts = new Map<string, number>();
      for (const r of (rows ?? []) as Array<{ user_id: string }>) {
        counts.set(r.user_id, (counts.get(r.user_id) ?? 0) + 1);
      }
      candidates = Array.from(counts.entries())
        .filter(([, c]) => c >= 2)
        .map(([u]) => u)
        .slice(0, MAX_USERS_PER_MANUAL_RUN);
    }

    type PerUser = {
      user_id: string;
      would_create: WeavePreview[];
      already_existing: number;
      error?: string;
    };
    const perUser: PerUser[] = [];
    let totalWouldCreate = 0;
    let totalAlreadyExisting = 0;
    let errorCount = 0;
    for (const uid of candidates) {
      try {
        const { would_create, already_existing } = await previewWeavesForUser(supabaseAdmin, uid);
        totalWouldCreate += would_create.length;
        totalAlreadyExisting += already_existing;
        if (would_create.length > 0 || already_existing > 0) {
          perUser.push({
            user_id: uid,
            would_create,
            already_existing,
          });
        }
      } catch (e) {
        errorCount += 1;
        perUser.push({
          user_id: uid,
          would_create: [],
          already_existing: 0,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const duration_ms = Date.now() - startedAt;

    // Audit-log the preview itself (read-only, but worth recording who
    // peeked at the dry-run output for which scope).
    await logAction(
      userId,
      actorEmail,
      "preview_detect_weaves",
      data.scope === "user" ? data.userId : null,
      null,
      {
        scope: data.scope,
        users_scanned: candidates.length,
        would_create: totalWouldCreate,
        already_existing: totalAlreadyExisting,
        errors: errorCount,
        duration_ms,
      },
    );

    return {
      ok: true,
      dry_run: true,
      users_scanned: candidates.length,
      would_create: totalWouldCreate,
      already_existing: totalAlreadyExisting,
      errors: errorCount,
      duration_ms,
      per_user: perUser,
    } as const;
  });

/* ---------- detect-weaves alerts ---------- */

export type DetectWeavesAlert = {
  id: string;
  created_at: string;
  kind: "failure" | "partial" | "zero_streak";
  severity: "info" | "warn" | "error";
  message: string;
  details: Record<string, any>;
  run_id: string | null;
  notified_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
};

/**
 * Admin-only: list detect-weaves alerts. Defaults to unresolved only.
 */
export const listDetectWeavesAlerts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        includeResolved: z.boolean().optional().default(false),
        limit: z.number().int().min(1).max(200).optional().default(50),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    let query = supabaseAdmin
      .from("detect_weaves_alerts" as never)
      .select(
        "id, created_at, kind, severity, message, details, run_id, notified_at, resolved_at, resolved_by",
      )
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (!data.includeResolved) {
      query = query.is("resolved_at", null);
    }
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return {
      alerts: (rows ?? []) as unknown as DetectWeavesAlert[],
    };
  });

/**
 * Admin-only: mark a detect-weaves alert as resolved.
 */
export const resolveDetectWeavesAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ alertId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId, claims } = context;
    await assertAdmin(supabase, userId);
    const actorEmail = (claims as any)?.email ?? null;

    const { error } = await supabaseAdmin
      .from("detect_weaves_alerts" as never)
      .update({
        resolved_at: new Date().toISOString(),
        resolved_by: userId,
      } as never)
      .eq("id", data.alertId)
      .is("resolved_at", null);
    if (error) throw new Error(error.message);

    await logAction(userId, actorEmail, "resolve_detect_weaves_alert", null, null, {
      alert_id: data.alertId,
    });
    return { ok: true } as const;
  });

/* ---------- Q82 — email log ---------- */

export type EmailLogRow = {
  id: string;
  created_at: string;
  user_id: string | null;
  email_to: string;
  email_type: string;
  triggered_by: string;
  triggered_by_user_id: string | null;
  triggered_by_email: string | null;
  status: string;
  error_message: string | null;
};

/**
 * Admin-only: list email_log rows with optional filters. Resolves the
 * triggering admin's email when present so the UI can render a name
 * instead of a UUID.
 */
export const getEmailLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        emailType: z.string().optional(),
        status: z.string().optional(),
        search: z.string().optional(),
        userId: z.string().uuid().optional(),
        userEmail: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional().default(100),
        offset: z.number().int().min(0).optional().default(0),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    let q = supabaseAdmin
      .from("email_log" as never)
      .select(
        "id, created_at, user_id, email_to, email_type, triggered_by, triggered_by_user_id, status, error_message",
      )
      .order("created_at", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);

    if (data.emailType) q = q.eq("email_type", data.emailType);
    if (data.status) q = q.eq("status", data.status);
    if (data.search) {
      q = q.ilike("email_to", `%${data.search}%`);
    }
    if (data.userId || data.userEmail) {
      const parts: string[] = [];
      if (data.userId) parts.push(`user_id.eq.${data.userId}`);
      if (data.userEmail) parts.push(`email_to.eq.${data.userEmail}`);
      q = q.or(parts.join(","));
    }

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const triggerIds = Array.from(
      new Set(
        ((rows ?? []) as Array<{ triggered_by_user_id: string | null }>)
          .map((r) => r.triggered_by_user_id)
          .filter((id): id is string => !!id),
      ),
    );
    const adminEmails = new Map<string, string | null>();
    for (const id of triggerIds) {
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(id);
      adminEmails.set(id, u?.user?.email ?? null);
    }

    return ((rows ?? []) as Array<Omit<EmailLogRow, "triggered_by_email">>).map((r) => ({
      ...r,
      triggered_by_email: r.triggered_by_user_id
        ? (adminEmails.get(r.triggered_by_user_id) ?? null)
        : null,
    })) as EmailLogRow[];
  });

/**
 * Q82 — Public (unauthenticated) server fn used by the login screen
 * to record a self-service resend. Rate-limited to 1 row per email per
 * 60 seconds via an existing-row lookup. The Supabase client-side
 * `auth.resend()` itself enforces hard rate limits; this is just a
 * log entry.
 */
export const logUserResendConfirmation = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        email: z.string().email().max(320),
        status: z.enum(["sent", "failed"]).optional().default("sent"),
        error_message: z.string().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    // Soft rate limit: drop if same email logged in last 60s.
    const since = new Date(Date.now() - 60_000).toISOString();
    const { data: recent } = await supabaseAdmin
      .from("email_log" as never)
      .select("id")
      .eq("email_to", data.email)
      .eq("email_type", "resend_confirmation")
      .eq("triggered_by", "user")
      .gte("created_at", since)
      .limit(1);
    if (recent && (recent as unknown as unknown[]).length > 0) {
      return { ok: true, throttled: true } as const;
    }
    await logEmail({
      email_to: data.email,
      email_type: "resend_confirmation",
      triggered_by: "user",
      status: data.status,
      error_message: data.error_message ?? null,
    });
    return { ok: true, throttled: false } as const;
  });
/* ────────────────────────────────────────────────────────────────────
   EJ31 — Per-user deck inspection, download, and copy.
   Three admin server functions:
     - listUserDecks(userId)        → decks + per-deck card counts
     - getDeckDetail(deckId)        → deck row + cards + signed URLs
     - copyDeckToUser(sourceDeckId, targetUserId) → clones rows + files
   The "download deck" UI flow reuses existing per-deck export (zip)
   logic on the client side once it has the signed URLs from
   getDeckDetail. No server-side packaging needed for first pass.
   ──────────────────────────────────────────────────────────────────── */

const DECK_BUCKET = "custom-deck-images";

export const listUserDecks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId: actorId } = context;
    await assertAdmin(supabase, actorId);
    // Decks belonging to the target user.
    const { data: decks, error: deckErr } = await supabaseAdmin
      .from("custom_decks")
      .select(
        "id, name, deck_type, shape, is_complete, is_active, created_at, card_back_thumb_url, card_back_url",
      )
      .eq("user_id", data.userId)
      .order("created_at", { ascending: false });
    if (deckErr) throw new Error(deckErr.message);
    const deckList = (decks ?? []) as Array<{
      id: string;
      name: string | null;
      deck_type: "tarot" | "oracle";
      shape: "rectangle" | "round";
      is_complete: boolean;
      is_active: boolean;
      created_at: string;
      card_back_thumb_url: string | null;
      card_back_url: string | null;
    }>;
    if (deckList.length === 0)
      return [] as Array<(typeof deckList)[number] & { card_count: number }>;
    // Card counts per deck (active, non-archived rows only).
    const ids = deckList.map((d) => d.id);
    const { data: cards } = await supabaseAdmin
      .from("custom_deck_cards")
      .select("deck_id")
      .in("deck_id", ids)
      .is("archived_at", null);
    const counts = new Map<string, number>();
    for (const row of (cards ?? []) as Array<{ deck_id: string }>) {
      counts.set(row.deck_id, (counts.get(row.deck_id) ?? 0) + 1);
    }
    return deckList.map((d) => ({ ...d, card_count: counts.get(d.id) ?? 0 }));
  });

export const getDeckDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ deckId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId: actorId } = context;
    await assertAdmin(supabase, actorId);
    const { data: deck, error: deckErr } = await supabaseAdmin
      .from("custom_decks")
      .select(
        "id, user_id, name, deck_type, shape, width_inches, height_inches, corner_radius_percent, corner_radius_px, card_back_url, card_back_thumb_url, card_back_path, is_complete, is_active, created_at",
      )
      .eq("id", data.deckId)
      .maybeSingle();
    if (deckErr) throw new Error(deckErr.message);
    if (!deck) throw new Error("Deck not found");
    const { data: cards, error: cardErr } = await supabaseAdmin
      .from("custom_deck_cards")
      .select("id, card_id, display_path, thumbnail_path, card_name, card_description, source")
      .eq("deck_id", data.deckId)
      .is("archived_at", null)
      .order("card_id", { ascending: true });
    if (cardErr) throw new Error(cardErr.message);
    const cardRows = (cards ?? []) as Array<{
      id: string;
      card_id: number;
      display_path: string | null;
      thumbnail_path: string | null;
      card_name: string | null;
      card_description: string | null;
      source: string | null;
    }>;
    // Sign every thumbnail path so the modal can render the grid
    // without re-fetching. 1-hour expiry — plenty for an admin
    // inspection session.
    const yearSecs = 60 * 60;
    const allPaths = cardRows.map((c) => c.thumbnail_path).filter((p): p is string => !!p);
    const signed: Record<string, string> = {};
    if (allPaths.length > 0) {
      const { data: signedArr } = await supabaseAdmin.storage
        .from(DECK_BUCKET)
        .createSignedUrls(allPaths, yearSecs);
      for (const entry of signedArr ?? []) {
        if (entry.path && entry.signedUrl) {
          signed[entry.path] = entry.signedUrl;
        }
      }
    }
    let backSignedUrl: string | null = deck.card_back_thumb_url ?? deck.card_back_url ?? null;
    if (deck.card_back_path) {
      const { data: backSigned } = await supabaseAdmin.storage
        .from(DECK_BUCKET)
        .createSignedUrl(deck.card_back_path, yearSecs);
      if (backSigned?.signedUrl) backSignedUrl = backSigned.signedUrl;
    }
    return {
      deck,
      cards: cardRows.map((c) => ({
        ...c,
        thumbnail_signed_url: c.thumbnail_path ? (signed[c.thumbnail_path] ?? null) : null,
      })),
      card_back_signed_url: backSignedUrl,
    };
  });

export const copyDeckToUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        sourceDeckId: z.string().uuid(),
        targetUserId: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId: actorId, claims } = context;
    await assertAdmin(supabase, actorId);
    const actorEmail = (claims as any)?.email ?? null;
    // Load source deck.
    const { data: srcDeck, error: srcDeckErr } = await supabaseAdmin
      .from("custom_decks")
      .select("*")
      .eq("id", data.sourceDeckId)
      .maybeSingle();
    if (srcDeckErr) throw new Error(srcDeckErr.message);
    if (!srcDeck) throw new Error("Source deck not found");
    if ((srcDeck as { user_id: string }).user_id === data.targetUserId) {
      throw new Error("Target user already owns this deck");
    }
    // Load source cards.
    const { data: srcCards, error: srcCardsErr } = await supabaseAdmin
      .from("custom_deck_cards")
      .select("*")
      .eq("deck_id", data.sourceDeckId)
      .is("archived_at", null);
    if (srcCardsErr) throw new Error(srcCardsErr.message);
    const cards = (srcCards ?? []) as Array<Record<string, unknown>>;
    // Create new deck row owned by target user. Reset is_active so we
    // don't accidentally swap their active deck out from under them.
    const srcRow = srcDeck as Record<string, unknown>;
    const newDeckInsert: Record<string, unknown> = {
      user_id: data.targetUserId,
      name: srcRow.name,
      deck_type: srcRow.deck_type,
      shape: srcRow.shape,
      width_inches: srcRow.width_inches,
      height_inches: srcRow.height_inches,
      corner_radius_percent: srcRow.corner_radius_percent,
      corner_radius_px: srcRow.corner_radius_px,
      is_complete: srcRow.is_complete,
      is_active: false,
    };
    const { data: newDeckRow, error: newDeckErr } = await supabaseAdmin
      .from("custom_decks")
      .insert(newDeckInsert as never)
      .select("id")
      .single();
    if (newDeckErr) throw new Error(newDeckErr.message);
    const newDeckId = (newDeckRow as { id: string }).id;
    // Helper: copy one storage object from old path to a new path
    // under the target user's folder. Returns the new path or null
    // when the source path is missing.
    const ts = Date.now();
    let copyCounter = 0;
    const copyOne = async (oldPath: string | null): Promise<string | null> => {
      if (!oldPath) return null;
      // Preserve the file extension; rebase everything else under
      // the target user + new deck. Use a counter for uniqueness so
      // sequential copies inside the same millisecond don't collide.
      const dot = oldPath.lastIndexOf(".");
      const ext = dot >= 0 ? oldPath.slice(dot) : ".webp";
      copyCounter += 1;
      const newPath = `${data.targetUserId}/${newDeckId}/copy-${ts}-${copyCounter}${ext}`;
      const { error: copyErr } = await supabaseAdmin.storage
        .from(DECK_BUCKET)
        .copy(oldPath, newPath);
      if (copyErr) {
        console.warn("[copyDeckToUser] copy failed", { oldPath, newPath, error: copyErr.message });
        return null;
      }
      return newPath;
    };
    const signOne = async (path: string | null): Promise<string | null> => {
      if (!path) return null;
      const yearSecs = 60 * 60 * 24 * 365;
      const { data: signed } = await supabaseAdmin.storage
        .from(DECK_BUCKET)
        .createSignedUrl(path, yearSecs);
      return signed?.signedUrl ?? null;
    };
    // Copy card-back image (and its thumb).
    const cardBackPath = (srcRow.card_back_path as string | null) ?? null;
    const cardBackThumbPath = (srcRow.card_back_thumb_path as string | null) ?? null;
    const newBackPath = await copyOne(cardBackPath);
    const newBackThumbPath = await copyOne(cardBackThumbPath);
    const newBackUrl = await signOne(newBackPath);
    const newBackThumbUrl = await signOne(newBackThumbPath);
    if (newBackPath || newBackUrl) {
      const updates: Record<string, unknown> = {};
      if (newBackPath) updates.card_back_path = newBackPath;
      if (newBackThumbPath) updates.card_back_thumb_path = newBackThumbPath;
      if (newBackUrl) updates.card_back_url = newBackUrl;
      if (newBackThumbUrl) updates.card_back_thumb_url = newBackThumbUrl;
      await supabaseAdmin
        .from("custom_decks")
        .update(updates as never)
        .eq("id", newDeckId);
    }
    // Copy each card: storage files + DB row.
    let cardsCopied = 0;
    for (const c of cards) {
      const oldDisplayPath = (c.display_path as string | null) ?? null;
      const oldThumbPath = (c.thumbnail_path as string | null) ?? null;
      const newDisplayPath = await copyOne(oldDisplayPath);
      const newThumbPath = await copyOne(oldThumbPath);
      // If both storage copies fail, skip this card — DB row would
      // point to nothing useful.
      if (!newDisplayPath && !newThumbPath) {
        console.warn("[copyDeckToUser] skipping card with no copyable files", c.card_id);
        continue;
      }
      const newDisplayUrl = await signOne(newDisplayPath);
      const newThumbUrl = await signOne(newThumbPath);
      // EJ32 — preserve full per-card content. Earlier versions
      // dropped journal_prompts (oracle decks lost the user's
      // per-card prompts), corner_radius_percent + radius_overridden
      // (per-card visual overrides lost), and crop_coords (re-crop
      // capability lost). All four are now copied straight through.
      // Also EJ32 — set processing_status: "saved" + processed_at
      // since the variant files are already in storage at the new
      // path. Without this, the deck UI shows "Optimizing… 0 of N"
      // forever even though the images work.
      const insertRow: Record<string, unknown> = {
        deck_id: newDeckId,
        user_id: data.targetUserId,
        card_id: c.card_id,
        display_url: newDisplayUrl ?? "",
        thumbnail_url: newThumbUrl ?? newDisplayUrl ?? "",
        display_path: newDisplayPath ?? oldDisplayPath ?? "",
        thumbnail_path: newThumbPath ?? oldThumbPath ?? "",
        source: "imported",
        card_name: c.card_name ?? null,
        card_description: c.card_description ?? null,
        journal_prompts: c.journal_prompts ?? null,
        corner_radius_percent: c.corner_radius_percent ?? null,
        radius_overridden: c.radius_overridden ?? false,
        crop_coords: c.crop_coords ?? null,
        processing_status: "saved",
        processed_at: new Date().toISOString(),
      };
      const { error: insErr } = await supabaseAdmin
        .from("custom_deck_cards")
        .insert(insertRow as never);
      if (insErr) {
        console.warn("[copyDeckToUser] card insert failed", {
          cardId: c.card_id,
          error: insErr.message,
        });
        continue;
      }
      cardsCopied += 1;
    }
    // EJ32 — recompute is_complete based on actual cards inserted.
    // Tarot decks expect exactly 78 cards; oracle decks are
    // variable so we trust the source's flag IF every card we
    // attempted got inserted (no partial copy).
    const deckType = (srcRow.deck_type as string | null) ?? "tarot";
    const finalIsComplete =
      deckType === "tarot"
        ? cardsCopied === 78
        : cardsCopied === cards.length && !!srcRow.is_complete;
    if (finalIsComplete !== !!srcRow.is_complete) {
      await supabaseAdmin
        .from("custom_decks")
        .update({ is_complete: finalIsComplete } as never)
        .eq("id", newDeckId);
    }
    // Look up target email for the audit log.
    const { data: targetAuth } = await supabaseAdmin.auth.admin.getUserById(data.targetUserId);
    const targetEmail = targetAuth?.user?.email ?? null;
    await logAction(actorId, actorEmail, "copy_deck", data.targetUserId, targetEmail, {
      source_deck_id: data.sourceDeckId,
      source_user_id: srcRow.user_id,
      new_deck_id: newDeckId,
      cards_copied: cardsCopied,
      cards_total: cards.length,
      is_complete: finalIsComplete,
    });
    return {
      new_deck_id: newDeckId,
      cards_copied: cardsCopied,
      cards_total: cards.length,
    };
  });

/* ────────────────────────────────────────────────────────────────────
   EJ32 — Portable per-deck export bundle.
   Returns the raw deck + cards data plus signed URLs for every
   image file. The client (deck-download.ts) assembles a portable
   zip that strips identity (no user_id, no UUIDs, no source-user
   paths) so the resulting file imports cleanly into any account.
   ──────────────────────────────────────────────────────────────────── */

export const getDeckExportBundle = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ deckId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId: actorId } = context;
    await assertAdmin(supabase, actorId);
    const { data: deck, error: deckErr } = await supabaseAdmin
      .from("custom_decks")
      .select("*")
      .eq("id", data.deckId)
      .maybeSingle();
    if (deckErr) throw new Error(deckErr.message);
    if (!deck) throw new Error("Deck not found");
    const { data: cards, error: cardErr } = await supabaseAdmin
      .from("custom_deck_cards")
      .select("*")
      .eq("deck_id", data.deckId)
      .is("archived_at", null)
      .order("card_id", { ascending: true });
    if (cardErr) throw new Error(cardErr.message);
    const cardRows = (cards ?? []) as Array<Record<string, NonNullable<unknown>>>;
    // Sign every storage path the client will need to fetch.
    // 10-min expiry — enough to download + zip all blobs even for
    // large oracle decks.
    const expirySecs = 60 * 10;
    const allPaths: string[] = [];
    for (const c of cardRows) {
      const dp = (c.display_path as string | null) ?? null;
      const tp = (c.thumbnail_path as string | null) ?? null;
      if (dp) allPaths.push(dp);
      if (tp) allPaths.push(tp);
    }
    const deckRow = deck as Record<string, NonNullable<unknown>>;
    const backPath = (deckRow.card_back_path as string | null) ?? null;
    const backThumbPath = (deckRow.card_back_thumb_path as string | null) ?? null;
    if (backPath) allPaths.push(backPath);
    if (backThumbPath) allPaths.push(backThumbPath);
    const signedByPath: Record<string, string> = {};
    if (allPaths.length > 0) {
      // dedupe
      const unique = Array.from(new Set(allPaths));
      const { data: signedArr } = await supabaseAdmin.storage
        .from(DECK_BUCKET)
        .createSignedUrls(unique, expirySecs);
      for (const entry of signedArr ?? []) {
        if (entry.path && entry.signedUrl) {
          signedByPath[entry.path] = entry.signedUrl;
        }
      }
    }
    return {
      deck: deckRow,
      cards: cardRows,
      signed_urls: signedByPath,
    };
  });

/**
 * EK37 — Toggle a user's AI features access.
 *
 * Three-state per-user override:
 *   true  → explicit grant
 *   false → explicit revoke
 *   null  → defer to global default
 *
 * The admin Users column passes true/false directly (one-tap grant or
 * revoke). The drill-down may later expose "clear override" which sets
 * null to let the user follow the global default.
 *
 * Super admin only. Logs to audit_log so the grant trail is durable.
 */
export const setUserAIFeatures = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        targetUserId: z.string().uuid(),
        enabled: z.union([z.boolean(), z.null()]),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    // Upsert the per-user override. The migration backfilled every
    // existing user_preferences row, but new signups might not yet
    // have a row — upsert covers both.
    const { error } = await supabaseAdmin
      .from("user_preferences" as never)
      .upsert(
        {
          user_id: data.targetUserId,
          ai_features_enabled: data.enabled,
        } as never,
        { onConflict: "user_id" },
      );
    if (error) throw new Error(error.message);

    // EK37 — Audit log entry for the grant trail.
    try {
      await supabaseAdmin.from("audit_log" as never).insert({
        actor_user_id: userId,
        target_user_id: data.targetUserId,
        action: "ai_features_set",
        details: { enabled: data.enabled },
      } as never);
    } catch {
      /* audit log is best-effort */
    }

    return { ok: true, ai_features_enabled: data.enabled };
  });
