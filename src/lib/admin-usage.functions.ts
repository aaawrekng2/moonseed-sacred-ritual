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
    const { data: prefs } = await supabaseAdmin
      .from("user_preferences" as never)
      .select("is_premium")
      .eq("user_id", data.userId)
      .maybeSingle();
    const isPremium = !!(prefs as { is_premium?: boolean } | null)?.is_premium;
    const { data: q } = await supabaseAdmin
      .from("admin_settings" as never)
      .select("value")
      .eq("key", isPremium ? "ai_quota_premium_monthly" : "ai_quota_free_monthly")
      .maybeSingle();
    const credits = parseInt(String((q as { value?: unknown } | null)?.value ?? (isPremium ? 1000 : 50)), 10);
    await supabaseAdmin.from("ai_credit_grants" as never).insert({
      user_id: data.userId,
      source: isPremium ? "monthly_premium" : "monthly_free",
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
    const aiQuota = isPremium ? num("ai_quota_premium_monthly", 1000) : num("ai_quota_free_monthly", 50);
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
      .in("source", ["monthly_free", "monthly_premium"])
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