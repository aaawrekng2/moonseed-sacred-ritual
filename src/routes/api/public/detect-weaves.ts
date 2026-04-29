/**
 * Public endpoint called by pg_cron nightly to detect weaves between
 * patterns for every active user.
 *
 * Security: pg_cron passes the project's anon/publishable key via the
 * `apikey` header. The handler verifies it matches the server's
 * `SUPABASE_PUBLISHABLE_KEY` env var before doing anything.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { detectWeavesForUser } from "@/lib/weaves.functions";

export const Route = createFileRoute("/api/public/detect-weaves")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!expected) {
          return new Response("Server not configured", { status: 500 });
        }
        const provided =
          request.headers.get("apikey") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          "";
        if (provided !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        // Find every user that currently has at least 2 active patterns.
        const { data: rows, error } = await supabaseAdmin
          .from("patterns")
          .select("user_id")
          .in("lifecycle_state", ["emerging", "active", "reawakened"]);
        if (error) {
          return new Response(`Failed to load patterns: ${error.message}`, {
            status: 500,
          });
        }
        const userCounts = new Map<string, number>();
        for (const r of rows ?? []) {
          const uid = (r as { user_id: string }).user_id;
          userCounts.set(uid, (userCounts.get(uid) ?? 0) + 1);
        }
        const candidates = Array.from(userCounts.entries())
          .filter(([, c]) => c >= 2)
          .map(([u]) => u);

        let totalDetected = 0;
        for (const userId of candidates) {
          try {
            totalDetected += await detectWeavesForUser(supabaseAdmin, userId);
          } catch (e) {
            console.error("[detect-weaves cron] user failed", userId, e);
          }
        }
        return Response.json({
          ok: true,
          users_scanned: candidates.length,
          weaves_detected: totalDetected,
        });
      },
    },
  },
});