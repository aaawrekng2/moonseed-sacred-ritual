/**
 * EB — Delete Selected Data confirmation modal.
 *
 * Flow:
 *  1. Seeker picks categories via checkboxes (top "All" master toggle)
 *  2. Verification footer:
 *      - If MFA is enrolled → 6-digit TOTP code input. On submit, the
 *        modal runs supabase.auth.mfa.challenge() + verify() locally,
 *        which upgrades the session to AAL2. Only then does it call
 *        the delete-user-data edge function.
 *      - If MFA is NOT enrolled → seeker types "delete" (case-
 *        insensitive). The edge function does not verify the typing
 *        itself; the JWT proves account ownership and the text gate
 *        is enforced client-side.
 *  3. On success:
 *      - Set sessionStorage flag so the sign-in screen surfaces the
 *        "Your data has been deleted." banner
 *      - signOutAndClear()
 *      - Force a hard navigation to / so the auth gate shows
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Modal } from "@/components/ui/modal";
import { signOutAndClear } from "@/lib/sign-out";

type ScopeKey =
  | "readings_etc"
  | "custom_decks"
  | "stories"
  | "preferences"
  | "credits_ai"
  | "signin_account";

type ScopeOption = {
  key: ScopeKey;
  label: string;
  description: string;
};

const SCOPE_OPTIONS: ScopeOption[] = [
  {
    key: "readings_etc",
    label: "Readings, interpretations, photos, tags, notes",
    description:
      "Everything you've recorded in your journal, including attached images.",
  },
  {
    key: "custom_decks",
    label: "Custom decks and card images",
    description: "Decks you've uploaded and their scanned card art.",
  },
  {
    key: "stories",
    label: "Stories, patterns, weaves",
    description: "Memory layer the app surfaces over time.",
  },
  {
    key: "preferences",
    label: "Preferences",
    description:
      "Theme, voice, blueprint, and other settings. Will reset to defaults.",
  },
  {
    key: "credits_ai",
    label: "Credit grants and AI usage history",
    description: "Past AI calls and any credit grants on your account.",
  },
  {
    key: "signin_account",
    label: "Sign-in account (email + password)",
    description:
      "Closes your account. You won't be able to sign in with this email again.",
  },
];

// sessionStorage key consumed by AuthScreen to show the "Your data has
// been deleted." banner once.
export const SS_DELETED_BANNER = "tarotseed:auth-deleted-banner";

export function DeleteDataModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [scope, setScope] = useState<Record<ScopeKey, boolean>>(() =>
    Object.fromEntries(SCOPE_OPTIONS.map((o) => [o.key, false])) as Record<
      ScopeKey,
      boolean
    >,
  );
  const [hasMfa, setHasMfa] = useState<boolean | null>(null);
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [textConfirm, setTextConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state every time the modal opens.
  useEffect(() => {
    if (!open) return;
    setScope(
      Object.fromEntries(SCOPE_OPTIONS.map((o) => [o.key, false])) as Record<
        ScopeKey,
        boolean
      >,
    );
    setCode("");
    setTextConfirm("");
    setError(null);
    setSubmitting(false);

    // Probe MFA state. Only verified TOTP factors count.
    void (async () => {
      try {
        const { data } = await supabase.auth.mfa.listFactors();
        const verified =
          (data?.totp ?? []).find((f) => f.status === "verified") ?? null;
        setHasMfa(!!verified);
        setMfaFactorId(verified?.id ?? null);
      } catch {
        setHasMfa(false);
        setMfaFactorId(null);
      }
    })();
  }, [open]);

  const allChecked = SCOPE_OPTIONS.every((o) => scope[o.key]);
  const anyChecked = SCOPE_OPTIONS.some((o) => scope[o.key]);

  const toggleAll = (checked: boolean) => {
    setScope(
      Object.fromEntries(SCOPE_OPTIONS.map((o) => [o.key, checked])) as Record<
        ScopeKey,
        boolean
      >,
    );
  };

  const toggleOne = (key: ScopeKey, checked: boolean) => {
    setScope((prev) => ({ ...prev, [key]: checked }));
  };

  const verificationReady = useMemo(() => {
    if (!anyChecked) return false;
    if (hasMfa === null) return false; // still probing
    if (hasMfa) return code.replace(/\D/g, "").length === 6;
    return textConfirm.trim().toLowerCase() === "delete";
  }, [anyChecked, hasMfa, code, textConfirm]);

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      if (hasMfa) {
        // Run challenge + verify locally to upgrade session to AAL2.
        if (!mfaFactorId) {
          setError("MFA factor missing.");
          setSubmitting(false);
          return;
        }
        const ch = await supabase.auth.mfa.challenge({
          factorId: mfaFactorId,
        });
        if (ch.error || !ch.data) {
          setError(ch.error?.message ?? "Could not start MFA challenge.");
          setSubmitting(false);
          return;
        }
        const v = await supabase.auth.mfa.verify({
          factorId: mfaFactorId,
          challengeId: ch.data.id,
          code: code.replace(/\D/g, "").slice(0, 6),
        });
        if (v.error) {
          setError(v.error.message ?? "MFA code did not match.");
          setSubmitting(false);
          return;
        }
      }

      const verification = hasMfa
        ? { method: "mfa" as const }
        : { method: "text" as const };

      const { data, error: fnErr } = await supabase.functions.invoke(
        "delete-user-data",
        { body: { scope, verification } },
      );
      if (fnErr) {
        setError(fnErr.message ?? "Deletion failed.");
        setSubmitting(false);
        return;
      }
      const result = data as {
        ok: boolean;
        status: string;
        failures?: Array<{ scope: string; error: string }>;
        accountDeleted?: boolean;
      };
      if (!result?.ok) {
        setError("Deletion failed. Please try again or contact support.");
        setSubmitting(false);
        return;
      }
      if (result.failures && result.failures.length > 0) {
        console.warn("[DeleteDataModal] partial failures", result.failures);
      }

      // Set the banner flag and sign out. If the auth user itself was
      // deleted, signOutAndClear will fail silently (already gone),
      // but we still want to clear the local session and land on the
      // sign-in screen.
      try {
        window.sessionStorage.setItem(SS_DELETED_BANNER, "1");
      } catch {
        /* private mode */
      }
      try {
        await signOutAndClear();
      } catch {
        /* already signed out / account gone */
      }
      // Force a hard navigation so the auth gate fully re-renders.
      window.location.href = "/";
    } catch (e) {
      console.error("[DeleteDataModal] submit threw", e);
      setError("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : onClose}
      closeOnEscape={!submitting}
      closeOnOutsideClick={!submitting}
      size="md"
      title="Delete my selected data"
    >
      <div
        style={{
          padding: "8px 22px 22px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {/* Scary copy */}
        <div
          style={{
            display: "flex",
            gap: 10,
            padding: 12,
            borderRadius: 10,
            background:
              "color-mix(in oklab, var(--destructive, #b94c4c) 8%, transparent)",
            border:
              "1px solid color-mix(in oklab, var(--destructive, #b94c4c) 35%, transparent)",
          }}
        >
          <AlertTriangle
            size={18}
            style={{
              color: "var(--destructive, #b94c4c)",
              flexShrink: 0,
              marginTop: 2,
            }}
          />
          <div
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: 13,
              color: "var(--color-foreground)",
              lineHeight: 1.5,
            }}
          >
            This permanently deletes the categories you select. There is no
            undo.
          </div>
        </div>

        {/* All toggle */}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 10px",
            borderRadius: 8,
            background:
              "color-mix(in oklab, var(--color-foreground) 4%, transparent)",
            border: "1px solid var(--border-subtle)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={allChecked}
            onChange={(e) => toggleAll(e.target.checked)}
            style={{ width: 18, height: 18, cursor: "pointer" }}
          />
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontStyle: "italic",
              fontSize: 14,
              color: "var(--color-foreground)",
            }}
          >
            All of the below
          </span>
        </label>

        {/* Scope checkboxes */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {SCOPE_OPTIONS.map((opt) => (
            <label
              key={opt.key}
              style={{
                display: "flex",
                gap: 10,
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid var(--border-subtle)",
                cursor: "pointer",
                alignItems: "flex-start",
              }}
            >
              <input
                type="checkbox"
                checked={scope[opt.key]}
                onChange={(e) => toggleOne(opt.key, e.target.checked)}
                style={{
                  width: 18,
                  height: 18,
                  marginTop: 2,
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontSize: 13,
                    color: "var(--color-foreground)",
                  }}
                >
                  {opt.label}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontSize: 11,
                    color: "var(--color-foreground)",
                    opacity: 0.7,
                    lineHeight: 1.4,
                  }}
                >
                  {opt.description}
                </span>
              </div>
            </label>
          ))}
        </div>

        {/* Verification footer */}
        <div
          style={{
            paddingTop: 12,
            marginTop: 4,
            borderTop: "1px solid var(--border-subtle)",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {hasMfa === null ? (
            <div
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: 12,
                color: "var(--color-foreground)",
                opacity: 0.7,
              }}
            >
              Checking verification…
            </div>
          ) : hasMfa ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label
                style={{
                  fontFamily: "var(--font-serif)",
                  fontSize: 12,
                  color: "var(--color-foreground)",
                  opacity: 0.85,
                }}
              >
                Enter the 6-digit code from your authenticator app
              </label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                autoComplete="one-time-code"
                placeholder="000000"
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                disabled={submitting}
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
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label
                style={{
                  fontFamily: "var(--font-serif)",
                  fontSize: 12,
                  color: "var(--color-foreground)",
                  opacity: 0.85,
                }}
              >
                Type <span style={{ fontWeight: 600 }}>delete</span> to confirm
              </label>
              <input
                type="text"
                value={textConfirm}
                onChange={(e) => setTextConfirm(e.target.value)}
                disabled={submitting}
                placeholder="delete"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid var(--border-default)",
                  background:
                    "color-mix(in oklab, var(--color-foreground) 4%, transparent)",
                  color: "var(--color-foreground)",
                  fontFamily: "var(--font-serif)",
                  fontSize: 14,
                  outline: "none",
                }}
              />
            </div>
          )}
          {error && (
            <div
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: 12,
                color: "var(--destructive, #b94c4c)",
              }}
            >
              {error}
            </div>
          )}
        </div>

        {/* Actions */}
        <div
          style={{
            display: "flex",
            gap: 10,
            justifyContent: "flex-end",
            paddingTop: 4,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: 13,
              padding: "8px 16px",
              borderRadius: 9999,
              background: "transparent",
              border: "1px solid var(--border-subtle)",
              color: "var(--color-foreground)",
              cursor: submitting ? "not-allowed" : "pointer",
              opacity: submitting ? 0.5 : 1,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!verificationReady || submitting}
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: 13,
              padding: "8px 18px",
              borderRadius: 9999,
              background:
                "color-mix(in oklab, var(--destructive, #b94c4c) 70%, transparent)",
              border:
                "1px solid color-mix(in oklab, var(--destructive, #b94c4c) 80%, transparent)",
              color: "#fff",
              cursor:
                !verificationReady || submitting ? "not-allowed" : "pointer",
              opacity: !verificationReady || submitting ? 0.5 : 1,
            }}
          >
            {submitting ? "Deleting…" : "Delete my selected data"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
