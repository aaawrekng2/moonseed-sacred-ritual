/**
 * Detect-weaves alerting evaluator.
 *
 * Called after every detect-weaves run (cron + manual). Inspects the
 * latest run plus recent history and inserts rows into
 * `detect_weaves_alerts` when:
 *
 *  - kind="failure"     — the run's status is `error` (whole job failed).
 *  - kind="partial"     — the run is `partial` and >25% of scanned
 *                         users errored.
 *  - kind="zero_streak" — the most recent ZERO_STREAK_LENGTH scheduled
 *                         runs all detected 0 new weaves.
 *
 * Idempotency:
 *  - Each run row is flipped `alerted=true` after the evaluator scores it.
 *  - Zero-streak alerts are deduped against any existing unresolved
 *    zero_streak alert raised in the last 24 hours.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const ZERO_STREAK_LENGTH = 7;
const PARTIAL_ERROR_RATIO = 0.25;
const ZERO_STREAK_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

type RunRow = {
  id: string;
  status: string;
  mode: string;
  weaves_detected: number;
  users_scanned: number;
  per_user_errors: Array<{ user_id: string; error: string }> | null;
  message: string | null;
  finished_at: string;
  alerted: boolean;
};

type AlertInsert = {
  kind: "failure" | "partial" | "zero_streak";
  severity: "info" | "warn" | "error";
  message: string;
  details: Record<string, unknown>;
  run_id: string | null;
};

export type EvaluateAlertsResult = {
  alerts_created: number;
  kinds: string[];
};

/**
 * Evaluate the most recent detect-weaves run (by id) and any necessary
 * cross-run conditions (zero-streak). Returns the alerts that were
 * actually inserted.
 */
export async function evaluateDetectWeavesAlerts(
  runId: string,
): Promise<EvaluateAlertsResult> {
  const created: AlertInsert[] = [];

  // 1. Load the run.
  const { data: run, error: runErr } = await supabaseAdmin
    .from("detect_weaves_runs" as never)
    .select(
      "id, status, mode, weaves_detected, users_scanned, per_user_errors, message, finished_at, alerted",
    )
    .eq("id", runId)
    .maybeSingle();

  if (runErr || !run) {
    console.error("[detect-weaves alerts] failed to load run", runId, runErr);
    return { alerts_created: 0, kinds: [] };
  }
  const r = run as unknown as RunRow;
  if (r.alerted) return { alerts_created: 0, kinds: [] };

  // 2. Per-run alerts (failure / partial).
  if (r.status === "error") {
    created.push({
      kind: "failure",
      severity: "error",
      message: `Detect-weaves run failed (${r.mode}). ${r.message ?? ""}`.trim(),
      details: {
        mode: r.mode,
        users_scanned: r.users_scanned,
        per_user_errors: r.per_user_errors ?? [],
      },
      run_id: r.id,
    });
  } else if (r.status === "partial") {
    const errorCount = (r.per_user_errors ?? []).length;
    const ratio = r.users_scanned > 0 ? errorCount / r.users_scanned : 0;
    if (ratio > PARTIAL_ERROR_RATIO) {
      created.push({
        kind: "partial",
        severity: "warn",
        message: `Detect-weaves partial failure: ${errorCount}/${r.users_scanned} users errored (${Math.round(
          ratio * 100,
        )}%).`,
        details: {
          mode: r.mode,
          users_scanned: r.users_scanned,
          error_count: errorCount,
          error_ratio: ratio,
          per_user_errors: r.per_user_errors ?? [],
        },
        run_id: r.id,
      });
    }
  }

  // 3. Zero-streak (only meaningful for scheduled runs).
  if (r.mode === "scheduled" && r.status !== "error") {
    const { data: recent } = await supabaseAdmin
      .from("detect_weaves_runs" as never)
      .select("id, weaves_detected, finished_at, status")
      .eq("mode", "scheduled")
      .in("status", ["success", "partial"])
      .order("finished_at", { ascending: false })
      .limit(ZERO_STREAK_LENGTH);

    const recentRows = (recent ?? []) as Array<{
      id: string;
      weaves_detected: number;
      finished_at: string;
    }>;
    const fullStreak =
      recentRows.length === ZERO_STREAK_LENGTH &&
      recentRows.every((row) => row.weaves_detected === 0);

    if (fullStreak) {
      // Dedupe against an unresolved zero_streak alert from the last 24h.
      const cutoff = new Date(
        Date.now() - ZERO_STREAK_DEDUPE_WINDOW_MS,
      ).toISOString();
      const { data: existing } = await supabaseAdmin
        .from("detect_weaves_alerts" as never)
        .select("id")
        .eq("kind", "zero_streak")
        .is("resolved_at", null)
        .gte("created_at", cutoff)
        .limit(1);

      if (!existing || existing.length === 0) {
        created.push({
          kind: "zero_streak",
          severity: "warn",
          message: `Detect-weaves has produced 0 new weaves for ${ZERO_STREAK_LENGTH} consecutive scheduled runs.`,
          details: {
            streak_length: ZERO_STREAK_LENGTH,
            run_ids: recentRows.map((row) => row.id),
            window_started_at: recentRows[recentRows.length - 1]?.finished_at,
            window_ended_at: recentRows[0]?.finished_at,
          },
          run_id: r.id,
        });
      }
    }
  }

  // 4. Insert alerts and mark run.
  if (created.length > 0) {
    const { error: insertErr } = await supabaseAdmin
      .from("detect_weaves_alerts" as never)
      .insert(created as never);
    if (insertErr) {
      console.error(
        "[detect-weaves alerts] insert failed",
        insertErr.message,
        created,
      );
    } else {
      // Best-effort email notification — silently no-ops if email infra
      // isn't wired up yet (table missing, RPC missing, etc.).
      try {
        await maybeNotifyAdminsByEmail(created);
      } catch (e) {
        console.warn("[detect-weaves alerts] email notify skipped", e);
      }
    }
  }

  await supabaseAdmin
    .from("detect_weaves_runs" as never)
    .update({ alerted: true } as never)
    .eq("id", r.id);

  return {
    alerts_created: created.length,
    kinds: created.map((a) => a.kind),
  };
}

/**
 * Best-effort: enqueue an email to every admin via the `enqueue_email`
 * RPC that ships with Lovable's email infrastructure. If that infra
 * hasn't been set up yet (no email domain configured), the RPC will be
 * missing and this function will quietly no-op so alerts still land
 * in-app.
 */
async function maybeNotifyAdminsByEmail(alerts: AlertInsert[]): Promise<void> {
  // Find admin users via user_preferences.role.
  const { data: admins } = await supabaseAdmin
    .from("user_preferences")
    .select("user_id")
    .in("role", ["admin", "super_admin"]);
  const adminIds = ((admins ?? []) as Array<{ user_id: string }>).map(
    (a) => a.user_id,
  );
  if (adminIds.length === 0) return;

  // Fetch admin emails from auth.users using the admin API.
  const emails: string[] = [];
  for (const id of adminIds) {
    try {
      const { data } = await supabaseAdmin.auth.admin.getUserById(id);
      const e = data?.user?.email;
      if (e) emails.push(e);
    } catch {
      // ignore individual lookup failures
    }
  }
  if (emails.length === 0) return;

  const subject = `🛎️ Detect-weaves alert${alerts.length > 1 ? "s" : ""}`;
  const lines = alerts.map(
    (a) => `[${a.severity.toUpperCase()}] ${a.kind} — ${a.message}`,
  );
  const html = `<h2>Detect-weaves alert</h2><ul>${alerts
    .map(
      (a) =>
        `<li><strong>${a.kind}</strong> (${a.severity}): ${a.message}</li>`,
    )
    .join("")}</ul><p>Open the admin dashboard for full details.</p>`;
  const text = `${lines.join("\n")}\n\nOpen the admin dashboard for full details.`;

  // The enqueue_email RPC is created by Lovable's setup_email_infra. If
  // it doesn't exist yet, supabase returns a clear error and we no-op.
  for (const to of emails) {
    const { error } = await supabaseAdmin.rpc("enqueue_email" as never, {
      p_queue: "transactional_emails",
      p_payload: {
        to,
        subject,
        html,
        text,
        template_name: "detect_weaves_alert",
      },
    } as never);
    if (error) {
      // If email infra isn't installed yet, this returns a "function does
      // not exist" error. Stop trying further recipients to avoid spam in
      // the logs, but don't throw — alerts already exist in-app.
      console.warn(
        "[detect-weaves alerts] enqueue_email skipped:",
        error.message,
      );
      return;
    }
  }
}