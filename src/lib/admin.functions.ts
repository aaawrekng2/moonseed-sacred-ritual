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
import {
  detectWeavesForUser,
  previewWeavesForUser,
  type WeavePreview,
} from "@/lib/weaves.functions";
import { evaluateDetectWeavesAlerts } from "@/lib/detect-weaves-alerts.server";

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

    // CQ — paginate listUsers so growth past 1000 is visible. Safety
    // cap at 100k to avoid runaway loops.
    const allUsers: Array<Awaited<ReturnType<typeof supabaseAdmin.auth.admin.listUsers>>["data"]["users"][number]> = [];
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

    // CQ — filter anonymous users out of the admin Users tab. Anonymous
    // sessions are surfaced as a count on the Dashboard instead. Always
    // keep admins visible even if their email is somehow missing.
    return allUsers
      .filter((u) => {
        if (u.email) return true;
        const p = prefMap.get(u.id);
        if (p?.role === "admin" || p?.role === "super_admin") return true;
        return false;
      })
      .map((u) => {
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
  z.object({ type: z.literal("extend_premium"), targetUserId: z.string().uuid(), months: z.number().int().positive() }),
  z.object({ type: z.literal("revoke_premium"), targetUserId: z.string().uuid() }),
  z.object({ type: z.literal("assign_admin"), targetUserId: z.string().uuid(), role: z.enum(["admin", "super_admin"]) }),
  z.object({ type: z.literal("remove_admin"), targetUserId: z.string().uuid() }),
  z.object({ type: z.literal("password_reset"), targetUserId: z.string().uuid() }),
  z.object({ type: z.literal("deactivate_user"), targetUserId: z.string().uuid() }),
  z.object({ type: z.literal("reactivate_user"), targetUserId: z.string().uuid() }),
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

    // CQ — extra self-protection for deactivate. UI hides the button
    // when the target is the current admin, but defend the server too.
    if (data.type === "deactivate_user" && data.targetUserId === userId) {
      throw new Error("cannot deactivate self");
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
      case "extend_premium": {
        // Extend from the existing expiration if still in the future,
        // otherwise extend from now.
        const { data: current } = await supabaseAdmin
          .from("user_preferences")
          .select("premium_expires_at")
          .eq("user_id", data.targetUserId)
          .maybeSingle();
        const prev = (current as { premium_expires_at?: string | null } | null)
          ?.premium_expires_at;
        const base =
          prev && new Date(prev).getTime() > Date.now()
            ? new Date(prev)
            : new Date();
        base.setMonth(base.getMonth() + data.months);
        await supabaseAdmin
          .from("user_preferences")
          .update({
            is_premium: true,
            subscription_type: "gifted",
            premium_expires_at: base.toISOString(),
          })
          .eq("user_id", data.targetUserId);
        await logAction(
          userId,
          actorEmail,
          "extend_premium",
          data.targetUserId,
          targetEmail,
          { months: data.months, previous_expires_at: prev ?? null, expires_at: base.toISOString() },
        );
        break;
      }
      case "revoke_premium": {
        const { data: prevRow } = await supabaseAdmin
          .from("user_preferences")
          .select("premium_expires_at")
          .eq("user_id", data.targetUserId)
          .maybeSingle();
        await supabaseAdmin
          .from("user_preferences")
          .update({
            is_premium: false,
            subscription_type: "none",
            premium_expires_at: null,
          })
          .eq("user_id", data.targetUserId);
        await logAction(userId, actorEmail, "revoke_premium", data.targetUserId, targetEmail, {
          previous_expires_at:
            (prevRow as { premium_expires_at?: string | null } | null)
              ?.premium_expires_at ?? null,
        });
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
          const { inserted, existing } = await detectWeavesForUser(
            supabaseAdmin,
            uid,
          );
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
        const { would_create, already_existing } = await previewWeavesForUser(
          supabaseAdmin,
          uid,
        );
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
  .inputValidator((input: unknown) =>
    z.object({ alertId: z.string().uuid() }).parse(input),
  )
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

    await logAction(
      userId,
      actorEmail,
      "resolve_detect_weaves_alert",
      null,
      null,
      { alert_id: data.alertId },
    );
    return { ok: true } as const;
  });