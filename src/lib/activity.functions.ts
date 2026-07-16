/**
 * v3.52 — activity capture.
 *
 * `recordActivityEvent` is the single first-party write path (analogous to
 * logCall() for AI). It runs through requireSupabaseAuth so we always have a
 * user_id (anonymous auth users included), and inserts via the service-role
 * client so RLS stays locked to admins for reads. Never throws to the caller.
 *
 * `logActivityServer` is a server-only helper other server functions can call
 * directly (e.g. after saving a reading) without a round-trip.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const EventInput = z.object({
  eventName: z.string().min(1).max(64),
  properties: z.record(z.string(), z.unknown()).optional(),
  sessionId: z.string().max(64).optional(),
  userAgent: z.string().max(400).optional(),
  timeZone: z.string().max(64).optional(),
});

export async function logActivityServer(
  userId: string | null,
  eventName: string,
  properties: Record<string, unknown> = {},
): Promise<void> {
  try {
    await supabaseAdmin.from("activity_events").insert({
      user_id: userId,
      event_name: eventName,
      properties,
    });
  } catch {
    /* activity logging must never break the caller */
  }
}

export const recordActivityEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => EventInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    try {
      const { userId } = context;
      await supabaseAdmin.from("activity_events").insert({
        user_id: userId,
        session_id: data.sessionId ?? null,
        event_name: data.eventName,
        properties: data.properties ?? {},
        user_agent: data.userAgent ?? null,
        time_zone: data.timeZone ?? null,
      });
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });
