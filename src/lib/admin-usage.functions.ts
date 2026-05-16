/**
 * Q32 — Admin usage dashboard server functions.
 *
 * All functions:
 *   - require an authenticated session
 *   - re-check `has_admin_role` via the security-definer RPC
 *   - read the `seeker_usage_monthly` materialized view (refreshed
 *     every 5 min by pg_cron) for sub-millisecond aggregates
 *   - use `supabaseAdmin` only after the role check, never to bypass
 *     RLS for caller-driven queries
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getAvailableCredits } from "@/lib/ai-call.server";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_admin_role", {
    _user_id: userId,
  });
  if (error || data !== true) throw new Error("not authorized");
}

export type SeekerUsageRow = {
  user_id: string;
  email: string;
  display_name: string | null;
  plan: "free" | "premium" | "premium_gifted";
  role: string;
  member_since: string;
  ai_blocked: boolean;
  ai_calls_this_month: number;
  ai_credits_used_this_month: number;
  ai_cost_usd_this_month: number;
  ai_calls_lifetime: number;
  ai_cost_usd_lifetime: number;
  storage_bytes_current: number;
  storage_cost_usd_this_month: number;
  revenue_this_month: number;
  total_cost_usd_this_month: number;
  margin_this_month: number;
  loss_ratio: number;
  last_call_at: string | null;
  last_upload_at: string | null;
  hit_abuse_cap_this_month: boolean;
  hit_quota_exceeded_this_month: boolean;
};

function withDerivedFields(r: any): SeekerUsageRow {
  const ai = Number(r.ai_cost_usd_this_month ?? 0);
  const st = Number(r.storage_cost_usd_this_month ?? 0);
  const rev = Number(r.revenue_this_month ?? 0);
  const total = ai + st;
  return {
    ...r,
    ai_cost_usd_this_month: ai,
    ai_cost_usd_lifetime: Number(r.ai_cost_usd_lifetime ?? 0),
    storage_cost_usd_this_month: st,
    revenue_this_month: rev,
    storage_bytes_current: Number(r.storage_bytes_current ?? 0),
    total_cost_usd_this_month: total,
    margin_this_month: rev - total,
    loss_ratio: total / Math.max(rev, 0.01),
  };
}

/* ---------- Overview ---------- */

export const getUsageSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const monthStart = new Date(
      Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth(),
        1,
      ),
    ).toISOString();

    const { data: aiRows } = await supabaseAdmin
      .from("ai_call_log" as never)
      .select("cost_usd,status")
      .gte("created_at", monthStart);
    const ai = (aiRows ?? []) as Array<{ cost_usd: number; status: string }>;
    const totalAiCost = ai.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
    const successfulCalls = ai.filter((r) => r.status === "success").length;
    const failedCalls = ai.length - successfulCalls;
    const abuseHits = ai.filter((r) => r.status === "rate_limited").length;
    const quotaHits = ai.filter((r) => r.status === "quota_exceeded").length;

    const { data: stRows } = await supabaseAdmin
      .from("storage_event_log" as never)
      .select("size_bytes,event_type");
    const totalStorageBytes = ((stRows ?? []) as Array<{ size_bytes: number; event_type: string }>)
      .reduce(
        (s, r) =>
          s +
          (r.event_type.endsWith("_delete") ? -1 : 1) * Number(r.size_bytes ?? 0),
        0,
      );
    const totalStorageCost = (totalStorageBytes / 1_073_741_824) * 0.021;

    const { count: premiumCount } = await supabaseAdmin
      .from("user_preferences" as never)
      .select("user_id", { count: "exact", head: true })
      .eq("is_premium", true);
    const totalRevenue = (premiumCount ?? 0) * 9.99;

    const { count: totalSeekers } = await supabaseAdmin
      .from("user_preferences" as never)
      .select("user_id", { count: "exact", head: true });

    return {
      monthStart,
      totalAiCost,
      totalStorageBytes,
      totalStorageCost,
      totalSpend: totalAiCost + totalStorageCost,
      totalRevenue,
      netMargin: totalRevenue - (totalAiCost + totalStorageCost),
      premiumCount: premiumCount ?? 0,
      totalSeekers: totalSeekers ?? 0,
      successfulCalls,
      failedCalls,
      abuseHits,
      quotaHits,
    };
  });

/* ---------- Seeker list ---------- */

const ListInput = z.object({
  sortBy: z
    .enum(["total_cost", "loss_ratio", "ai_cost", "storage_bytes", "last_activity", "revenue", "member_since"])
    .default("total_cost"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  filter: z.enum(["all", "free", "premium", "loss_makers", "abusive", "blocked"]).default("all"),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
  search: z.string().optional(),
});

export const getSeekerUsageList = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ListInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    let q = supabaseAdmin
      .from("seeker_usage_monthly" as never)
      .select("*", { count: "exact" });

    if (data.filter === "free") q = q.eq("plan", "free");
    else if (data.filter === "premium")
      q = q.in("plan", ["premium", "premium_gifted"]);
    else if (data.filter === "abusive") q = q.eq("hit_abuse_cap_this_month", true);
    else if (data.filter === "blocked") q = q.eq("ai_blocked", true);

    if (data.search) q = q.ilike("email", `%${data.search}%`);

    // Sort columns map (loss_ratio is computed client-side after fetch)
    const dbSortMap: Record<string, string> = {
      total_cost: "ai_cost_usd_this_month",
      ai_cost: "ai_cost_usd_this_month",
      storage_bytes: "storage_bytes_current",
      last_activity: "last_call_at",
      revenue: "revenue_this_month",
      member_since: "member_since",
    };
    const sortCol = dbSortMap[data.sortBy] ?? "ai_cost_usd_this_month";
    if (data.sortBy !== "loss_ratio" && data.sortBy !== "total_cost") {
      q = q.order(sortCol, { ascending: data.sortDir === "asc", nullsFirst: false });
    }
    q = q.range(data.offset, data.offset + data.limit - 1);

    const { data: rows, count } = await q;
    let mapped = ((rows ?? []) as any[]).map(withDerivedFields);

    if (data.sortBy === "loss_ratio") {
      mapped.sort((a, b) =>
        data.sortDir === "asc" ? a.loss_ratio - b.loss_ratio : b.loss_ratio - a.loss_ratio,
      );
    } else if (data.sortBy === "total_cost") {
      mapped.sort((a, b) =>
        data.sortDir === "asc"
          ? a.total_cost_usd_this_month - b.total_cost_usd_this_month
          : b.total_cost_usd_this_month - a.total_cost_usd_this_month,
      );
    }
    if (data.filter === "loss_makers") {
      mapped = mapped.filter((r) => r.margin_this_month < 0);
    }
    return { rows: mapped, total: count ?? mapped.length };
  });

/* ---------- Top tables for Overview ---------- */

export const getOverviewTops = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data: rows } = await supabaseAdmin
      .from("seeker_usage_monthly" as never)
      .select("*")
      .order("ai_cost_usd_this_month", { ascending: false })
      .limit(200);
    const all = ((rows ?? []) as any[]).map(withDerivedFields);
    const topCost = [...all]
      .sort((a, b) => b.total_cost_usd_this_month - a.total_cost_usd_this_month)
      .slice(0, 10);
    const topLoss = [...all]
      .sort((a, b) => b.loss_ratio - a.loss_ratio)
      .filter((r) => r.total_cost_usd_this_month > 0)
      .slice(0, 10);
    return { topCost, topLoss };
  });

/* ---------- Anomalies tab ---------- */

export const getAnomalies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const monthStart = new Date(
      Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1),
    ).toISOString();

    // Abuse cap hits
    const { data: abuseRows } = await supabaseAdmin
      .from("ai_call_log" as never)
      .select("user_id,created_at")
      .eq("status", "rate_limited")
      .gte("created_at", monthStart)
      .order("created_at", { ascending: true });
    const abuseMap = new Map<string, { firstAt: string; count: number }>();
    for (const r of (abuseRows ?? []) as Array<{ user_id: string; created_at: string }>) {
      const ex = abuseMap.get(r.user_id);
      if (!ex) abuseMap.set(r.user_id, { firstAt: r.created_at, count: 1 });
      else ex.count++;
    }

    // Approaching quota — read mat view
    const { data: viewRows } = await supabaseAdmin
      .from("seeker_usage_monthly" as never)
      .select("*");
    const all = ((viewRows ?? []) as any[]).map(withDerivedFields);
    const approaching = all
      .filter((r) => {
        const quota = r.plan === "free" ? 50 : 1000;
        const pct = r.ai_credits_used_this_month / quota;
        return pct >= 0.75 && pct < 1;
      })
      .sort((a, b) => b.ai_credits_used_this_month - a.ai_credits_used_this_month)
      .slice(0, 50);

    // Upload spikes — >10MB in single day this month
    const { data: stRows } = await supabaseAdmin
      .from("storage_event_log" as never)
      .select("user_id,size_bytes,created_at,event_type")
      .gte("created_at", monthStart)
      .not("event_type", "like", "%_delete");
    const dayMap = new Map<string, { user_id: string; day: string; bytes: number }>();
    for (const r of (stRows ?? []) as Array<{ user_id: string; size_bytes: number; created_at: string }>) {
      const day = r.created_at.slice(0, 10);
      const k = `${r.user_id}|${day}`;
      const ex = dayMap.get(k);
      if (!ex) dayMap.set(k, { user_id: r.user_id, day, bytes: Number(r.size_bytes ?? 0) });
      else ex.bytes += Number(r.size_bytes ?? 0);
    }
    const spikes = Array.from(dayMap.values())
      .filter((d) => d.bytes > 10 * 1024 * 1024)
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 50);

    // Decorate abuse + spikes with email
    const userIds = Array.from(
      new Set([...abuseMap.keys(), ...spikes.map((s) => s.user_id)]),
    );
    const emailMap = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: emails } = await supabaseAdmin
        .from("seeker_usage_monthly" as never)
        .select("user_id,email")
        .in("user_id", userIds);
      for (const r of (emails ?? []) as Array<{ user_id: string; email: string }>) {
        emailMap.set(r.user_id, r.email);
      }
    }
    return {
      abuse: Array.from(abuseMap.entries()).map(([user_id, v]) => ({
        user_id,
        email: emailMap.get(user_id) ?? user_id,
        first_at: v.firstAt,
        count: v.count,
      })),
      approaching: approaching.map((r) => ({
        user_id: r.user_id,
        email: r.email,
        plan: r.plan,
        used: r.ai_credits_used_this_month,
        quota: r.plan === "free" ? 50 : 1000,
      })),
      spikes: spikes.map((s) => ({
        ...s,
        email: emailMap.get(s.user_id) ?? s.user_id,
      })),
    };
  });

/* ---------- Per-seeker drill-down ---------- */

export const getSeekerDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId: callerId } = context;
    await assertAdmin(supabase, callerId);
    const target = data.userId;

    const { data: viewRow } = await supabaseAdmin
      .from("seeker_usage_monthly" as never)
      .select("*")
      .eq("user_id", target)
      .maybeSingle();

    const { data: prefs } = await supabaseAdmin
      .from("user_preferences" as never)
      .select("ai_blocked,ai_blocked_reason,is_premium,subscription_type,role,display_name,premium_since")
      .eq("user_id", target)
      .maybeSingle();

    const { data: aiCalls } = await supabaseAdmin
      .from("ai_call_log" as never)
      .select("id,created_at,call_type,model,cost_usd,credits_consumed,status,error_code,duration_ms")
      .eq("user_id", target)
      .order("created_at", { ascending: false })
      .limit(50);

    const { data: stEvents } = await supabaseAdmin
      .from("storage_event_log" as never)
      .select("id,created_at,event_type,bucket,size_bytes")
      .eq("user_id", target)
      .order("created_at", { ascending: false })
      .limit(20);

    const { data: grants } = await supabaseAdmin
      .from("ai_credit_grants" as never)
      .select("id,created_at,source,credits_amount,expires_at,metadata")
      .eq("user_id", target)
      .order("created_at", { ascending: false })
      .limit(50);

    return {
      seeker: viewRow ? withDerivedFields(viewRow) : null,
      prefs: prefs ?? null,
      aiCalls: aiCalls ?? [],
      storageEvents: stEvents ?? [],
      grants: grants ?? [],
    };
  });

/* ---------- Mutations ---------- */

export const grantBonusCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        credits: z.number().int().min(1).max(10000),
        note: z.string().max(500).default(""),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId: callerId } = context;
    await assertAdmin(supabase, callerId);
    await supabaseAdmin.from("ai_credit_grants" as never).insert({
      user_id: data.userId,
      source: "gift_admin",
      credits_amount: data.credits,
      expires_at: null,
      metadata: { note: data.note, granted_by: callerId },
    } as never);
    return { ok: true };
  });

export const resetMonthlyQuota = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId: callerId } = context;
    await assertAdmin(supabase, callerId);
    // Q69 — single monthly credit pool for all users.
    const { data: q } = await supabaseAdmin
      .from("admin_settings" as never)
      .select("value")
      .eq("key", "ai_monthly_credits")
      .maybeSingle();
    const credits = parseInt(
      String((q as { value?: unknown } | null)?.value ?? 50),
      10,
    );
    await supabaseAdmin.from("ai_credit_grants" as never).insert({
      user_id: data.userId,
      source: "monthly",
      credits_amount: credits,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      metadata: { reason: "admin_reset", granted_by: callerId },
    } as never);
    return { ok: true };
  });

export const setAiBlocked = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        blocked: z.boolean(),
        reason: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId: callerId } = context;
    await assertAdmin(supabase, callerId);
    await supabaseAdmin
      .from("user_preferences" as never)
      .update({
        ai_blocked: data.blocked,
        ai_blocked_reason: data.blocked ? data.reason ?? null : null,
      } as never)
      .eq("user_id", data.userId);
    return { ok: true };
  });

/* ---------- Q71 — Credit snapshot + trends + dashboard alerts ---------- */

async function getMonthlyAllowance(): Promise<number> {
  const { data } = await supabaseAdmin
    .from("admin_settings" as never)
    .select("value")
    .eq("key", "ai_monthly_credits")
    .maybeSingle();
  const raw = (data as { value?: unknown } | null)?.value;
  if (typeof raw === "number") return raw;
  const n = parseInt(String(raw ?? 50), 10);
  return Number.isFinite(n) ? n : 50;
}

export const getUserCreditSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId: callerId } = context;
    await assertAdmin(supabase, callerId);
    const target = data.userId;

    const [available, monthly, grantsRes, consumedRes, latestMonthlyRes] = await Promise.all([
      getAvailableCredits(target),
      getMonthlyAllowance(),
      supabaseAdmin
        .from("ai_credit_grants" as never)
        .select("credits_amount")
        .eq("user_id", target),
      supabaseAdmin
        .from("ai_call_log" as never)
        .select("credits_consumed")
        .eq("user_id", target)
        .eq("status", "success"),
      supabaseAdmin
        .from("ai_credit_grants" as never)
        .select("created_at, expires_at")
        .eq("user_id", target)
        .in("source", ["monthly", "monthly_free", "monthly_premium"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const lifetimeGranted = ((grantsRes.data ?? []) as Array<{ credits_amount: number }>)
      .reduce((s, r) => s + (r.credits_amount ?? 0), 0);
    const lifetimeConsumed = ((consumedRes.data ?? []) as Array<{ credits_consumed: number }>)
      .reduce((s, r) => s + (r.credits_consumed ?? 0), 0);
    const lm = latestMonthlyRes.data as { created_at?: string; expires_at?: string | null } | null;
    let nextResetAt: string | null = null;
    if (lm?.expires_at) nextResetAt = lm.expires_at;
    else if (lm?.created_at) {
      nextResetAt = new Date(new Date(lm.created_at).getTime() + 30 * 86_400_000).toISOString();
    }

    return {
      available,
      monthlyAllowance: monthly,
      nextResetAt,
      lifetimeGranted,
      lifetimeConsumed,
    };
  });

const TrendInput = z.object({
  userId: z.string().uuid(),
  dataset: z.enum(["credits_consumed", "ai_calls", "cost_usd", "grants", "storage"]),
  days: z.number().int().min(7).max(365).default(90),
});

export const getUserTrendSeries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => TrendInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId: callerId } = context;
    await assertAdmin(supabase, callerId);
    const since = new Date(Date.now() - data.days * 86_400_000).toISOString();

    const points = new Map<string, number>();
    // Seed every day with 0 so the chart is continuous.
    for (let i = data.days - 1; i >= 0; i--) {
      const k = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
      points.set(k, 0);
    }

    if (data.dataset === "credits_consumed" || data.dataset === "ai_calls" || data.dataset === "cost_usd") {
      const { data: rows } = await supabaseAdmin
        .from("ai_call_log" as never)
        .select("created_at, credits_consumed, cost_usd, status")
        .eq("user_id", data.userId)
        .eq("status", "success")
        .gte("created_at", since);
      for (const r of (rows ?? []) as Array<{
        created_at: string;
        credits_consumed: number;
        cost_usd: number;
      }>) {
        const k = r.created_at.slice(0, 10);
        if (!points.has(k)) continue;
        const inc =
          data.dataset === "credits_consumed"
            ? Number(r.credits_consumed ?? 0)
            : data.dataset === "ai_calls"
              ? 1
              : Number(r.cost_usd ?? 0);
        points.set(k, (points.get(k) ?? 0) + inc);
      }
    } else if (data.dataset === "grants") {
      const { data: rows } = await supabaseAdmin
        .from("ai_credit_grants" as never)
        .select("created_at, credits_amount")
        .eq("user_id", data.userId)
        .gte("created_at", since);
      for (const r of (rows ?? []) as Array<{ created_at: string; credits_amount: number }>) {
        const k = r.created_at.slice(0, 10);
        if (!points.has(k)) continue;
        points.set(k, (points.get(k) ?? 0) + Number(r.credits_amount ?? 0));
      }
    } else if (data.dataset === "storage") {
      const { data: rows } = await supabaseAdmin
        .from("storage_event_log" as never)
        .select("created_at, size_bytes, event_type")
        .eq("user_id", data.userId)
        .order("created_at", { ascending: true });
      // Cumulative bytes — sum all events up to each day in window.
      let cumulative = 0;
      const windowStart = new Date(since).getTime();
      const all = (rows ?? []) as Array<{
        created_at: string;
        size_bytes: number;
        event_type: string;
      }>;
      for (const r of all) {
        const sign = r.event_type.endsWith("_delete") ? -1 : 1;
        cumulative += sign * Number(r.size_bytes ?? 0);
        const t = new Date(r.created_at).getTime();
        if (t < windowStart) continue;
        const k = r.created_at.slice(0, 10);
        if (points.has(k)) points.set(k, cumulative);
      }
      // Forward-fill: any day still at 0 should inherit prior cumulative.
      let last = 0;
      // Compute pre-window cumulative for proper starting baseline.
      for (const r of all) {
        const t = new Date(r.created_at).getTime();
        if (t >= windowStart) break;
        const sign = r.event_type.endsWith("_delete") ? -1 : 1;
        last += sign * Number(r.size_bytes ?? 0);
      }
      const keys = Array.from(points.keys());
      for (const k of keys) {
        const v = points.get(k) ?? 0;
        if (v === 0) points.set(k, last);
        else last = v;
      }
    }

    return {
      dataset: data.dataset,
      series: Array.from(points.entries()).map(([d, v]) => ({ d: d.slice(5), value: v })),
    };
  });

export const getDashboardAlerts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const monthStart = new Date(
      Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1),
    ).toISOString();

    // Aggregate this month's AI calls per user
    const { data: aiRows } = await supabaseAdmin
      .from("ai_call_log" as never)
      .select("user_id, cost_usd, credits_consumed, status")
      .gte("created_at", monthStart);
    const ai = (aiRows ?? []) as Array<{
      user_id: string | null;
      cost_usd: number;
      credits_consumed: number;
      status: string;
    }>;

    const perUser = new Map<string, { calls: number; cost: number }>();
    let aiSpendThisMonth = 0;
    for (const r of ai) {
      if (r.status !== "success") continue;
      aiSpendThisMonth += Number(r.cost_usd ?? 0);
      if (!r.user_id) continue;
      const ex = perUser.get(r.user_id) ?? { calls: 0, cost: 0 };
      ex.calls += 1;
      ex.cost += Number(r.cost_usd ?? 0);
      perUser.set(r.user_id, ex);
    }

    const userIds = Array.from(perUser.keys());
    const avgCalls = userIds.length
      ? Array.from(perUser.values()).reduce((s, v) => s + v.calls, 0) / userIds.length
      : 0;
    const highUsageIds = userIds.filter((id) => (perUser.get(id)?.calls ?? 0) > 3 * avgCalls && avgCalls > 0);

    // Email lookup
    const allRelevantIds = new Set<string>(highUsageIds);
    // Pull all known users from view for email + zero/negative credit logic
    const { data: viewRows } = await supabaseAdmin
      .from("seeker_usage_monthly" as never)
      .select("user_id, email");
    const emailMap = new Map<string, string>();
    for (const r of (viewRows ?? []) as Array<{ user_id: string; email: string }>) {
      emailMap.set(r.user_id, r.email);
    }
    const knownUserIds = new Set(emailMap.keys());

    // Per-user available credits — Promise.all over known users (cap at 200 for safety)
    const checkIds = Array.from(knownUserIds).slice(0, 500);
    const balances = await Promise.all(
      checkIds.map(async (uid) => {
        // Re-implement inline to also capture granted vs consumed for negative detection
        const nowIso = new Date().toISOString();
        const [{ data: grants }, { data: usage }] = await Promise.all([
          supabaseAdmin
            .from("ai_credit_grants" as never)
            .select("credits_amount, expires_at, created_at, source")
            .eq("user_id", uid),
          supabaseAdmin
            .from("ai_call_log" as never)
            .select("credits_consumed")
            .eq("user_id", uid)
            .eq("status", "success"),
        ]);
        const grantsArr = (grants ?? []) as Array<{
          credits_amount: number;
          expires_at: string | null;
          created_at: string;
          source: string;
        }>;
        const activeGranted = grantsArr
          .filter((g) => g.expires_at == null || g.expires_at > nowIso)
          .reduce((s, g) => s + (g.credits_amount ?? 0), 0);
        // For cycle-aligned consumption use latest monthly grant created_at
        const latestMonthly = grantsArr
          .filter((g) => ["monthly", "monthly_free", "monthly_premium"].includes(g.source))
          .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
        const cycleStart = latestMonthly?.created_at ?? new Date(Date.now() - 30 * 86_400_000).toISOString();
        const allUsage = (usage ?? []) as Array<{ credits_consumed: number }>;
        const totalConsumed = allUsage.reduce((s, r) => s + (r.credits_consumed ?? 0), 0);
        const totalGrantedAll = grantsArr.reduce((s, g) => s + (g.credits_amount ?? 0), 0);
        const _cycleStart = cycleStart;
        const available = Math.max(0, activeGranted - totalConsumed);
        return {
          user_id: uid,
          available,
          deficit: totalConsumed - totalGrantedAll, // positive if negative balance
        };
      }),
    );

    const zeroCredit = balances.filter((b) => b.available === 0).map((b) => ({
      user_id: b.user_id,
      email: emailMap.get(b.user_id) ?? b.user_id,
    }));
    const negativeBalance = balances.filter((b) => b.deficit > 0).map((b) => ({
      user_id: b.user_id,
      email: emailMap.get(b.user_id) ?? b.user_id,
      deficit: b.deficit,
    }));

    // Orphaned AI calls — user_id not in knownUserIds
    const orphanCalls = ai.filter((r) => r.user_id && !knownUserIds.has(r.user_id));
    const orphanCost = orphanCalls.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);

    return {
      aiSpendThisMonth,
      highUsage: highUsageIds.map((id) => ({
        user_id: id,
        email: emailMap.get(id) ?? id,
        calls: perUser.get(id)?.calls ?? 0,
        cost: perUser.get(id)?.cost ?? 0,
      })),
      zeroCredit,
      negativeBalance,
      orphan: { count: orphanCalls.length, totalCost: orphanCost },
      avgCalls,
    };
  });

/* ---------- admin_settings editor ---------- */

export const listAdminSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data } = await supabaseAdmin
      .from("admin_settings" as never)
      .select("key,value,description,updated_at")
      .order("key");
    return data ?? [];
  });

export const updateAdminSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ key: z.string().min(1), value: z.string() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    // Try to coerce: number → number, true/false → bool, else raw string (jsonb stores either)
    let parsed: unknown = data.value;
    const trimmed = data.value.trim();
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) parsed = Number(trimmed);
    else if (trimmed === "true") parsed = true;
    else if (trimmed === "false") parsed = false;
    await supabaseAdmin
      .from("admin_settings" as never)
      .update({ value: parsed, updated_at: new Date().toISOString(), updated_by: userId } as never)
      .eq("key", data.key);
    return { ok: true };
  });

/* ---------- Seeker-facing ---------- */

export const getMyUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const monthStart = new Date(
      Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1),
    ).toISOString();

    const { data: prefs } = await supabase
      .from("user_preferences")
      .select("is_premium,ai_blocked,ai_blocked_reason")
      .eq("user_id", userId)
      .maybeSingle();
    const isPremium = !!(prefs as { is_premium?: boolean } | null)?.is_premium;

    // Quota + costs from admin_settings
    const { data: settings } = await supabase
      .from("admin_settings")
      .select("key,value")
      .in("key", [
        "ai_monthly_credits",
        "ai_quota_free_monthly",
        "ai_quota_premium_monthly",
        "storage_quota_free_photos_bytes",
        "storage_quota_premium_photos_bytes",
        "storage_quota_free_custom_decks",
        "storage_quota_premium_custom_decks",
        "ai_warning_threshold_pct",
      ]);
    const sMap = new Map<string, any>();
    for (const r of (settings ?? []) as Array<{ key: string; value: any }>) sMap.set(r.key, r.value);
    const num = (k: string, fb: number) => {
      const v = sMap.get(k);
      if (typeof v === "number") return v;
      const n = parseFloat(String(v));
      return Number.isFinite(n) ? n : fb;
    };
    const aiQuota = num("ai_monthly_credits", num("ai_quota_free_monthly", 50));
    const photoQuota = isPremium
      ? num("storage_quota_premium_photos_bytes", 5 * 1024 ** 3)
      : num("storage_quota_free_photos_bytes", 100 * 1024 ** 2);
    const deckQuota = isPremium
      ? num("storage_quota_premium_custom_decks", 50)
      : num("storage_quota_free_custom_decks", 10);
    const warningPct = num("ai_warning_threshold_pct", 75) / 100;

    // Find current cycle start = most recent monthly grant or month start
    const { data: latestGrant } = await supabase
      .from("ai_credit_grants")
      .select("created_at,expires_at")
      .eq("user_id", userId)
      .in("source", ["monthly", "monthly_free", "monthly_premium"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const cycleStart =
      (latestGrant as { created_at?: string } | null)?.created_at ?? monthStart;
    const cycleEnd =
      (latestGrant as { expires_at?: string | null } | null)?.expires_at ??
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: calls } = await supabase
      .from("ai_call_log")
      .select("call_type,credits_consumed,status")
      .eq("user_id", userId)
      .eq("status", "success")
      .gte("created_at", cycleStart);
    const used = ((calls ?? []) as Array<{ credits_consumed: number }>).reduce(
      (s, r) => s + (r.credits_consumed ?? 0),
      0,
    );
    const byType: Record<string, number> = {};
    for (const r of (calls ?? []) as Array<{ call_type: string; credits_consumed: number }>) {
      byType[r.call_type] = (byType[r.call_type] ?? 0) + (r.credits_consumed ?? 0);
    }

    // Photo bytes used (own RLS allows it)
    const { data: storageEvents } = await supabase
      .from("storage_event_log")
      .select("event_type,size_bytes")
      .eq("user_id", userId);
    let photoUsed = 0;
    for (const r of (storageEvents ?? []) as Array<{ event_type: string; size_bytes: number }>) {
      if (!r.event_type?.startsWith("photo")) continue;
      photoUsed += (r.event_type.endsWith("_delete") ? -1 : 1) * Number(r.size_bytes ?? 0);
    }
    photoUsed = Math.max(0, photoUsed);

    // Custom deck count (read decks owned by user)
    const { count: deckCount } = await supabase
      .from("custom_decks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    return {
      isPremium,
      aiBlocked: !!(prefs as { ai_blocked?: boolean } | null)?.ai_blocked,
      aiBlockedReason: (prefs as { ai_blocked_reason?: string | null } | null)?.ai_blocked_reason ?? null,
      ai: {
        used,
        quota: aiQuota,
        remaining: Math.max(0, aiQuota - used),
        warningPct,
        byType,
        cycleStart,
        nextResetAt: cycleEnd,
      },
      storage: {
        photoUsedBytes: photoUsed,
        photoQuotaBytes: photoQuota,
        deckCount: deckCount ?? 0,
        deckQuota,
      },
    };
  });