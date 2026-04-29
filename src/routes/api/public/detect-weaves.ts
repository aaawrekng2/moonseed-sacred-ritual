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
 *  3. A database-backed cooldown (advisory lock + singleton row, see
 *     `try_acquire_detect_weaves_slot`) enforces at most one full scan
 *     per `MIN_INTERVAL_MS` across server restarts and multiple instances.
 *     Even a leaked credential can't be used to hammer the database.
 *  4. The response never leaks user ids or per-user counts.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { detectWeavesForUser } from "@/lib/weaves.functions";
import { evaluateDetectWeavesAlerts } from "@/lib/detect-weaves-alerts.server";
import {
  DEFAULT_MAX_USERS_PER_RUN,
  DEFAULT_MIN_INTERVAL_MS,
  runDetectWeaves,
  type DetectWeavesDeps,
  type RunRecordInput,
} from "@/lib/detect-weaves-runner.server";

async function recordRun(opts: RunRecordInput): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("detect_weaves_runs")
      .insert({
        started_at: new Date(opts.startedAt).toISOString(),
        finished_at: new Date(opts.finishedAt).toISOString(),
        duration_ms: opts.finishedAt - opts.startedAt,
        users_scanned: opts.usersScanned,
        weaves_detected: opts.weavesDetected,
        weaves_existing: opts.weavesExisting,
        status: opts.status,
        message: opts.message,
        per_user_errors: opts.perUserErrors,
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

/**
 * Calls the security-definer function in Postgres that atomically:
 *   - takes a transaction-scoped advisory lock,
 *   - checks the persisted `last_run_at`,
 *   - and either stamps a new run time (acquired) or reports
 *     how many seconds remain on the cooldown.
 */
async function tryAcquireSlot(
  minIntervalMs: number,
): Promise<{ acquired: boolean; retryAfterSeconds: number }> {
  const minSeconds = Math.max(0, Math.ceil(minIntervalMs / 1000));
  const { data, error } = await supabaseAdmin.rpc(
    "try_acquire_detect_weaves_slot",
    { _min_interval_seconds: minSeconds },
  );
  if (error) {
    throw new Error(`try_acquire_detect_weaves_slot rpc failed: ${error.message}`);
  }
  // Postgres function returns a single-row table.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    throw new Error("try_acquire_detect_weaves_slot returned no row");
  }
  const r = row as { acquired: boolean; retry_after_seconds: number | null };
  return {
    acquired: !!r.acquired,
    retryAfterSeconds: Number(r.retry_after_seconds ?? minSeconds),
  };
}

export const Route = createFileRoute("/api/public/detect-weaves")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const deps: DetectWeavesDeps = {
          now: () => Date.now(),
          recordRun,
          tryAcquireSlot,
          loadActivePatternUserIds: async () => {
            const { data, error } = await supabaseAdmin
              .from("patterns")
              .select("user_id")
              .in("lifecycle_state", ["emerging", "active", "reawakened"]);
            if (error) return { rows: null, error: error.message };
            return {
              rows: (data ?? []).map((r) => ({
                user_id: (r as { user_id: string }).user_id,
              })),
              error: null,
            };
          },
          detectWeavesForUser: (userId) =>
            detectWeavesForUser(supabaseAdmin, userId),
          evaluateAlerts: async (runId) => {
            await evaluateDetectWeavesAlerts(runId);
          },
        };

        const result = await runDetectWeaves(
          deps,
          {
            cronSecret: process.env.DETECT_WEAVES_CRON_SECRET,
            minIntervalMs: DEFAULT_MIN_INTERVAL_MS,
            maxUsersPerRun: DEFAULT_MAX_USERS_PER_RUN,
          },
          request.headers.get("x-cron-secret"),
        );

        if (typeof result.body === "string") {
          return new Response(result.body, {
            status: result.status,
            headers: result.headers,
          });
        }
        return Response.json(result.body, {
          status: result.status,
          headers: result.headers,
        });
      },
    },
  },
});