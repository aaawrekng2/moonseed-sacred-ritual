/**
 * EA — Settings → Security tab.
 *
 * Surfaces multi-factor authentication state. Currently supports TOTP
 * (authenticator app) via Supabase's native MFA API. Other factor types
 * (SMS, email) are not implemented — see the EA scoping decision in the
 * styling doc.
 *
 * States:
 *  - No factor enrolled  → "Set up MFA" button → enroll flow
 *  - Factor enrolled     → status + "Disable MFA" button
 *
 * Enroll flow (modal):
 *  1. Call supabase.auth.mfa.enroll({ factorType: "totp" })
 *  2. Show the QR code + secret string for manual entry
 *  3. Seeker scans into their authenticator app
 *  4. Seeker enters the 6-digit code from the app
 *  5. challenge() + verify() to confirm
 *  6. Generate recovery codes (10 single-use codes, displayed once)
 *  7. Save recovery codes to the seeker's user_preferences row
 *
 * Disable flow:
 *  1. Seeker confirms via the canonical useConfirm dialog
 *  2. Call supabase.auth.mfa.unenroll({ factorId })
 *  3. Clear recovery codes from user_preferences
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Shield, ShieldCheck, ShieldOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "./SettingsContext";
import { SettingsSection } from "./sections";
import { Modal } from "@/components/ui/modal";
import { useConfirm } from "@/hooks/use-confirm";
import { useServerFn } from "@tanstack/react-start";
import {
  generateMfaRecoveryCodes,
  clearMfaRecoveryCodes,
} from "@/lib/mfa-recovery.functions";

type FactorRow = {
  id: string;
  friendly_name?: string | null;
  factor_type: string;
  status: "verified" | "unverified" | string;
};

type EnrollState =
  | { phase: "idle" }
  | {
      phase: "scan";
      factorId: string;
      qr: string;
      secret: string;
      code: string;
      submitting: boolean;
      error: string | null;
    }
  | {
      phase: "recovery";
      codes: string[];
      acknowledged: boolean;
    };

export function SecurityTab() {
  const { user } = useSettings();
  const confirm = useConfirm();
  const generateCodes = useServerFn(generateMfaRecoveryCodes);
  const clearCodes = useServerFn(clearMfaRecoveryCodes);
  const [loading, setLoading] = useState(true);
  const [factors, setFactors] = useState<FactorRow[]>([]);
  const [recoveryCount, setRecoveryCount] = useState<number | null>(null);
  const [enrollState, setEnrollState] = useState<EnrollState>({ phase: "idle" });
  const [regenerating, setRegenerating] = useState(false);

  const verifiedTotp = useMemo(
    () =>
      factors.find(
        (f) => f.factor_type === "totp" && f.status === "verified",
      ) ?? null,
    [factors],
  );

  /**
   * Refresh factor list + recovery-code count. Called on mount, after
   * enroll completes, and after unenroll.
   */
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // Supabase MFA factor list. Returns `totp` + `phone` arrays in
      // supabase-js 2.x; we only consume `totp` for EA.
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) {
        console.error("[SecurityTab] listFactors", error);
      }
      const totp = (data?.totp ?? []) as FactorRow[];
      setFactors(totp);

      // Recovery-code count is informational only; the codes themselves
      // live in user_preferences.mfa_recovery_codes as a text[] column.
      // Stored hashed in production; for EA we store the codes plain
      // since the seeker has just seen them and they're per-account.
      const { data: prefs } = await supabase
        .from("user_preferences")
        .select("mfa_recovery_codes")
        .eq("user_id", user.id)
        .maybeSingle();
      const codes =
        (prefs as { mfa_recovery_codes?: string[] | null } | null)
          ?.mfa_recovery_codes ?? null;
      setRecoveryCount(Array.isArray(codes) ? codes.length : null);
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // --- Enroll flow ---

  const startEnroll = async () => {
    try {
      // Clean up any unverified factors from a previous abandoned
      // enroll. Supabase rejects new enrolls if an unverified factor of
      // the same type already exists.
      const stale = factors.find(
        (f) => f.factor_type === "totp" && f.status !== "verified",
      );
      if (stale) {
        await supabase.auth.mfa.unenroll({ factorId: stale.id });
      }
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Tarot Seed",
      });
      if (error || !data) {
        console.error("[SecurityTab] enroll", error);
        return;
      }
      setEnrollState({
        phase: "scan",
        factorId: data.id,
        qr: data.totp.qr_code,
        secret: data.totp.secret,
        code: "",
        submitting: false,
        error: null,
      });
    } catch (e) {
      console.error("[SecurityTab] enroll threw", e);
    }
  };

  const cancelEnroll = async () => {
    // Roll back any in-flight enroll so the next attempt is clean.
    if (enrollState.phase === "scan") {
      try {
        await supabase.auth.mfa.unenroll({ factorId: enrollState.factorId });
      } catch (e) {
        console.error("[SecurityTab] cancel unenroll threw", e);
      }
    }
    setEnrollState({ phase: "idle" });
    void refresh();
  };

  const submitCode = async () => {
    if (enrollState.phase !== "scan") return;
    const code = enrollState.code.trim();
    if (code.length !== 6) {
      setEnrollState({ ...enrollState, error: "Enter the 6-digit code." });
      return;
    }
    setEnrollState({ ...enrollState, submitting: true, error: null });
    try {
      const ch = await supabase.auth.mfa.challenge({
        factorId: enrollState.factorId,
      });
      if (ch.error || !ch.data) {
        setEnrollState({
          ...enrollState,
          submitting: false,
          error: ch.error?.message ?? "Could not start challenge.",
        });
        return;
      }
      const v = await supabase.auth.mfa.verify({
        factorId: enrollState.factorId,
        challengeId: ch.data.id,
        code,
      });
      if (v.error) {
        setEnrollState({
          ...enrollState,
          submitting: false,
          error: v.error.message ?? "Code did not match.",
        });
        return;
      }
      // Verified. Generate codes server-side (only hashes are
      // persisted to the DB) and surface the plaintext to the seeker
      // exactly once.
      let codes: string[] = [];
      try {
        const result = await generateCodes({});
        codes = result.codes;
      } catch (e) {
        console.error("[SecurityTab] save recovery codes", e);
      }
      setEnrollState({ phase: "recovery", codes, acknowledged: false });
      void refresh();
    } catch (e) {
      console.error("[SecurityTab] verify threw", e);
      setEnrollState({
        ...enrollState,
        submitting: false,
        error: "Something went wrong. Please try again.",
      });
    }
  };

  // --- Disable flow ---

  const disableMfa = async () => {
    if (!verifiedTotp) return;
    const ok = await confirm({
      title: "Disable MFA?",
      description:
        "Your account will no longer require a code from your authenticator app to sign in. You can re-enable MFA at any time.",
      confirmLabel: "Disable",
      cancelLabel: "Keep enabled",
      destructive: true,
    });
    if (!ok) return;
    try {
      await supabase.auth.mfa.unenroll({ factorId: verifiedTotp.id });
      try {
        await clearCodes({});
      } catch (e) {
        console.error("[SecurityTab] clear codes", e);
      }
      void refresh();
    } catch (e) {
      console.error("[SecurityTab] unenroll threw", e);
    }
  };

  // --- Regenerate recovery codes ---

  const regenerateRecoveryCodes = async () => {
    if (!verifiedTotp) return;
    const ok = await confirm({
      title: "Generate new recovery codes?",
      description:
        "Your previous recovery codes will stop working. You'll be shown the new codes once — save them somewhere safe.",
      confirmLabel: "Generate new codes",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
    setRegenerating(true);
    try {
      let codes: string[] = [];
      try {
        const result = await generateCodes({});
        codes = result.codes;
      } catch (e) {
        console.error("[SecurityTab] regenerate", e);
        return;
      }
      setEnrollState({ phase: "recovery", codes, acknowledged: false });
      void refresh();
    } finally {
      setRegenerating(false);
    }
  };

  // --- Render ---

  return (
    <SettingsSection
      title="Security"
      description="Protect your account with a second sign-in step from your authenticator app."
    >
      {loading ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "16px 0",
            color: "var(--color-foreground)",
            opacity: 0.7,
          }}
        >
          <Loader2 size={16} className="animate-spin" />
          <span
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: 13,
            }}
          >
            Loading…
          </span>
        </div>
      ) : verifiedTotp ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
            padding: 18,
            borderRadius: 12,
            background: "var(--surface-card)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <ShieldCheck
              size={20}
              style={{ color: "var(--accent, var(--gold))" }}
            />
            <div>
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontStyle: "italic",
                  fontSize: 16,
                  color: "var(--color-foreground)",
                }}
              >
                MFA is enabled
              </div>
              <div
                style={{
                  fontFamily: "var(--font-serif)",
                  fontSize: 12,
                  color: "var(--color-foreground)",
                  opacity: 0.75,
                  marginTop: 2,
                }}
              >
                Authenticator app
                {recoveryCount !== null
                  ? ` · ${recoveryCount} recovery codes remaining`
                  : ""}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => void regenerateRecoveryCodes()}
              disabled={regenerating}
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: 12,
                padding: "6px 14px",
                borderRadius: 9999,
                background: "transparent",
                border: "1px solid var(--border-subtle)",
                color: "var(--color-foreground)",
                cursor: regenerating ? "not-allowed" : "pointer",
                opacity: regenerating ? 0.5 : 1,
              }}
            >
              {regenerating ? "Generating…" : "Regenerate recovery codes"}
            </button>
            <button
              type="button"
              onClick={() => void disableMfa()}
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: 12,
                padding: "6px 14px",
                borderRadius: 9999,
                background: "transparent",
                border:
                  "1px solid color-mix(in oklab, var(--destructive, #b94c4c) 55%, transparent)",
                color: "var(--color-foreground)",
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <ShieldOff size={13} strokeWidth={1.5} />
                Disable MFA
              </span>
            </button>
          </div>
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
            padding: 18,
            borderRadius: 12,
            background: "var(--surface-card)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Shield
              size={20}
              style={{ color: "var(--color-foreground)", opacity: 0.7 }}
            />
            <div>
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontStyle: "italic",
                  fontSize: 16,
                  color: "var(--color-foreground)",
                }}
              >
                MFA is not set up
              </div>
              <div
                style={{
                  fontFamily: "var(--font-serif)",
                  fontSize: 12,
                  color: "var(--color-foreground)",
                  opacity: 0.75,
                  marginTop: 2,
                }}
              >
                Add a second sign-in step using an authenticator app like
                1Password, Authy, or Google Authenticator.
              </div>
            </div>
          </div>
          <div>
            <button
              type="button"
              onClick={() => void startEnroll()}
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: 13,
                padding: "8px 18px",
                borderRadius: 9999,
                background:
                  "color-mix(in oklab, var(--accent, var(--gold)) 55%, transparent)",
                border:
                  "1px solid color-mix(in oklab, var(--accent, var(--gold)) 70%, transparent)",
                color: "var(--color-foreground)",
                cursor: "pointer",
              }}
            >
              Set up MFA
            </button>
          </div>
        </div>
      )}

      {/* Enroll modal — scan QR + enter code */}
      <Modal
        open={enrollState.phase === "scan"}
        onClose={() => void cancelEnroll()}
        title="Set up authenticator"
        subtitle="Scan the code with your authenticator app, then enter the 6-digit code below."
        size="sm"
      >
        {enrollState.phase === "scan" && (
          <div
            style={{
              padding: "8px 22px 22px",
              display: "flex",
              flexDirection: "column",
              gap: 14,
              alignItems: "center",
            }}
          >
            <div
              style={{
                width: 200,
                height: 200,
                padding: 12,
                borderRadius: 10,
                background: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              // Supabase returns the QR as a data: URL or a raw SVG
              // string. Both render correctly inside dangerouslySetInnerHTML
              // when the string is an <svg> blob; if it's a data URL,
              // use an <img>. We detect and branch.
              dangerouslySetInnerHTML={
                enrollState.qr.startsWith("<svg")
                  ? { __html: enrollState.qr }
                  : undefined
              }
            >
              {enrollState.qr.startsWith("<svg") ? null : (
                <img
                  src={enrollState.qr}
                  alt="MFA QR code"
                  style={{ width: "100%", height: "100%" }}
                />
              )}
            </div>
            <details style={{ width: "100%" }}>
              <summary
                style={{
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: 12,
                  color: "var(--color-foreground)",
                  opacity: 0.7,
                  cursor: "pointer",
                  textAlign: "center",
                }}
              >
                Can't scan? Enter the secret manually
              </summary>
              <div
                style={{
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: 12,
                  marginTop: 8,
                  padding: "8px 12px",
                  borderRadius: 8,
                  background:
                    "color-mix(in oklab, var(--color-foreground) 4%, transparent)",
                  border: "1px solid var(--border-subtle)",
                  color: "var(--color-foreground)",
                  wordBreak: "break-all",
                  textAlign: "center",
                }}
              >
                {enrollState.secret}
              </div>
            </details>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              autoComplete="one-time-code"
              placeholder="6-digit code"
              value={enrollState.code}
              onChange={(e) =>
                setEnrollState({
                  ...enrollState,
                  code: e.target.value.replace(/\D/g, "").slice(0, 6),
                  error: null,
                })
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitCode();
              }}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid var(--border-default)",
                background:
                  "color-mix(in oklab, var(--color-foreground) 4%, transparent)",
                color: "var(--color-foreground)",
                fontFamily: "var(--font-mono, monospace)",
                fontSize: 16,
                letterSpacing: "0.3em",
                textAlign: "center",
                outline: "none",
              }}
            />
            {enrollState.error && (
              <div
                style={{
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: 12,
                  color: "var(--color-foreground)",
                  opacity: 0.85,
                  textAlign: "center",
                }}
              >
                {enrollState.error}
              </div>
            )}
            <div
              style={{
                display: "flex",
                gap: 10,
                width: "100%",
                justifyContent: "flex-end",
              }}
            >
              <button
                type="button"
                onClick={() => void cancelEnroll()}
                disabled={enrollState.submitting}
                style={{
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: 13,
                  padding: "6px 14px",
                  borderRadius: 9999,
                  background: "transparent",
                  border: "1px solid var(--border-subtle)",
                  color: "var(--color-foreground)",
                  cursor: enrollState.submitting ? "not-allowed" : "pointer",
                  opacity: enrollState.submitting ? 0.5 : 1,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitCode()}
                disabled={
                  enrollState.submitting || enrollState.code.length !== 6
                }
                style={{
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: 13,
                  padding: "6px 16px",
                  borderRadius: 9999,
                  background:
                    "color-mix(in oklab, var(--accent, var(--gold)) 55%, transparent)",
                  border:
                    "1px solid color-mix(in oklab, var(--accent, var(--gold)) 70%, transparent)",
                  color: "var(--color-foreground)",
                  cursor:
                    enrollState.submitting || enrollState.code.length !== 6
                      ? "not-allowed"
                      : "pointer",
                  opacity:
                    enrollState.submitting || enrollState.code.length !== 6
                      ? 0.5
                      : 1,
                }}
              >
                {enrollState.submitting ? "Verifying…" : "Verify"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Recovery codes — shown once after enroll OR regenerate. */}
      <Modal
        open={enrollState.phase === "recovery"}
        onClose={() => {
          if (
            enrollState.phase === "recovery" &&
            !enrollState.acknowledged
          ) {
            // Don't allow accidental dismissal without acknowledging.
            return;
          }
          setEnrollState({ phase: "idle" });
        }}
        closeOnEscape={false}
        closeOnOutsideClick={false}
        title="Save your recovery codes"
        subtitle="Each code can be used once to sign in if you lose your authenticator. You won't see these again."
        size="sm"
      >
        {enrollState.phase === "recovery" && (
          <div
            style={{
              padding: "8px 22px 22px",
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 6,
                padding: 14,
                borderRadius: 10,
                background:
                  "color-mix(in oklab, var(--color-foreground) 4%, transparent)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              {enrollState.codes.map((c) => (
                <div
                  key={c}
                  style={{
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: 13,
                    color: "var(--color-foreground)",
                    textAlign: "center",
                    padding: "4px 0",
                    letterSpacing: "0.05em",
                  }}
                >
                  {c}
                </div>
              ))}
            </div>
            <div
              style={{
                display: "flex",
                gap: 10,
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(
                    enrollState.codes.join("\n"),
                  );
                }}
                style={{
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: 12,
                  padding: "6px 14px",
                  borderRadius: 9999,
                  background: "transparent",
                  border: "1px solid var(--border-subtle)",
                  color: "var(--color-foreground)",
                  cursor: "pointer",
                }}
              >
                Copy all
              </button>
              <button
                type="button"
                onClick={() =>
                  setEnrollState({ phase: "idle" })
                }
                style={{
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: 13,
                  padding: "6px 18px",
                  borderRadius: 9999,
                  background:
                    "color-mix(in oklab, var(--accent, var(--gold)) 55%, transparent)",
                  border:
                    "1px solid color-mix(in oklab, var(--accent, var(--gold)) 70%, transparent)",
                  color: "var(--color-foreground)",
                  cursor: "pointer",
                }}
              >
                I've saved them
              </button>
            </div>
          </div>
        )}
      </Modal>
    </SettingsSection>
  );
}
