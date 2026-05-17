/**
 * Phase 9 — Weave detection server function wrapper.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { detectWeavesForUser, type DetectWeavesResult } from "@/lib/weaves.server";

export type {
  DetectWeavesCounts,
  DetectWeavesResult,
  PreviewWeavesResult,
  WeavePreview,
} from "@/lib/weaves.server";

export const detectWeaves = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DetectWeavesResult> => {
    try {
      const { supabase, userId } = context;
      const { inserted, existing } = await detectWeavesForUser(
        supabase,
        userId,
      );
      return {
        ok: true,
        weaves_detected: inserted,
        weaves_existing: existing,
      };
    } catch (e) {
      console.error("[detectWeaves] failed", e);
      return { ok: false, weaves_detected: 0, weaves_existing: 0 };
    }
  });
