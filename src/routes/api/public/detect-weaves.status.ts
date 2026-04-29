/**
 * Lightweight, NON-SENSITIVE status endpoint for the detect-weaves cron.
 *
 * Returns only:
 *   - cooldown_active            (bool)  — is a new run currently blocked?
 *   - cooldown_remaining_seconds (int)   — 0 if not in cooldown
 *   - last_run_cap_hit           (bool)  — did the most recent scan hit the
 *                                          per-run user cap?
 *
 * Intentionally does NOT return user ids, per-user counts, scan totals,
 * run ids, timestamps, or the configured cap value. Safe to expose
 * unauthenticated under /api/public/* — it cannot be used to enumerate
 * users, infer activity, or fingerprint the workload.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  DEFAULT_MAX_USERS_PER_RUN,
  DEFAULT_MIN_INTERVAL_MS,
} from "@/lib/detect-weaves-runner.server";

type StatusRow = {
  cooldown_active: boolean;
  cooldown_remaining_seconds: number | null;
  last_run_cap_hit: boolean;
};

export const Route = createFileRoute("/api/public/detect-weaves/status")({
  server: {
    handlers: {
      GET: async () => {
        const minSeconds = Math.max(
          0,
          Math.ceil(DEFAULT_MIN_INTERVAL_MS / 1000),
        );
        const { data, error } = await supabaseAdmin.rpc(
          "get_detect_weaves_status",
          {
            _min_interval_seconds: minSeconds,
            _max_users_per_run: DEFAULT_MAX_USERS_PER_RUN,
          },
        );

        if (error) {
          console.error("[detect-weaves/status] rpc failed", error.message);
          // Generic message — never leak provider details to an unauthenticated caller.
          return new Response(
            JSON.stringify({ ok: false, error: "status_unavailable" }),
            {
              status: 503,
              headers: {
                "content-type": "application/json",
                "cache-control": "no-store",
              },
            },
          );
        }

        const row = (Array.isArray(data) ? data[0] : data) as
          | StatusRow
          | undefined;

        const body = {
          ok: true,
          cooldown_active: !!row?.cooldown_active,
          cooldown_remaining_seconds: Math.max(
            0,
            Number(row?.cooldown_remaining_seconds ?? 0),
          ),
          last_run_cap_hit: !!row?.last_run_cap_hit,
        };

        return Response.json(body, {
          status: 200,
          headers: {
            // Brief cache to absorb polling without leaking freshness.
            "cache-control": "public, max-age=30",
          },
        });
      },
    },
  },
});