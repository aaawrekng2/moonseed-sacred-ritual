/**
 * Q35a — Admin feedback panel server functions.
 * Mirrors the admin pattern in admin-usage.functions.ts:
 *   - requireSupabaseAuth middleware
 *   - assertAdmin via has_admin_role RPC
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_admin_role", {
    _user_id: userId,
  });
  if (error || data !== true) throw new Error("not authorized");
}

export type AdminFeedbackItem = {
  id: string;
  title: string;
  description: string | null;
  category: "bug" | "feature";
  status:
    | "pending"
    | "under_review"
    | "planned"
    | "in_progress"
    | "done"
    | "dismissed";
  admin_note: string | null;
  created_at: string;
  approved_at: string | null;
  user_id: string;
  submitter_email: string | null;
  submitter_name: string | null;
  voteCount: number;
};

async function withSubmitterAndVotes(
  rows: Array<{
    id: string;
    title: string;
    description: string | null;
    category: "bug" | "feature";
    status: AdminFeedbackItem["status"];
    admin_note: string | null;
    created_at: string;
    approved_at: string | null;
    user_id: string;
  }>,
): Promise<AdminFeedbackItem[]> {
  if (rows.length === 0) return [];
  const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
  const ids = rows.map((r) => r.id);

  const [{ data: prefs }, { data: votes }] = await Promise.all([
    supabaseAdmin
      .from("user_preferences" as never)
      .select("user_id,display_name")
      .in("user_id", userIds),
    supabaseAdmin
      .from("feedback_votes" as never)
      .select("post_id")
      .in("post_id", ids),
  ]);

  const nameMap = new Map<string, string | null>();
  for (const p of (prefs ?? []) as Array<{
    user_id: string;
    display_name: string | null;
  }>) {
    nameMap.set(p.user_id, p.display_name);
  }

  // Pull emails via auth admin for each user
  const emailMap = new Map<string, string | null>();
  await Promise.all(
    userIds.map(async (uid) => {
      try {
        const { data } = await supabaseAdmin.auth.admin.getUserById(uid);
        emailMap.set(uid, data.user?.email ?? null);
      } catch {
        emailMap.set(uid, null);
      }
    }),
  );

  const counts = new Map<string, number>();
  for (const v of (votes ?? []) as Array<{ post_id: string }>) {
    counts.set(v.post_id, (counts.get(v.post_id) ?? 0) + 1);
  }

  return rows.map((r) => ({
    ...r,
    submitter_email: emailMap.get(r.user_id) ?? null,
    submitter_name: nameMap.get(r.user_id) ?? null,
    voteCount: counts.get(r.id) ?? 0,
  }));
}

export const getPendingFeedback = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data } = await supabaseAdmin
      .from("feedback_posts" as never)
      .select(
        "id,title,description,category,status,admin_note,created_at,approved_at,user_id",
      )
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    return await withSubmitterAndVotes((data ?? []) as never);
  });

export const getAllFeedback = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data } = await supabaseAdmin
      .from("feedback_posts" as never)
      .select(
        "id,title,description,category,status,admin_note,created_at,approved_at,user_id",
      )
      .not("status", "in", "(pending,dismissed,done)")
      .order("created_at", { ascending: false });
    const items = await withSubmitterAndVotes((data ?? []) as never);
    items.sort((a, b) => b.voteCount - a.voteCount);
    return items;
  });

export const getArchivedFeedback = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data } = await supabaseAdmin
      .from("feedback_posts" as never)
      .select(
        "id,title,description,category,status,admin_note,created_at,approved_at,user_id",
      )
      .in("status", ["dismissed", "done"])
      .order("created_at", { ascending: false });
    return await withSubmitterAndVotes((data ?? []) as never);
  });

export const approveFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ postId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    await supabaseAdmin
      .from("feedback_posts" as never)
      .update({
        status: "under_review",
        approved_at: new Date().toISOString(),
      } as never)
      .eq("id", data.postId);
    return { ok: true };
  });

export const dismissFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ postId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    await supabaseAdmin
      .from("feedback_posts" as never)
      .update({ status: "dismissed" } as never)
      .eq("id", data.postId);
    return { ok: true };
  });

export const updateFeedbackStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        postId: z.string().uuid(),
        status: z.enum(["under_review", "planned", "in_progress", "done"]),
        adminNote: z.string().max(2000).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const update: Record<string, unknown> = { status: data.status };
    if (data.adminNote !== undefined) update.admin_note = data.adminNote;
    await supabaseAdmin
      .from("feedback_posts" as never)
      .update(update as never)
      .eq("id", data.postId);
    return { ok: true };
  });