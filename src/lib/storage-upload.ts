/**
 * Q31 Stage 1 (Fix 6) — single chokepoint for every Supabase Storage
 * upload initiated by the seeker.
 *
 * Mirrors the callAI() pattern: one wrapper enforces quotas, performs
 * the upload, and appends an immutable row to `storage_event_log` on
 * success. Every component / lib that uploads on behalf of a seeker
 * MUST funnel through `uploadWithQuota` so we have one place to:
 *   • read storage_quota_* from admin_settings
 *   • compute the user's current usage
 *   • record bucket / path / bytes for billing + audit
 *
 * Restore + admin-side uploads (backup-restore.ts, admin.functions.ts)
 * intentionally bypass this wrapper — they are not seeker-initiated.
 */
import { supabase } from "@/integrations/supabase/client";

export type UploadEventType =
  | "photo"
  | "deck_card"
  | "deck_back"
  | "deck_source_zip";

export type UploadWithQuotaArgs = {
  userId: string;
  bucket: string;
  path: string;
  file: Blob | File;
  eventType: UploadEventType;
  contentType?: string;
  upsert?: boolean;
  cacheControl?: string;
  readingId?: string | null;
  deckId?: string | null;
};

export type UploadResult =
  | { ok: true; path: string }
  | {
      ok: false;
      code: "quota_exceeded" | "upload_failed";
      error: string;
    };

/** Compute current photo bytes used by this user from the event log. */
async function photoBytesUsed(userId: string): Promise<number> {
  const { data } = await supabase
    .from("storage_event_log")
    .select("size_bytes")
    .eq("user_id", userId)
    .eq("event_type", "photo");
  if (!data) return 0;
  return (data as Array<{ size_bytes: number | null }>).reduce(
    (sum, r) => sum + Number(r.size_bytes ?? 0),
    0,
  );
}

async function readQuotaBytes(key: string): Promise<number> {
  const { data } = await supabase
    .from("admin_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  const v = (data as { value?: unknown } | null)?.value;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function uploadWithQuota(
  args: UploadWithQuotaArgs,
): Promise<UploadResult> {
  // Q72 — single photo quota from admin_settings.storage_photo_quota_bytes
  // (default 500MB). Deck quotas are enforced at deck-creation time.
  if (args.eventType === "photo") {
    try {
      const configured = await readQuotaBytes("storage_photo_quota_bytes");
      const quotaBytes = configured > 0 ? configured : 500 * 1024 * 1024;
      if (quotaBytes > 0) {
        const used = await photoBytesUsed(args.userId);
        if (used + args.file.size > quotaBytes) {
          return {
            ok: false,
            code: "quota_exceeded",
            error: `Photo storage quota exceeded (${Math.round(used / 1024 / 1024)}MB / ${Math.round(quotaBytes / 1024 / 1024)}MB).`,
          };
        }
      }
    } catch (err) {
      console.warn("[uploadWithQuota] quota check failed (non-fatal)", err);
    }
  }

  const opts: {
    upsert?: boolean;
    contentType?: string;
    cacheControl?: string;
  } = { upsert: args.upsert ?? false };
  if (args.contentType) opts.contentType = args.contentType;
  if (args.cacheControl) opts.cacheControl = args.cacheControl;

  const upRes = await supabase.storage
    .from(args.bucket)
    .upload(args.path, args.file, opts);

  if (upRes.error) {
    return {
      ok: false,
      code: "upload_failed",
      error: upRes.error.message,
    };
  }

  // Best-effort metering write. A failed insert must not poison the
  // upload — the file is already in the bucket.
  try {
    await supabase.from("storage_event_log").insert({
      user_id: args.userId,
      event_type: args.eventType,
      bucket: args.bucket,
      path: args.path,
      size_bytes: args.file.size,
      reading_id: args.readingId ?? null,
      deck_id: args.deckId ?? null,
    });
  } catch (err) {
    console.warn("[uploadWithQuota] event log write failed (non-fatal)", err);
  }

  return { ok: true, path: args.path };
}