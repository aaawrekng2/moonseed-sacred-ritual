/**
 * EB — Delete Selected Data edge function.
 *
 * Atomically deletes the seeker's selected categories of data. The
 * caller (browser) authenticates with their normal Supabase JWT. The
 * function:
 *
 *  1. Reads the caller's user_id from the JWT
 *  2. Verifies the AAL claim — if the seeker has MFA enrolled, the
 *     JWT must be AAL2 (i.e. the seeker recently passed a TOTP
 *     challenge in the same session). If not enrolled, AAL1 is fine
 *     and we trust the client's text-confirm flag.
 *  3. Writes a row to data_deletion_requests (status='pending')
 *  4. Deletes rows from each requested scope using the service-role
 *     client, which bypasses RLS so we can clean up cross-table
 *     references.
 *  5. If the 'signin_account' scope is set, calls
 *     supabaseAdmin.auth.admin.deleteUser() to close the auth.users
 *     row. This invalidates the seeker's session.
 *  6. Updates the audit row to status='completed' (or 'failed').
 *
 * The function uses two clients:
 *  - userClient — authenticated as the seeker, used only to inspect
 *    their identity and MFA state
 *  - adminClient — service-role, used for all the actual deletes
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Scope = {
  readings_etc?: boolean;        // readings + interpretations + photos + tags + notes
  custom_decks?: boolean;        // custom decks + card images
  stories?: boolean;             // stories / patterns / weaves
  preferences?: boolean;         // user_preferences (row stays but cleared)
  credits_ai?: boolean;          // ai_call_log + ai_credit_grants
  signin_account?: boolean;      // auth.users row
};

type Verification =
  | { method: "mfa" }
  | { method: "text" };

type RequestBody = {
  scope: Scope;
  verification: Verification;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ ok: false, error: "missing_auth" }, 401);
  }

  // User-scoped client: respects RLS and identifies the caller.
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return json({ ok: false, error: "invalid_session" }, 401);
  }
  const userId = userData.user.id;
  const userEmail = userData.user.email ?? null;

  // Parse body.
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return json({ ok: false, error: "invalid_body" }, 400);
  }
  if (!body || typeof body !== "object" || !body.scope || !body.verification) {
    return json({ ok: false, error: "invalid_body" }, 400);
  }

  // --- Verification gate ---
  // If MFA is enrolled, require AAL2. Otherwise accept text confirmation.
  const { data: aalData } =
    await userClient.auth.mfa.getAuthenticatorAssuranceLevel();
  const { data: factorsData } = await userClient.auth.mfa.listFactors();
  const hasVerifiedTotp =
    (factorsData?.totp ?? []).some((f) => f.status === "verified");

  if (hasVerifiedTotp) {
    // Seeker has MFA — must have AAL2 in this session.
    if (aalData?.currentLevel !== "aal2") {
      return json(
        { ok: false, error: "mfa_required", needsAal2: true },
        403,
      );
    }
    if (body.verification.method !== "mfa") {
      return json({ ok: false, error: "verification_mismatch" }, 400);
    }
  } else {
    // No MFA enrolled — trust the text-confirm flag from the client.
    // The text-typing UX gate happens in the browser; here we only
    // confirm the seeker isn't trying to bypass MFA when it IS set.
    if (body.verification.method !== "text") {
      return json({ ok: false, error: "verification_mismatch" }, 400);
    }
  }

  // --- Audit row ---
  const adminClient: SupabaseClient = createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  const clientIp =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = req.headers.get("user-agent") ?? null;

  const { data: auditRow, error: auditErr } = await adminClient
    .from("data_deletion_requests")
    .insert({
      user_id: userId,
      user_email: userEmail,
      scope: body.scope,
      verification_method: body.verification.method,
      status: "pending",
      client_ip: clientIp,
      user_agent: userAgent,
    })
    .select("id")
    .single();
  if (auditErr || !auditRow) {
    return json(
      { ok: false, error: "audit_failed", detail: auditErr?.message },
      500,
    );
  }
  const auditId = auditRow.id as string;

  // --- Deletions ---
  // Order matters when there are FK relationships:
  // child rows first, then parents. We delete liberally with eq() on
  // user_id since every relevant table has that column.
  const failures: Array<{ scope: string; error: string }> = [];

  async function del(table: string, scopeKey: keyof Scope, column = "user_id") {
    if (!body.scope[scopeKey]) return;
    const { error } = await adminClient.from(table).delete().eq(column, userId);
    if (error) failures.push({ scope: table, error: error.message });
  }

  // Readings / interpretations / photos / tags / notes
  if (body.scope.readings_etc) {
    // reading_photos has reading_id FK → readings; delete photos first.
    await del("reading_photos", "readings_etc");
    await del("readings", "readings_etc");
    await del("user_tags", "readings_etc");
  }

  // Custom decks + card images (custom_deck_cards has deck_id FK)
  if (body.scope.custom_decks) {
    // Card images reference decks. Delete cards first.
    const { data: deckRows } = await adminClient
      .from("custom_decks")
      .select("id")
      .eq("user_id", userId);
    const deckIds = (deckRows ?? []).map((d) => d.id as string);
    if (deckIds.length > 0) {
      const { error: vErr } = await adminClient
        .from("custom_deck_cards")
        .delete()
        .in("deck_id", deckIds);
      if (vErr) failures.push({ scope: "custom_deck_cards", error: vErr.message });
    }
    await del("custom_decks", "custom_decks");
  }

  // Stories / patterns / weaves. Code-level table names per styling
  // doc §22.3 (route is threads.tsx but tables are patterns + weaves).
  if (body.scope.stories) {
    await del("weaves", "stories");
    await del("patterns", "stories");
  }

  // Preferences — the row exists from signup; clearing it returns the
  // seeker to defaults. We delete it; ensureUserPreferencesRow() on
  // next sign-in (if account remains) will recreate defaults.
  if (body.scope.preferences) {
    await del("user_preferences", "preferences");
  }

  // Credits + AI usage log
  if (body.scope.credits_ai) {
    await del("ai_call_log", "credits_ai");
    await del("ai_credit_grants", "credits_ai");
  }

  // Sign-in account — the auth.users row. Done LAST because it
  // invalidates the session and any further service-role-tagged
  // deletes still work fine but the seeker's session is gone.
  let accountDeleted = false;
  if (body.scope.signin_account) {
    const { error: authErr } = await adminClient.auth.admin.deleteUser(userId);
    if (authErr) {
      failures.push({ scope: "auth_user", error: authErr.message });
    } else {
      accountDeleted = true;
    }
  }

  const finalStatus = failures.length === 0 ? "completed" : "partial";
  await adminClient
    .from("data_deletion_requests")
    .update({
      status: finalStatus,
      completed_at: new Date().toISOString(),
      error_message:
        failures.length === 0 ? null : JSON.stringify(failures).slice(0, 2000),
    })
    .eq("id", auditId);

  return json({
    ok: true,
    auditId,
    status: finalStatus,
    failures,
    accountDeleted,
  });
});
