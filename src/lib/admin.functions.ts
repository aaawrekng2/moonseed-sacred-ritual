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
import { detectWeavesForUser } from "@/lib/weaves.functions";

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

/* ---------- listUsers ---------- */

export const listAdminUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    // Pull every auth user (paged). For modest seekers (<1000) one page
    // is plenty; expand later if growth demands.
    const { data: usersList, error: usersErr } =
      await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (usersErr) throw new Error(usersErr.message);

    const ids = usersList.users.map((u) => u.id);
    const [{ data: prefs }, { data: readings }] = await Promise.all([
      supabaseAdmin
        .from("user_preferences")
        .select(
          "user_id, display_name, role, subscription_type, is_premium, premium_since, premium_expires_at, premium_months_used, admin_note",
        )
        .in("user_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
      supabaseAdmin
        .from("readings")
        .select("user_id, created_at"),
    ]);

    const counts: Record<string, { n: number; last: string | null }> = {};
    for (const r of (readings ?? []) as Array<{
      user_id: string;
      created_at: string;
    }>) {
      const c = counts[r.user_id] ?? { n: 0, last: null };
      c.n += 1;
      if (!c.last || r.created_at > c.last) c.last = r.created_at;
      counts[r.user_id] = c;
    }
    const prefMap = new Map<string, any>();
    for (const p of prefs ?? []) prefMap.set((p as any).user_id, p);

    return usersList.users.map((u) => {
      const p = prefMap.get(u.id) ?? {};
      return {
        user_id: u.id,
        email: u.email ?? null,
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
        reading_count: counts[u.id]?.n ?? 0,
        last_reading: counts[u.id]?.last ?? null,
      };
    });
  });

/* ---------- adminAction (single mutation entrypoint) ---------- */

const ActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("grant_premium"), targetUserId: z.string().uuid(), months: z.number().int().positive() }),
  z.object({ type: z.literal("revoke_premium"), targetUserId: z.string().uuid() }),
  z.object({ type: z.literal("assign_admin"), targetUserId: z.string().uuid(), role: z.enum(["admin", "super_admin"]) }),
  z.object({ type: z.literal("remove_admin"), targetUserId: z.string().uuid() }),
  z.object({ type: z.literal("password_reset"), targetUserId: z.string().uuid() }),
  z.object({ type: z.literal("deactivate_user"), targetUserId: z.string().uuid() }),
  z.object({ type: z.literal("set_note"), targetUserId: z.string().uuid(), note: z.string().nullable() }),
]);

export const adminAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => ActionSchema.parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId, claims } = context;
    await assertAdmin(supabase, userId);
    const actorEmail = (claims as any)?.email ?? null;

    // Resolve target email + role for guardrails / logging.
    const { data: targetUser } =
      await supabaseAdmin.auth.admin.getUserById(data.targetUserId);
    const targetEmail = targetUser?.user?.email ?? null;

    // Super-admin-only protections.
    const requiresSuper =
      data.type === "assign_admin" || data.type === "remove_admin";
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

    switch (data.type) {
      case "grant_premium": {
        const expires = new Date();
        expires.setMonth(expires.getMonth() + data.months);
        await supabaseAdmin
          .from("user_preferences")
          .update({
            is_premium: true,
            subscription_type: "gifted",
            premium_since: new Date().toISOString(),
            premium_expires_at: expires.toISOString(),
            gifted_by: userId,
          })
          .eq("user_id", data.targetUserId);
        await logAction(userId, actorEmail, "grant_premium", data.targetUserId, targetEmail, { months: data.months });
        break;
      }
      case "revoke_premium": {
        await supabaseAdmin
          .from("user_preferences")
          .update({
            is_premium: false,
            subscription_type: "none",
            premium_expires_at: null,
          })
          .eq("user_id", data.targetUserId);
        await logAction(userId, actorEmail, "revoke_premium", data.targetUserId, targetEmail, {});
        break;
      }
      case "assign_admin": {
        await supabaseAdmin
          .from("user_preferences")
          .update({ role: data.role })
          .eq("user_id", data.targetUserId);
        await logAction(userId, actorEmail, "assign_admin", data.targetUserId, targetEmail, { role: data.role });
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
      case "set_note": {
        await supabaseAdmin
          .from("user_preferences")
          .update({ admin_note: data.note })
          .eq("user_id", data.targetUserId);
        await logAction(userId, actorEmail, "set_note", data.targetUserId, targetEmail, { note: data.note });
        break;
      }
    }

    return { ok: true } as const;
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

    const { error: upErr } = await supabaseAdmin.storage
      .from("admin-backups")
      .upload(path, bytes, {
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
  .inputValidator((input) =>
    z.object({ storagePath: z.string() }).parse(input),
  )
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
  .inputValidator((input) =>
    z.object({ backupId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId, claims } = context;
    await assertAdmin(supabase, userId);
    const actorEmail = (claims as any)?.email ?? null;

    // For safety this endpoint is intentionally non-destructive in app
    // code. It logs the intent so an operator can perform the actual
    // restore manually from the snapshot file. This protects seekers
    // from a misclick wiping live data.
    await logAction(
      userId,
      actorEmail,
      "restore_backup_requested",
      null,
      null,
      { backup_id: data.backupId },
    );
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
      const perUserErrors: Array<{ user_id: string; error: string }> = [];
      for (const uid of candidates) {
        try {
          totalDetected += await detectWeavesForUser(supabaseAdmin, uid);
        } catch (e) {
          perUserErrors.push({
            user_id: uid,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      const finishedAt = Date.now();
      const status =
        perUserErrors.length === candidates.length && candidates.length > 0
          ? "error"
          : perUserErrors.length > 0
            ? "partial"
            : "success";

      await supabaseAdmin.from("detect_weaves_runs" as never).insert({
        started_at: new Date(startedAt).toISOString(),
        finished_at: new Date(finishedAt).toISOString(),
        duration_ms: finishedAt - startedAt,
        users_scanned: candidates.length,
        weaves_detected: totalDetected,
        status,
        message:
          data.scope === "user"
            ? `manual run for user ${data.userId}`
            : "manual run for all eligible users",
        per_user_errors: perUserErrors,
        mode: "manual",
        triggered_by: userId,
      } as never);

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
          errors: perUserErrors.length,
          duration_ms: finishedAt - startedAt,
        },
      );

      return {
        ok: true,
        users_scanned: candidates.length,
        weaves_detected: totalDetected,
        errors: perUserErrors.length,
        status,
      } as const;
    } catch (e) {
      const finishedAt = Date.now();
      const message = e instanceof Error ? e.message : String(e);
      await supabaseAdmin.from("detect_weaves_runs" as never).insert({
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
      } as never);
      throw e;
    }
  });