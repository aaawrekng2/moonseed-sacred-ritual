/**
 * Q96 #1 — Daily feedback digest sender.
 *
 * Queries admins who opted into daily digests, gathers feedback_posts
 * from the last 24h (status = 'pending'), and enqueues one digest email
 * per admin via the `enqueue_email` RPC (transactional_emails queue).
 *
 * Wrapped in try/catch — never throws. Called by the route at
 * src/routes/lovable/email/feedback-digest.ts which is invoked by
 * pg_cron.
 *
 * -- Run once in Supabase SQL editor:
 * -- SELECT cron.schedule(
 * --   'feedback-digest-daily',
 * --   '0 8 * * *',
 * --   $$SELECT net.http_post(
 * --     url:='https://YOUR_PROJECT_REF.supabase.co/functions/v1/lovable/email/feedback-digest',
 * --     headers:='{"Authorization":"Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb
 * --   )$$
 * -- );
 * -- TODO: Replace YOUR_PROJECT_REF and YOUR_SERVICE_ROLE_KEY with
 * -- actual values from Supabase dashboard → Settings → API.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export async function sendFeedbackDigest(): Promise<void> {
  try {
    const { data: admins } = await supabaseAdmin
      .from("user_preferences")
      .select(
        "user_id, feedback_notification_email, feedback_notification_frequency",
      )
      .in("role", ["admin", "super_admin"])
      .eq("feedback_notifications_enabled", true)
      .eq("feedback_notification_frequency", "daily");
    const rows =
      (admins ?? []) as Array<{
        user_id: string;
        feedback_notification_email: string | null;
      }>;
    if (rows.length === 0) return;

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: posts } = await supabaseAdmin
      .from("feedback_posts" as never)
      .select("id,title,category,created_at")
      .eq("status", "pending")
      .gte("created_at", since)
      .order("created_at", { ascending: false });
    const postRows =
      (posts ?? []) as Array<{
        id: string;
        title: string;
        category: "bug" | "feature";
        created_at: string;
      }>;
    if (postRows.length === 0) return;

    const subject = `📝 Tarot Seed feedback digest — ${postRows.length} new item${
      postRows.length === 1 ? "" : "s"
    }`;
    const html = `<h2>New feedback in the last 24 hours</h2><ul>${postRows
      .map(
        (p) =>
          `<li><strong>[${p.category.toUpperCase()}]</strong> ${escapeHtml(
            p.title,
          )}</li>`,
      )
      .join("")}</ul><p><a href="/admin">Open admin dashboard</a></p>`;
    const text = `New feedback in the last 24 hours:\n\n${postRows
      .map((p) => `- [${p.category.toUpperCase()}] ${p.title}`)
      .join("\n")}\n\nOpen admin dashboard: /admin`;

    for (const r of rows) {
      let to = r.feedback_notification_email;
      if (!to) {
        try {
          const { data } = await supabaseAdmin.auth.admin.getUserById(
            r.user_id,
          );
          to = data?.user?.email ?? null;
        } catch {
          continue;
        }
      }
      if (!to) continue;
      const { error } = await supabaseAdmin.rpc("enqueue_email" as never, {
        p_queue: "transactional_emails",
        p_payload: {
          to,
          subject,
          html,
          text,
          template_name: "feedback_digest",
        },
      } as never);
      if (error) {
        console.warn(
          "[feedback-digest] enqueue_email skipped:",
          error.message,
        );
        return;
      }
    }
  } catch (e) {
    console.warn(
      "[feedback-digest] failed:",
      e instanceof Error ? e.message : String(e),
    );
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}