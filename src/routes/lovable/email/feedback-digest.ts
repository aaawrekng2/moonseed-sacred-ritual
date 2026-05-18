/**
 * Q96 #1 — pg_cron-invoked endpoint that triggers the daily feedback
 * digest send. Authenticated with the SUPABASE_SERVICE_ROLE_KEY as a
 * Bearer token (same pattern as /lovable/email/queue/process.ts).
 */
import { createFileRoute } from "@tanstack/react-router";
import { sendFeedbackDigest } from "@/lib/feedback-digest.server";

export const Route = createFileRoute("/lovable/email/feedback-digest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supabaseServiceKey) {
          return Response.json(
            { error: "Server configuration error" },
            { status: 500 },
          );
        }

        const authHeader = request.headers.get("Authorization");
        if (!authHeader?.startsWith("Bearer ")) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }
        const token = authHeader.slice("Bearer ".length).trim();
        if (token !== supabaseServiceKey) {
          return Response.json({ error: "Forbidden" }, { status: 403 });
        }

        await sendFeedbackDigest();
        return Response.json({ ok: true });
      },
    },
  },
});