/**
 * Public endpoint called by pg_cron nightly to detect weaves between
 * patterns for every active user.
 *
 * Security model (defense in depth — every layer must pass):
 *  1. Method must be POST.
 *  2. A dedicated cron secret (`DETECT_WEAVES_CRON_SECRET`) MUST be
 *     present in the `x-cron-secret` header and match in constant time.
 *     There is intentionally no fallback to the publishable key, since
 *     that key is embedded in every browser bundle and is not a secret.
 *     If the server secret is unset we refuse the request entirely.
 *  3. An in-memory cooldown enforces at most one full scan per
 *     `MIN_INTERVAL_MS`, so even a leaked credential can't be used to
 *     hammer the database.
 *  4. The response never leaks user ids or per-user counts.
 */
import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { detectWeavesForUser } from "@/lib/weaves.functions";
import { evaluateDetectWeavesAlerts } from "@/lib/detect-weaves-alerts.server";

/** Minimum gap between full scans, regardless of caller. 30 minutes. */
const MIN_INTERVAL_MS = 30 * 60 * 1000;
/** Hard cap on users processed per invocation. */
const MAX_USERS_PER_RUN = 500;

let lastRunAt = 0;

type RunStatus = "success" | "partial" | "refused" | "error";
type PerUserError = { user_id: string; error: string };

async function recordRun(opts: {
  startedAt: number;
  status: RunStatus;
  usersScanned?: number;
  weavesDetected?: number;
  weavesExisting?: number;
  message?: string;
  perUserErrors?: PerUserError[];
}): Promise<string | null> {
  const finishedAt = Date.now();
  try {
    const { data, error } = await supabaseAdmin
      .from("detect_weaves_runs")
      .insert({
        started_at: new Date(opts.startedAt).toISOString(),
        finished_at: new Date(finishedAt).toISOString(),
        duration_ms: finishedAt - opts.startedAt,
        users_scanned: opts.usersScanned ?? 0,
        weaves_detected: opts.weavesDetected ?? 0,
        weaves_existing: opts.weavesExisting ?? 0,
        status: opts.status,
        message: opts.message ?? null,
        per_user_errors: opts.perUserErrors ?? [],
      })
      .select("id")
      .single();
    if (error) throw error;
    return (data as { id: string }).id;
  } catch (e) {
    // Logging must never break the run itself.
    console.error("[detect-weaves] failed to persist run log", e);
    return null;
  }
}

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
        const startedAt = Date.now();
        const cronSecret = process.env.DETECT_WEAVES_CRON_SECRET;

        // If the server secret isn't configured, refuse — never fall
        // through to a publishable / anon key, which is not secret.
        if (!cronSecret) {
          console.error(
            "[detect-weaves] refused: DETECT_WEAVES_CRON_SECRET is not set",
          );
          await recordRun({
            startedAt,
            status: "refused",
            message: "DETECT_WEAVES_CRON_SECRET is not set",
          });
          return new Response("Server not configured", { status: 503 });
        }

        const cronHeader = request.headers.get("x-cron-secret") ?? "";
        if (!safeEqual(cronHeader, cronSecret)) {
          // Don't log unauthorized attempts to the runs table — those
          // are not real scans and would let an attacker spam logs.
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
          await recordRun({
            startedAt,
            status: "refused",
            message: `cooldown active, retry after ${retryAfter}s`,
          });
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
          const failedRunId = await recordRun({
            startedAt,
            status: "error",
            message: `load patterns failed: ${error.message}`,
          });
          if (failedRunId) {
            await evaluateDetectWeavesAlerts(failedRunId).catch((err) =>
              console.error("[detect-weaves alerts] eval failed", err),
            );
          }
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
        let totalExisting = 0;
        const perUserErrors: PerUserError[] = [];
        for (const userId of candidates) {
          try {
            const { inserted, existing } = await detectWeavesForUser(
              supabaseAdmin,
              userId,
            );
            totalDetected += inserted;
            totalExisting += existing;
          } catch (e) {
            console.error("[detect-weaves cron] user failed", userId, e);
            perUserErrors.push({
              user_id: userId,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
        const finishedRunId = await recordRun({
          startedAt,
          status: perUserErrors.length > 0 ? "partial" : "success",
          usersScanned: candidates.length,
          weavesDetected: totalDetected,
          weavesExisting: totalExisting,
          perUserErrors,
        });
        if (finishedRunId) {
          await evaluateDetectWeavesAlerts(finishedRunId).catch((err) =>
            console.error("[detect-weaves alerts] eval failed", err),
          );
        }
        return Response.json({
          ok: true,
          users_scanned: candidates.length,
          weaves_detected: totalDetected,
          weaves_existing: totalExisting,
          errors: perUserErrors.length,
        });
      },
    },
  },
});