import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { X, Eye, EyeOff } from "lucide-react";

type Mode = "signin" | "signup";

export function AuthScreen({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [mode, setMode] = useState<Mode>("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    setSuccess(null);
    if (mode === "signup" && password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }
    setLoading(true);
    try {
      if (mode === "signup") {
        const { data: sessionData } = await supabase.auth.getSession();
        const currentUser = sessionData.session?.user;
        const isAnonymous =
          (currentUser as { is_anonymous?: boolean } | undefined)
            ?.is_anonymous === true;

        if (currentUser && isAnonymous) {
          const { error: upgradeError } = await supabase.auth.updateUser(
            { email, password },
            { emailRedirectTo: window.location.origin },
          );
          if (upgradeError) throw upgradeError;
        } else {
          const { error: signUpError } = await supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: window.location.origin },
          });
          if (signUpError) throw signUpError;
        }

        setSuccess(
          "Account created! Check your email to confirm, then sign in.",
        );
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
        onSuccess();
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-5"
      style={{ background: "rgba(0,0,0,0.7)" }}
    >
      <div
        className="w-full max-w-sm rounded-2xl px-6 py-6 flex flex-col gap-4"
        style={{
          background:
            "linear-gradient(180deg, rgba(14,10,40,0.98) 0%, rgba(10,7,30,0.98) 100%)",
          border:
            "1px solid color-mix(in oklab, var(--gold) 25%, transparent)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <span
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: 11,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "var(--gold)",
              opacity: 0.8,
            }}
          >
            {mode === "signup" ? "Create Account" : "Sign In"}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center justify-center w-6 h-6 rounded-full hover:bg-white/10 transition-colors focus:outline-none"
            style={{ color: "var(--gold)", opacity: 0.6 }}
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>

        {/* Fields */}
        <div className="flex flex-col gap-3">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg px-4 py-2.5 focus:outline-none"
            style={{
              background:
                "color-mix(in oklab, var(--gold) 6%, transparent)",
              border:
                "1px solid color-mix(in oklab, var(--gold) 20%, transparent)",
              color: "var(--foreground)",
              fontFamily: "var(--font-serif)",
              fontSize: 15,
            }}
          />
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg px-4 py-2.5 pr-10 focus:outline-none"
              style={{
                background:
                  "color-mix(in oklab, var(--gold) 6%, transparent)",
                border:
                  "1px solid color-mix(in oklab, var(--gold) 20%, transparent)",
                color: "var(--foreground)",
                fontFamily: "var(--font-serif)",
                fontSize: 15,
              }}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 focus:outline-none"
              style={{ color: "var(--foreground)", opacity: 0.35 }}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff size={15} strokeWidth={1.5} /> : <Eye size={15} strokeWidth={1.5} />}
            </button>
          </div>
          {mode === "signup" && (
            <div className="relative">
              <input
                type={showConfirm ? "text" : "password"}
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-lg px-4 py-2.5 pr-10 focus:outline-none"
                style={{
                  background:
                    "color-mix(in oklab, var(--gold) 6%, transparent)",
                  border: `1px solid ${
                    confirmPassword && confirmPassword !== password
                      ? "rgba(248,113,113,0.5)"
                      : "color-mix(in oklab, var(--gold) 20%, transparent)"
                  }`,
                  color: "var(--foreground)",
                  fontFamily: "var(--font-serif)",
                  fontSize: 15,
                }}
              />
              <button
                type="button"
                onClick={() => setShowConfirm((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 focus:outline-none"
                style={{ color: "var(--foreground)", opacity: 0.35 }}
                aria-label={showConfirm ? "Hide password" : "Show password"}
              >
                {showConfirm ? <EyeOff size={15} strokeWidth={1.5} /> : <Eye size={15} strokeWidth={1.5} />}
              </button>
              {confirmPassword && confirmPassword !== password && (
                <p style={{
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: 11,
                  color: "#f87171",
                  marginTop: 4,
                  paddingLeft: 4,
                }}>
                  Passwords don't match
                </p>
              )}
            </div>
          )}
        </div>

        {/* Error / Success */}
        {error && (
          <p
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: 13,
              color: "#f87171",
              textAlign: "center",
            }}
          >
            {error}
          </p>
        )}
        {success && (
          <p
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: 13,
              color: "var(--gold)",
              textAlign: "center",
              opacity: 0.85,
            }}
          >
            {success}
          </p>
        )}

        {/* Actions */}
        <div className="flex flex-col items-center gap-3 pt-1">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={
              loading ||
              !email ||
              !password ||
              (mode === "signup" && password !== confirmPassword)
            }
            className="w-full rounded-xl py-3 transition-opacity disabled:opacity-40"
            style={{
              background:
                "color-mix(in oklab, var(--gold) 18%, transparent)",
              border:
                "1px solid color-mix(in oklab, var(--gold) 40%, transparent)",
              color: "var(--gold)",
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: 14,
              letterSpacing: "0.1em",
            }}
          >
            {loading
              ? "…"
              : mode === "signup"
                ? "Create Account"
                : "Sign In"}
          </button>

          <button
            type="button"
            onClick={() => {
              setMode(mode === "signup" ? "signin" : "signup");
              setError(null);
              setSuccess(null);
              setConfirmPassword("");
              setShowPassword(false);
              setShowConfirm(false);
            }}
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: 12,
              color: "var(--foreground)",
              opacity: 0.45,
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
            }}
          >
            {mode === "signup"
              ? "Already have an account? Sign in"
              : "No account? Create one"}
          </button>
        </div>
      </div>
    </div>
  );
}