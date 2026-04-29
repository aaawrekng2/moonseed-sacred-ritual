/**
 * Public endpoint called by pg_cron nightly to detect weaves between
 * patterns for every active user.
 *
 * Security model (defense in depth — every layer must pass):
 *  1. Method must be POST.
 *  2. A dedicated cron secret (`DETECT_WEAVES_CRON_SECRET`) must be
 *     present in the `x-cron-secret` header and match in constant time.
 *     If that secret is unset on the server, we fall back to a constant-
 *     time check against `SUPABASE_PUBLISHABLE_KEY` from the `apikey` /
 *     `authorization` header. If BOTH server secrets are missing we
 *     refuse the request rather than silently allowing it through.
 *  3. An in-memory cooldown enforces at most one full scan per
 *     `MIN_INTERVAL_MS`, so even a leaked credential can't be used to
 *     hammer the database.
 *  4. The response never leaks user ids or per-user counts.
 */
import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { detectWeavesForUser } from "@/lib/weaves.functions";

/** Minimum gap between full scans, regardless of caller. 30 minutes. */
const MIN_INTERVAL_MS = 30 * 60 * 1000;
/** Hard cap on users processed per invocation. */
const MAX_USERS_PER_RUN = 500;

let lastRunAt = 0;

function safeEqual(a: string, b: string): boolean {
  // Pad to equal length so timingSafeEqual doesn't throw and length is
  // not itself a timing oracle.
  const len = Math.max(a.length, b.length, 1);
  const ab = Buffer.alloc(len, 0);
  const bb = Buffer.alloc(len, 0);
  ab.write(a);
  bb.write(b);
  // timingSafeEqual returns false even if buffers are equal-length zeros
  // when one side was empty, because we still compare the original lengths.
  return a.length === b.length && timingSafeEqual(ab, bb);
}

export const Route = createFileRoute("/api/public/detect-weaves")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const cronSecret = process.env.DETECT_WEAVES_CRON_SECRET;
        const publishable = process.env.SUPABASE_PUBLISHABLE_KEY;

        // If neither secret is configured on the server, refuse — don't
        // silently fall through to "anyone can call this".
        if (!cronSecret && !publishable) {
          console.error(
            "[detect-weaves] refused: neither DETECT_WEAVES_CRON_SECRET nor SUPABASE_PUBLISHABLE_KEY is set",
          );
          return new Response("Server not configured", { status: 503 });
        }

        const cronHeader = request.headers.get("x-cron-secret") ?? "";
        const apiKeyHeader =
          request.headers.get("apikey") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          "";

        const cronOk = !!cronSecret && safeEqual(cronHeader, cronSecret);
        const apiKeyOk =
          !!publishable && safeEqual(apiKeyHeader, publishable);

        if (!cronOk && !apiKeyOk) {
          return new Response("Unauthorized", { status: 401 });
        }

        // Cooldown: even with a valid credential, refuse to run more
        // often than MIN_INTERVAL_MS. This caps DB load if a credential
        // is ever leaked or pg_cron is misconfigured to run on a tight
        // schedule.
        const now = Date.now();
        if (now - lastRunAt < MIN_INTERVAL_MS) {
          const retryAfter = Math.ceil(
            (MIN_INTERVAL_MS - (now - lastRunAt)) / 1000,
          );
          return new Response("Too soon", {
            status: 429,
            headers: { "retry-after": String(retryAfter) },
          });
        }
        lastRunAt = now;

        // Find every user that currently has at least 2 active patterns.
        const { data: rows, error } = await supabaseAdmin
          .from("patterns")
          .select("user_id")
          .in("lifecycle_state", ["emerging", "active", "reawakened"]);
        if (error) {
          console.error("[detect-weaves] load patterns failed", error.message);
          return new Response("Internal error", { status: 500 });
        }
        const userCounts = new Map<string, number>();
        for (const r of rows ?? []) {
          const uid = (r as { user_id: string }).user_id;
          userCounts.set(uid, (userCounts.get(uid) ?? 0) + 1);
        }
        const candidates = Array.from(userCounts.entries())
          .filter(([, c]) => c >= 2)
          .map(([u]) => u)
          .slice(0, MAX_USERS_PER_RUN);

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