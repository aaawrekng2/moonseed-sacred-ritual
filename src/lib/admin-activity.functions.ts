/**
 * v3.52 — admin queries for the Activity dashboard.
 *
 * Admin-gated (requireSupabaseAuth + has_admin_role). Reads via the service-role
 * client AFTER the role check. Unifies three streams into one activity view:
 *   - activity_events (sessions, feature use)
 *   - readings        (a reading was drawn/saved)
 *   - ai_call_log     (an AI call happened)
 * so the dashboard is useful immediately, before feature instrumentation lands.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
const db = supabaseAdmin as any;

async function assertAdmin(supabase: any, userId: string): Promise<void> {
  const { data, error } = await supabase.rpc("has_admin_role", { _user_id: userId });
  if (error || data !== true) throw new Error("Not authorized");
}

const DAY = 86400000;
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

type Row = { user_id: string | null; created_at: string };

async function fetchWindow(table: string, sinceIso: string): Promise<Row[]> {
  const { data } = await db
    .from(table)
    .select("user_id, created_at")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(50000);
  return (data ?? []) as Row[];
}

export const getActivityMetrics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ days: z.number().min(1).max(90).default(30) }).parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const now = Date.now();
    const sinceIso = new Date(now - data.days * DAY).toISOString();

    const [events, readings, aiCalls] = await Promise.all([
      fetchWindow("activity_events", sinceIso),
      fetchWindow("readings", sinceIso),
      fetchWindow("ai_call_log", sinceIso),
    ]);
    const all: Row[] = [...events, ...readings, ...aiCalls];

    const activeSince = (ms: number) => {
      const cut = now - ms;
      const s = new Set<string>();
      for (const r of all) {
        if (r.user_id && new Date(r.created_at).getTime() >= cut) s.add(r.user_id);
      }
      return s.size;
    };

    // Unified daily volume (last 14 days).
    const volMap: Record<string, number> = {};
    for (let i = 13; i >= 0; i--) volMap[ymd(new Date(now - i * DAY))] = 0;
    for (const r of all) {
      const k = r.created_at.slice(0, 10);
      if (k in volMap) volMap[k] += 1;
    }
    const volume = Object.entries(volMap).map(([day, count]) => ({ day, count }));

    // Top named events (from activity_events) + synthesized reading/AI rows.
    const nameCounts: Record<string, number> = {
      reading_saved: readings.length,
      ai_call: aiCalls.length,
    };
    for (const e of events as Array<Row & { event_name?: string }>) {
      const n = (e as any).event_name as string | undefined;
      if (n) nameCounts[n] = (nameCounts[n] ?? 0) + 1;
    }
    const topEvents = Object.entries(nameCounts)
      .filter(([, c]) => c > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([event_name, count]) => ({ event_name, count }));

    return {
      activeToday: activeSince(DAY),
      active7d: activeSince(7 * DAY),
      active30d: activeSince(30 * DAY),
      totalEvents: all.length,
      volume,
      topEvents,
    };
  });

type FeedItem = {
  created_at: string;
  user_id: string | null;
  email: string | null;
  event_name: string;
  detail: string;
  time_zone: string | null;
  user_agent: string | null;
};

export const getActivityFeed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        days: z.number().min(1).max(90).default(7),
        eventName: z.string().optional(),
        userId: z.string().optional(),
        limit: z.number().min(1).max(500).default(150),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }): Promise<FeedItem[]> => {
    await assertAdmin(context.supabase, context.userId);
    const sinceIso = new Date(Date.now() - data.days * DAY).toISOString();

    let evq = db
      .from("activity_events")
      .select("created_at, user_id, event_name, properties, time_zone, user_agent")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.userId) evq = evq.eq("user_id", data.userId);
    if (data.eventName) evq = evq.eq("event_name", data.eventName);

    const items: FeedItem[] = [];
    const { data: evs } = await evq;
    for (const e of (evs ?? []) as any[]) {
      items.push({
        created_at: e.created_at,
        user_id: e.user_id,
        email: null,
        event_name: e.event_name,
        detail: e.properties ? JSON.stringify(e.properties) : "",
        time_zone: e.time_zone ?? null,
        user_agent: e.user_agent ?? null,
      });
    }

    // Fold in readings + AI calls unless a specific activity_event filter is set.
    if (!data.eventName) {
      let rq = db
        .from("readings")
        .select("created_at, user_id, spread_type, is_deep_reading")
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(data.limit);
      if (data.userId) rq = rq.eq("user_id", data.userId);
      const { data: rs } = await rq;
      for (const r of (rs ?? []) as any[]) {
        items.push({
          created_at: r.created_at,
          user_id: r.user_id,
          email: null,
          event_name: r.is_deep_reading ? "deep_reading" : "reading_saved",
          detail: r.spread_type ?? "",
          time_zone: null,
          user_agent: null,
        });
      }

      let aq = db
        .from("ai_call_log")
        .select("created_at, user_id, call_type, status")
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(data.limit);
      if (data.userId) aq = aq.eq("user_id", data.userId);
      const { data: as_ } = await aq;
      for (const a of (as_ ?? []) as any[]) {
        items.push({
          created_at: a.created_at,
          user_id: a.user_id,
          email: null,
          event_name: `ai_${a.call_type ?? "call"}`,
          detail: a.status ?? "",
          time_zone: null,
          user_agent: null,
        });
      }
    }

    items.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    const trimmed = items.slice(0, data.limit);

    // Attach emails for the visible rows.
    const ids = Array.from(new Set(trimmed.map((i) => i.user_id).filter(Boolean))) as string[];
    if (ids.length) {
      const { data: profs } = await db
        .from("user_preferences")
        .select("user_id, display_name")
        .in("user_id", ids);
      const nameById = new Map((profs ?? []).map((p: any) => [p.user_id, p.display_name]));
      for (const it of trimmed) {
        if (it.user_id && nameById.has(it.user_id)) it.email = nameById.get(it.user_id) ?? null;
      }
    }
    return trimmed;
  });
