/**
 * Q31 Stage 1 — single chokepoint for every AI call in the app.
 *
 * Every .functions.ts file MUST route Anthropic / Lovable AI Gateway
 * traffic through callAI(). The wrapper:
 *   • enforces the master kill switch (admin_settings.ai_enabled_globally)
 *   • enforces per-user monthly credit quotas + hourly abuse cap
 *   • computes USD cost from token usage at call time
 *   • appends an immutable row to ai_call_log (success OR failure)
 *   • returns a typed result the caller can branch on
 *
 * This module is server-only — the .server.ts suffix keeps it out of
 * client bundles via TanStack import-protection.
 */
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// USD per million tokens. Refine as providers publish new rates.
const MODEL_RATES: Record<
  string,
  { input: number; output: number; cached: number }
> = {
  "claude-sonnet-4-6": { input: 3.0, output: 15.0, cached: 0.3 },
  "claude-sonnet-4-5-20250929": { input: 3.0, output: 15.0, cached: 0.3 },
  "claude-haiku-4-5-20251001": { input: 1.0, output: 5.0, cached: 0.1 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0, cached: 0.1 },
  "google/gemini-2.5-pro": { input: 1.25, output: 10.0, cached: 0.3 },
  "google/gemini-2.5-flash": { input: 0.3, output: 2.5, cached: 0.075 },
  "openai/gpt-5": { input: 5.0, output: 20.0, cached: 0.5 },
};

export type AICallType =
  | "interpretation"
  | "tailored_prompt"
  | "deep_reading"
  | "story_prose"
  | "share_summary"
  | "card_evidence"
  | "story_orchestration"
  | "pattern_interpretation"
  | "memory"
  | "insights";

export type AIProvider = "anthropic" | "lovable_ai_gateway";

export type CallAIParams = {
  callType: AICallType;
  provider: AIProvider;
  model: string;
  userId: string | null;
  isPremium?: boolean;
  readingId?: string | null;
  patternId?: string | null;
  messages: Array<{ role: "user" | "assistant" | "system"; content: unknown }>;
  system?: string;
  maxTokens: number;
  /** Set true for trusted internal jobs (e.g. cron). */
  bypassQuota?: boolean;
};

export type CallAISuccess = {
  ok: true;
  content: string;
  creditsConsumed: number;
  remainingCredits: number;
  usage: { input_tokens: number; output_tokens: number; cached_input_tokens: number };
  costUsd: number;
};

export type CallAIFailure = {
  ok: false;
  error:
    | "quota_exceeded"
    | "rate_limited"
    | "ai_disabled"
    | "ai_unavailable"
    | "error_provider"
    | "error_app";
  reason?: string;
  remainingCredits?: number;
  resetAt?: string;
  status?: number;
};

export type CallAIResult = CallAISuccess | CallAIFailure;

function rateFor(model: string) {
  return MODEL_RATES[model] ?? MODEL_RATES["claude-sonnet-4-6"];
}

function computeCost(
  model: string,
  usage: { input_tokens: number; output_tokens: number; cached_input_tokens: number },
): number {
  const r = rateFor(model);
  const uncachedInput = Math.max(0, usage.input_tokens - usage.cached_input_tokens);
  return (
    (uncachedInput / 1_000_000) * r.input +
    (usage.cached_input_tokens / 1_000_000) * r.cached +
    (usage.output_tokens / 1_000_000) * r.output
  );
}

async function getAdminSettingNumber(key: string, fallback: number): Promise<number> {
  try {
    const { data } = await supabaseAdmin
      .from("admin_settings" as never)
      .select("value")
      .eq("key", key)
      .maybeSingle();
    const v = (data as { value?: unknown } | null)?.value;
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : fallback;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

async function getAdminSettingBool(key: string, fallback: boolean): Promise<boolean> {
  try {
    const { data } = await supabaseAdmin
      .from("admin_settings" as never)
      .select("value")
      .eq("key", key)
      .maybeSingle();
    const v = (data as { value?: unknown } | null)?.value;
    if (typeof v === "boolean") return v;
    if (typeof v === "string") return v === "true";
    return fallback;
  } catch {
    return fallback;
  }
}

async function getCreditCost(callType: AICallType): Promise<number> {
  return Math.max(0, Math.round(await getAdminSettingNumber(`ai_credit_cost_${callType}`, 1)));
}

async function getCurrentCycleStart(userId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("ai_credit_grants" as never)
    .select("created_at")
    .eq("user_id", userId)
    .in("source", ["monthly_free", "monthly_premium"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const created = (data as { created_at?: string } | null)?.created_at;
  return created ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
}

async function getNextResetDate(userId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("ai_credit_grants" as never)
    .select("created_at, expires_at")
    .eq("user_id", userId)
    .in("source", ["monthly_free", "monthly_premium"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = data as { created_at?: string; expires_at?: string | null } | null;
  if (!row) return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  if (row.expires_at) return row.expires_at;
  return new Date(new Date(row.created_at!).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
}

export async function getAvailableCredits(userId: string): Promise<number> {
  const nowIso = new Date().toISOString();
  const { data: grants } = await supabaseAdmin
    .from("ai_credit_grants" as never)
    .select("credits_amount, expires_at")
    .eq("user_id", userId);
  const totalGranted = ((grants ?? []) as Array<{ credits_amount: number; expires_at: string | null }>)
    .filter((g) => g.expires_at == null || g.expires_at > nowIso)
    .reduce((s, g) => s + (g.credits_amount ?? 0), 0);

  const cycleStart = await getCurrentCycleStart(userId);
  const { data: usage } = await supabaseAdmin
    .from("ai_call_log" as never)
    .select("credits_consumed")
    .eq("user_id", userId)
    .eq("status", "success")
    .gte("created_at", cycleStart);
  const totalUsed = ((usage ?? []) as Array<{ credits_consumed: number }>).reduce(
    (s, u) => s + (u.credits_consumed ?? 0),
    0,
  );
  return Math.max(0, totalGranted - totalUsed);
}

type QuotaCheck =
  | { allowed: true; remaining?: number }
  | { allowed: false; reason: CallAIFailure["error"]; remaining?: number; resetAt?: string };

async function checkQuota(
  userId: string | null,
  callType: AICallType,
): Promise<QuotaCheck> {
  const enabled = await getAdminSettingBool("ai_enabled_globally", true);
  if (!enabled) return { allowed: false, reason: "ai_disabled" };
  if (!userId) return { allowed: true };

  // Q32 — admin can block AI for a specific seeker.
  try {
    const { data: blockedRow } = await supabaseAdmin
      .from("user_preferences" as never)
      .select("ai_blocked")
      .eq("user_id", userId)
      .maybeSingle();
    if ((blockedRow as { ai_blocked?: boolean } | null)?.ai_blocked) {
      return { allowed: false, reason: "ai_disabled" };
    }
  } catch {
    /* fail open on read error */
  }

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: hourlyCount } = await supabaseAdmin
    .from("ai_call_log" as never)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", oneHourAgo);
  const abuseCap = await getAdminSettingNumber("ai_abuse_cap_per_hour", 20);
  if ((hourlyCount ?? 0) >= abuseCap) return { allowed: false, reason: "rate_limited" };

  const available = await getAvailableCredits(userId);
  const cost = await getCreditCost(callType);
  if (available < cost) {
    return {
      allowed: false,
      reason: "quota_exceeded",
      remaining: available,
      resetAt: await getNextResetDate(userId),
    };
  }
  return { allowed: true, remaining: available - cost };
}

async function logCall(row: {
  userId: string | null;
  callType: AICallType;
  provider: AIProvider;
  model: string;
  status: "success" | "error_provider" | "error_app" | "rate_limited" | "quota_exceeded" | "ai_disabled";
  errorCode: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costUsd: number;
  creditsConsumed: number;
  planAtTime: string;
  readingId?: string | null;
  patternId?: string | null;
  durationMs: number;
  idempotencyKey: string;
}) {
  try {
    await supabaseAdmin.from("ai_call_log" as never).insert({
      user_id: row.userId,
      call_type: row.callType,
      provider: row.provider,
      model: row.model,
      input_tokens: row.inputTokens,
      output_tokens: row.outputTokens,
      cached_input_tokens: row.cachedInputTokens,
      cost_usd: row.costUsd,
      credits_consumed: row.creditsConsumed,
      plan_at_time: row.planAtTime,
      reading_id: row.readingId ?? null,
      pattern_id: row.patternId ?? null,
      status: row.status,
      error_code: row.errorCode,
      duration_ms: row.durationMs,
      idempotency_key: row.idempotencyKey,
    } as never);
  } catch (err) {
    console.error("[ai-call] log insert failed", err);
  }
}

export async function callAI(params: CallAIParams): Promise<CallAIResult> {
  const idempotencyKey = randomUUID();
  const startTime = Date.now();
  const planAtTime = params.userId
    ? params.isPremium
      ? "premium"
      : "free"
    : "anonymous";

  if (!params.bypassQuota) {
    const check = await checkQuota(params.userId, params.callType);
    if (!check.allowed) {
      await logCall({
        userId: params.userId,
        callType: params.callType,
        provider: params.provider,
        model: params.model,
        status: check.reason === "rate_limited" ? "rate_limited" : check.reason === "ai_disabled" ? "ai_disabled" : "quota_exceeded",
        errorCode: check.reason,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        costUsd: 0,
        creditsConsumed: 0,
        planAtTime,
        readingId: params.readingId,
        patternId: params.patternId,
        durationMs: 0,
        idempotencyKey,
      });
      return {
        ok: false,
        error: check.reason,
        remainingCredits: check.remaining,
        resetAt: check.resetAt,
      };
    }
  }

  let status: "success" | "error_provider" | "error_app" = "success";
  let errorCode: string | null = null;
  let providerStatus: number | undefined;
  let responseContent = "";
  let usage = { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0 };

  try {
    if (params.provider === "anthropic") {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        status = "error_app";
        errorCode = "missing_api_key";
      } else {
        const resp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: params.model,
            max_tokens: params.maxTokens,
            system: params.system,
            messages: params.messages,
          }),
        });
        providerStatus = resp.status;
        if (!resp.ok) {
          status = "error_provider";
          errorCode = `http_${resp.status}`;
          const body = await resp.text().catch(() => "");
          console.error("[ai-call] anthropic error", resp.status, body.slice(0, 300));
        } else {
          const data = (await resp.json()) as {
            content?: Array<{ type: string; text?: string }>;
            usage?: {
              input_tokens?: number;
              output_tokens?: number;
              cache_read_input_tokens?: number;
            };
          };
          responseContent =
            data.content?.find((c) => c.type === "text")?.text?.trim() ?? "";
          usage = {
            input_tokens: data.usage?.input_tokens ?? 0,
            output_tokens: data.usage?.output_tokens ?? 0,
            cached_input_tokens: data.usage?.cache_read_input_tokens ?? 0,
          };
        }
      }
    } else if (params.provider === "lovable_ai_gateway") {
      const apiKey = process.env.LOVABLE_API_KEY;
      if (!apiKey) {
        status = "error_app";
        errorCode = "missing_api_key";
      } else {
        // Gateway expects messages with system as a first message.
        const messages = params.system
          ? [{ role: "system", content: params.system }, ...params.messages]
          : params.messages;
        const resp = await fetch(
          "https://ai.gateway.lovable.dev/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: params.model,
              max_tokens: params.maxTokens,
              messages,
            }),
          },
        );
        providerStatus = resp.status;
        if (!resp.ok) {
          status = "error_provider";
          errorCode = `http_${resp.status}`;
          const body = await resp.text().catch(() => "");
          console.error("[ai-call] gateway error", resp.status, body.slice(0, 300));
        } else {
          const data = (await resp.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
            usage?: {
              prompt_tokens?: number;
              completion_tokens?: number;
              prompt_cache_hit_tokens?: number;
            };
          };
          responseContent = data.choices?.[0]?.message?.content?.trim() ?? "";
          usage = {
            input_tokens: data.usage?.prompt_tokens ?? 0,
            output_tokens: data.usage?.completion_tokens ?? 0,
            cached_input_tokens: data.usage?.prompt_cache_hit_tokens ?? 0,
          };
        }
      }
    }
  } catch (e) {
    status = "error_app";
    errorCode = (e instanceof Error ? e.message : "unknown").slice(0, 100);
  }

  const credits = await getCreditCost(params.callType);
  const cost = computeCost(params.model, usage);

  await logCall({
    userId: params.userId,
    callType: params.callType,
    provider: params.provider,
    model: params.model,
    status,
    errorCode,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cachedInputTokens: usage.cached_input_tokens,
    costUsd: cost,
    creditsConsumed: status === "success" ? credits : 0,
    planAtTime,
    readingId: params.readingId,
    patternId: params.patternId,
    durationMs: Date.now() - startTime,
    idempotencyKey,
  });

  if (status !== "success") {
    return {
      ok: false,
      error: status === "error_provider" ? "error_provider" : "error_app",
      reason: errorCode ?? undefined,
      status: providerStatus,
    };
  }

  const remaining = params.userId ? await getAvailableCredits(params.userId) : 0;
  return {
    ok: true,
    content: responseContent,
    creditsConsumed: credits,
    remainingCredits: remaining,
    usage,
    costUsd: cost,
  };
}

/**
 * Convenience wrapper: returns the AI text or null on failure.
 * Used by call sites that only care about content + want a thin migration.
 */
export async function callAIText(params: CallAIParams): Promise<string | null> {
  const r = await callAI(params);
  return r.ok ? r.content : null;
}

/**
 * Helper: looks up is_premium from user_preferences. Returns false on failure.
 */
export async function isUserPremium(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  try {
    const { data } = await supabaseAdmin
      .from("user_preferences")
      .select("is_premium, premium_expires_at")
      .eq("user_id", userId)
      .maybeSingle();
    const row = data as { is_premium?: boolean | null; premium_expires_at?: string | null } | null;
    if (!row?.is_premium) return false;
    if (row.premium_expires_at && new Date(row.premium_expires_at).getTime() < Date.now()) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Q31 — convenience wrapper for callers that want the legacy Anthropic
 * model fallback chain (sonnet-4-6 → sonnet-4-5 → haiku-4-5). Each
 * tried model produces an independent ai_call_log row so accounting
 * stays accurate when the first model 404s.
 */
export async function callAnthropicWithFallback(opts: {
  callType: AICallType;
  userId: string | null;
  isPremium?: boolean;
  readingId?: string | null;
  patternId?: string | null;
  system: string;
  user: string;
  maxTokens: number;
  models?: string[];
}): Promise<{ ok: true; content: string } | { ok: false; error: CallAIFailure["error"] }> {
  const models = opts.models ?? [
    "claude-sonnet-4-6",
    "claude-sonnet-4-5-20250929",
    "claude-haiku-4-5-20251001",
  ];
  let lastErr: CallAIFailure["error"] = "ai_unavailable";
  for (const model of models) {
    const r = await callAI({
      callType: opts.callType,
      provider: "anthropic",
      model,
      userId: opts.userId,
      isPremium: opts.isPremium,
      readingId: opts.readingId,
      patternId: opts.patternId,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
      maxTokens: opts.maxTokens,
    });
    if (r.ok && r.content) return { ok: true, content: r.content };
    if (!r.ok) {
      lastErr = r.error;
      // Quota/rate/disabled: stop fast — no point trying other models.
      if (
        r.error === "quota_exceeded" ||
        r.error === "rate_limited" ||
        r.error === "ai_disabled"
      ) {
        return { ok: false, error: r.error };
      }
      // 404/410-style "model not found" → try next model.
      if (r.status === 404 || r.status === 410) continue;
      // Any other provider/app error: bail.
      return { ok: false, error: r.error };
    }
  }
  return { ok: false, error: lastErr };
}
