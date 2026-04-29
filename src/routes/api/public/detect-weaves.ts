/**
 * Public endpoint called by pg_cron nightly to detect weaves between
 * patterns for every active user.
 *
 * Security: protected by a shared bearer token (the Supabase service
 * role key). pg_cron passes it via the apikey header.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { detectWeavesForUser } from "@/lib/weaves.functions";

export const Route = createFileRoute("/api/public/detect-weaves")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = process.env.SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!url || !serviceKey) {
          return new Response("Server not configured", { status: 500 });
        }
        const auth =
          request.headers.get("authorization") ??
          request.headers.get("apikey") ??
          "";
        const token = auth.replace(/^Bearer\s+/i, "");
        if (token !== serviceKey) {
          return new Response("Unauthorized", { status: 401 });
        }

        const admin = createClient<Database>(url, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        // Find every user that currently has at least 2 active patterns.
        const { data: rows, error } = await admin
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
            totalDetected += await detectWeavesForUser(admin, userId);
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