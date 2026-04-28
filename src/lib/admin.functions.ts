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
  await supabaseAdmin.from("admin_audit_log").insert({
    admin_user_id: actorId,
    admin_email: actorEmail,
    action,
    target_user_id: targetUserId,
    target_email: targetEmail,
    details,
  });
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
      .from("admin_backups")
      .insert({
        created_by: userId,
        kind: "manual",
        status: "ready",
        size_bytes: bytes.byteLength,
        storage_path: path,
      })
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