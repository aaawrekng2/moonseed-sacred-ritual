/**
 * Q35a — Feedback system server functions (seeker-facing).
 *
 * All callers must include an Authorization Bearer header (handled
 * by the existing `requireSupabaseAuth` middleware).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/* ---------- submitFeedback ---------- */

export const submitFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        title: z.string().min(1).max(100),
        description: z.string().max(500).optional().nullable(),
        category: z.enum(["bug", "feature"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: row, error } = await supabaseAdmin
      .from("feedback_posts" as never)
      .insert({
        user_id: userId,
        title: data.title.trim(),
        description: data.description?.trim() || null,
        category: data.category,
        status: "pending",
      } as never)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: (row as { id: string }).id };
  });

/* ---------- getFeedbackBoard ---------- */

export type FeedbackBoardItem = {
  id: string;
  title: string;
  description: string | null;
  category: "bug" | "feature";
  status: "under_review" | "planned" | "in_progress" | "done";
  created_at: string;
  voteCount: number;
  userHasVoted: boolean;
};

export const getFeedbackBoard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FeedbackBoardItem[]> => {
    const { userId } = context;
    const { data: posts } = await supabaseAdmin
      .from("feedback_posts" as never)
      .select("id,title,description,category,status,created_at")
      .not("status", "in", "(pending,dismissed)")
      .order("created_at", { ascending: false });

    const rows = (posts ?? []) as Array<{
      id: string;
      title: string;
      description: string | null;
      category: "bug" | "feature";
      status: FeedbackBoardItem["status"];
      created_at: string;
    }>;
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const { data: votes } = await supabaseAdmin
      .from("feedback_votes" as never)
      .select("post_id,user_id")
      .in("post_id", ids);
    const voteRows =
      (votes ?? []) as Array<{ post_id: string; user_id: string }>;

    const counts = new Map<string, number>();
    const mine = new Set<string>();
    for (const v of voteRows) {
      counts.set(v.post_id, (counts.get(v.post_id) ?? 0) + 1);
      if (v.user_id === userId) mine.add(v.post_id);
    }

    const out: FeedbackBoardItem[] = rows.map((r) => ({
      ...r,
      voteCount: counts.get(r.id) ?? 0,
      userHasVoted: mine.has(r.id),
    }));
    out.sort((a, b) => {
      if (b.voteCount !== a.voteCount) return b.voteCount - a.voteCount;
      return b.created_at.localeCompare(a.created_at);
    });
    return out;
  });

/* ---------- getMyPendingPosts ---------- */

export const getMyPendingPosts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { data } = await supabaseAdmin
      .from("feedback_posts" as never)
      .select("id,title,category,created_at")
      .eq("user_id", userId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    return (data ?? []) as Array<{
      id: string;
      title: string;
      category: "bug" | "feature";
      created_at: string;
    }>;
  });

/* ---------- toggleVote ---------- */

export const toggleVote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ postId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: existing } = await supabaseAdmin
      .from("feedback_votes" as never)
      .select("id")
      .eq("post_id", data.postId)
      .eq("user_id", userId)
      .maybeSingle();

    let voted: boolean;
    if (existing) {
      await supabaseAdmin
        .from("feedback_votes" as never)
        .delete()
        .eq("id", (existing as { id: string }).id);
      voted = false;
    } else {
      await supabaseAdmin
        .from("feedback_votes" as never)
        .insert({ post_id: data.postId, user_id: userId } as never);
      voted = true;
    }

    const { count } = await supabaseAdmin
      .from("feedback_votes" as never)
      .select("id", { count: "exact", head: true })
      .eq("post_id", data.postId);

    return { voted, voteCount: count ?? 0 };
  });