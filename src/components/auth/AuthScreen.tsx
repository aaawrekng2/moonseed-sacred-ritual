/**
 * Auth screen — DS restructure.
 *
 * State machine (`AuthMode`):
 *   - signin              — sign-in form (default)
 *   - download-modal      — dedicated download modal (signup form not visible)
 *   - skip-confirm        — "Are you sure?" interrupt over the download modal
 *   - signup-form         — email + password + confirm fields
 *   - signup-confirmation — "check your email" panel after signUp success
 *
 * Tap "Don't have an account? Create one":
 *   • If the session has saved data → open the dedicated download modal.
 *     Inside the modal: idle → downloading → done | error → continue.
 *     Tapping X or Skip opens the skip-confirm interrupt.
 *   • Otherwise → signup-form directly.
 */
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { X, Eye, EyeOff } from "lucide-react";
import { createBackup, type BackupProgress } from "@/lib/backup-export";
import { BACKUP_CATEGORIES } from "@/lib/backup-categories";
import { usePremium } from "@/lib/premium";

type AuthMode =
  | "signin"
  | "download-modal"
  | "skip-confirm"
  | "signup-form"
  | "signup-confirmation";

type DownloadStage = "idle" | "downloading" | "done" | "error";

/**
 * Cheap probe: does the seeker have any rows on this device's session
 * worth backing up before account creation? Resolves quickly via HEAD
 * counts on the tables that matter.
 */
async function userHasData(userId: string): Promise<boolean> {
  const tables: Array<"readings" | "custom_decks" | "user_tags"> = [
    "readings",
    "custom_decks",
    "user_tags",
  ];
  for (const t of tables) {
    try {
      const { count } = await (supabase as unknown as {
        from: (t: string) => {
          select: (
            c: string,
            o: { count: "exact"; head: true },
          ) => { eq: (c: string, v: string) => Promise<{ count: number | null }> };
        };
      })
        .from(t)
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId);
      if ((count ?? 0) > 0) return true;
    } catch {
      // best-effort; treat as no data on transient failures.
    }
  }
  return false;
}

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${s}s`;
}

export function AuthScreen({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Download modal state
  const [downloadStage, setDownloadStage] = useState<DownloadStage>("idle");
  const [downloadProgress, setDownloadProgress] =
    useState<BackupProgress | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadStartedAt, setDownloadStartedAt] = useState<number | null>(
    null,
  );
  const [, setNowTick] = useState(0);

  const sessionUserIdRef = useRef<string | null>(null);

  // Cache the current (anonymous) session uid so we know who to back up.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (!cancelled) {
        sessionUserIdRef.current = data.session?.user?.id ?? null;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const { isPremium } = usePremium(sessionUserIdRef.current ?? undefined);

  // Tick the elapsed-time readout while the download is running.
  useEffect(() => {
    if (downloadStage !== "downloading" || !downloadStartedAt) return;
    const id = window.setInterval(() => setNowTick((n) => n + 1), 250);
    return () => window.clearInterval(id);
  }, [downloadStage, downloadStartedAt]);

  const runDownload = async () => {
    setDownloadError(null);
    setDownloadProgress(null);
    setDownloadStartedAt(Date.now());
    setDownloadStage("downloading");
    try {
      const uid = sessionUserIdRef.current;
      if (!uid) {
        setMode("signup-form");
        setDownloadStage("idle");
        return;
      }
      const blob = await createBackup({
        userId: uid,
        categories: BACKUP_CATEGORIES.map((c) => c.id),
        isPremium,
        onProgress: (p) => setDownloadProgress(p),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `moonseed-backup-${new Date()
        .toISOString()
        .slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setDownloadStage("done");
    } catch (e) {
      setDownloadError(
        e instanceof Error ? e.message : "Couldn't create backup",
      );
      setDownloadStage("error");
    }
  };

  const handleCreateAccountTap = async () => {
    setError(null);
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user?.id ?? null;
    sessionUserIdRef.current = uid;
    if (!uid) {
      setMode("signup-form");
      return;
    }
    const hasData = await userHasData(uid);
    if (hasData) {
      setDownloadStage("idle");
      setDownloadError(null);
      setDownloadProgress(null);
      setMode("download-modal");
    } else {
      setMode("signup-form");
    }
  };

  const handleSubmit = async () => {
    setError(null);
    if (mode === "signup-form" && password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }
    setLoading(true);
    try {
      if (mode === "signup-form") {
        const { data: sessionData } = await supabase.auth.getSession();
        const currentUser = sessionData.session?.user;
        const isAnonymous =
          (currentUser as { is_anonymous?: boolean } | undefined)
            ?.is_anonymous === true;
        if (currentUser && isAnonymous) {
          await supabase.auth.signOut();
        }
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (signUpError) throw signUpError;
        setMode("signup-confirmation");
        return;
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) {
          const msg = (signInError.message ?? "").toLowerCase();
          // Detect Supabase's `email_not_confirmed` and surface a friendly hint.
          const code =
            (signInError as unknown as { code?: string; name?: string }).code ??
            (signInError as unknown as { name?: string }).name ??
            "";
          if (
            String(code).toLowerCase().includes("email_not_confirmed") ||
            msg.includes("email not confirmed") ||
            msg.includes("confirm")
          ) {
            throw new Error(
              "Please confirm your email before signing in. Check your inbox.",
            );
          }
          throw signInError;
        }
        onSuccess();
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  // ---- Render ----
  const headerLabel =
    mode === "signin"
      ? "Sign In"
      : mode === "signup-form"
        ? "Create Account"
        : mode === "signup-confirmation"
          ? "Check Your Email"
          : "Sign In";

  // While a modal is open, the auth panel renders the sign-in form
  // beneath the dimmed backdrop — but the modal itself is the focus.
  const showModal = mode === "download-modal" || mode === "skip-confirm";
  const formMode: AuthMode = showModal ? "signin" : mode;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-5"
      style={{ background: "var(--surface-scrim)" }}
    >
      <div
        className="w-full max-w-sm rounded-2xl px-6 py-6 flex flex-col gap-4"
        style={{
          background: "var(--surface-elevated)",
          color: "var(--color-foreground)",
          border: "1px solid var(--border-default)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <span
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-caption)",
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "var(--gold)",
              opacity: 0.8,
            }}
          >
            {headerLabel}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center justify-center w-6 h-6 rounded-full hover:bg-foreground/10 transition-colors focus:outline-none"
            style={{ color: "var(--gold)", opacity: 0.6 }}
            aria-label="Close"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>

        {mode === "signup-confirmation" && (
          <div className="flex flex-col items-center gap-5 py-6 text-center">
            <p
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: "var(--text-body-lg)",
                color: "var(--foreground)",
                lineHeight: 1.6,
                opacity: 0.92,
                padding: "0 8px",
              }}
            >
              Check your email to confirm your account. Once confirmed, you can sign in.
            </p>
            <button
              type="button"
              onClick={() => {
                setMode("signin");
                setError(null);
                setPassword("");
                setConfirmPassword("");
              }}
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: "var(--text-body-sm)",
                color: "var(--foreground)",
                opacity: 0.55,
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
              }}
            >
              Back to sign in
            </button>
          </div>
        )}

        {(formMode === "signin" || formMode === "signup-form") && (
          <>
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
                  fontSize: "var(--text-body)",
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
                    fontSize: "var(--text-body)",
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 focus:outline-none"
                  style={{ color: "var(--foreground)", opacity: 0.35 }}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff size={15} strokeWidth={1.5} />
                  ) : (
                    <Eye size={15} strokeWidth={1.5} />
                  )}
                </button>
              </div>
              {formMode === "signup-form" && (
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
                      fontSize: "var(--text-body)",
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 focus:outline-none"
                    style={{ color: "var(--foreground)", opacity: 0.35 }}
                    aria-label={showConfirm ? "Hide password" : "Show password"}
                  >
                    {showConfirm ? (
                      <EyeOff size={15} strokeWidth={1.5} />
                    ) : (
                      <Eye size={15} strokeWidth={1.5} />
                    )}
                  </button>
                  {confirmPassword && confirmPassword !== password && (
                    <p
                      style={{
                        fontFamily: "var(--font-serif)",
                        fontStyle: "italic",
                        fontSize: "var(--text-caption)",
                        color: "#f87171",
                        marginTop: 4,
                        paddingLeft: 4,
                      }}
                    >
                      Passwords don't match
                    </p>
                  )}
                </div>
              )}
            </div>

            {error && (
              <p
                style={{
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: "var(--text-body-sm)",
                  color: "#f87171",
                  textAlign: "center",
                }}
              >
                {error}
              </p>
            )}

            <div className="flex flex-col items-center gap-3 pt-1">
              <button
                type="button"
                onClick={handleSubmit}
                disabled={
                  loading ||
                  !email ||
                  !password ||
                  (formMode === "signup-form" && password !== confirmPassword)
                }
                className="w-full py-3 font-display text-sm uppercase tracking-[0.3em] text-gold transition-opacity hover:opacity-80 focus:outline-none disabled:opacity-40"
                style={{
                  background: "none",
                  border: "none",
                  padding: "12px 0",
                }}
              >
                {loading
                  ? "…"
                  : formMode === "signin"
                    ? "Sign In"
                    : "Create Account"}
              </button>

              <button
                type="button"
                onClick={() => {
                  if (formMode === "signin") {
                    void handleCreateAccountTap();
                  } else {
                    setMode("signin");
                    setError(null);
                    setConfirmPassword("");
                    setShowPassword(false);
                    setShowConfirm(false);
                  }
                }}
                style={{
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: "var(--text-body-sm)",
                  color: "var(--foreground)",
                  opacity: 0.35,
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                }}
              >
                {formMode === "signin"
                  ? "Don't have an account? Create one"
                  : "Already have an account? Sign in"}
              </button>
            </div>
          </>
        )}
      </div>
      {showModal && (
        <DownloadModalLayer
          mode={mode}
          stage={downloadStage}
          progress={downloadProgress}
          error={downloadError}
          startedAt={downloadStartedAt}
          onDownload={() => void runDownload()}
          onRequestClose={() => setMode("skip-confirm")}
          onSkipAnyway={() => {
            setMode("signup-form");
            setDownloadStage("idle");
          }}
          onBackToDownload={() => setMode("download-modal")}
          onContinueToSignup={() => {
            setMode("signup-form");
            setDownloadStage("idle");
          }}
        />
      )}
    </div>
  );
}

function DownloadProgress({
  progress,
  error,
  startedAt,
  onRetry,
}: {
  progress: BackupProgress | null;
  error: string | null;
  startedAt: number | null;
  onRetry: () => void;
}) {
  const pct = Math.max(
    2,
    Math.min(
      100,
      progress?.pct ??
        (progress && progress.total > 0
          ? (progress.current / progress.total) * 100
          : 5),
    ),
  );
  const elapsed = startedAt ? Date.now() - startedAt : 0;
  // Crude ETA: extrapolate from elapsed/pct.
  const eta =
    pct > 5 && elapsed > 0
      ? Math.max(0, (elapsed / pct) * (100 - pct))
      : null;

  return (
    <div className="flex flex-col items-center gap-4 py-6 text-center">
      {error ? (
        <>
          <p
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-body-sm)",
              color: "#f87171",
            }}
          >
            Couldn't finish the backup: {error}
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="px-4 py-2 font-display text-xs uppercase tracking-[0.25em] text-gold focus:outline-none"
            style={{
              background: "none",
              border: "1px solid var(--border-default)",
              borderRadius: 10,
            }}
          >
            Try again
          </button>
        </>
      ) : (
        <>
          <div
            className="h-1.5 w-full overflow-hidden rounded-full"
            style={{
              background:
                "color-mix(in oklab, var(--gold) 12%, transparent)",
            }}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct)}
          >
            <div
              className="h-full transition-[width] duration-200 ease-out"
              style={{
                width: `${pct}%`,
                background: "var(--gold)",
                opacity: 0.85,
              }}
            />
          </div>
          <p
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-body-sm)",
              color: "var(--gold)",
              opacity: 0.8,
            }}
          >
            {progress?.phase ?? "Preparing"} · {Math.round(pct)}%
          </p>
          <p
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "var(--text-caption)",
              color: "var(--foreground-muted)",
              opacity: 0.7,
            }}
          >
            {fmtElapsed(elapsed)} elapsed
            {eta !== null ? ` · ~${fmtElapsed(eta)} left` : ""}
          </p>
        </>
      )}
    </div>
  );
}

/**
 * DS — Dedicated download modal layer (renders OVER the auth panel).
 * Owns both the download modal and the skip-confirm interrupt.
 */
function DownloadModalLayer({
  mode,
  stage,
  progress,
  error,
  startedAt,
  onDownload,
  onRequestClose,
  onSkipAnyway,
  onBackToDownload,
  onContinueToSignup,
}: {
  mode: AuthMode;
  stage: DownloadStage;
  progress: BackupProgress | null;
  error: string | null;
  startedAt: number | null;
  onDownload: () => void;
  onRequestClose: () => void;
  onSkipAnyway: () => void;
  onBackToDownload: () => void;
  onContinueToSignup: () => void;
}) {
  const isSkip = mode === "skip-confirm";
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-5"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(2px)" }}
    >
      <div
        className="w-full max-w-md rounded-2xl flex flex-col gap-4 relative"
        style={{
          background: "var(--surface-elevated)",
          color: "var(--color-foreground)",
          border: "1px solid var(--border-default)",
          padding: 24,
          boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
        }}
      >
        {/* Close X — only on the download modal, never on skip-confirm. */}
        {!isSkip && (
          <button
            type="button"
            onClick={() => {
              if (stage === "done") onContinueToSignup();
              else onRequestClose();
            }}
            className="absolute right-3 top-3 flex items-center justify-center w-7 h-7 rounded-full hover:bg-foreground/10 transition-colors focus:outline-none"
            style={{ color: "var(--foreground-muted)", opacity: 0.6 }}
            aria-label="Close"
          >
            <X size={18} strokeWidth={1.5} />
          </button>
        )}

        {isSkip ? (
          <SkipConfirmContents
            onDownload={onBackToDownload}
            onSkip={onSkipAnyway}
          />
        ) : stage === "downloading" || stage === "error" ? (
          <>
            <ModalHeading>
              {stage === "error" ? "Backup failed" : "Backing up your data"}
            </ModalHeading>
            <DownloadProgress
              progress={progress}
              error={error}
              startedAt={startedAt}
              onRetry={onDownload}
            />
          </>
        ) : stage === "done" ? (
          <>
            <ModalHeading>Your backup is downloaded.</ModalHeading>
            <ModalBody>
              Keep this file safe. If anything goes wrong, you can restore
              from it.
            </ModalBody>
            <PrimaryAccentButton onClick={onContinueToSignup}>
              Continue to signup
            </PrimaryAccentButton>
          </>
        ) : (
          <>
            <ModalHeading>Download your data first</ModalHeading>
            <ModalBody>
              Account creation can sometimes lose data due to session
              changes. Download a backup of your readings, journal, and
              decks now.
            </ModalBody>
            <PrimaryAccentButton onClick={onDownload}>
              Download my data
            </PrimaryAccentButton>
            <button
              type="button"
              onClick={onRequestClose}
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: "var(--text-body-sm)",
                color: "var(--foreground-muted)",
                opacity: 0.5,
                background: "none",
                border: "none",
                padding: "4px 0 0",
                cursor: "pointer",
                alignSelf: "center",
              }}
            >
              Skip — I understand the risk
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function SkipConfirmContents({
  onDownload,
  onSkip,
}: {
  onDownload: () => void;
  onSkip: () => void;
}) {
  return (
    <>
      <ModalHeading accent>Are you sure?</ModalHeading>
      <ModalBody>
        If something goes wrong during account creation, your readings,
        journal entries, custom decks, and saved data could be permanently
        lost. We strongly recommend downloading a backup first.
      </ModalBody>
      <div className="flex flex-col gap-2">
        <PrimaryAccentButton onClick={onDownload}>
          Download my data
        </PrimaryAccentButton>
        <button
          type="button"
          onClick={onSkip}
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "var(--text-body-sm)",
            color: "var(--foreground-muted)",
            opacity: 0.7,
            background: "none",
            border: "1px solid var(--border-default)",
            borderRadius: 10,
            padding: "10px 16px",
            cursor: "pointer",
          }}
        >
          Skip anyway
        </button>
      </div>
    </>
  );
}

function ModalHeading({
  children,
  accent,
}: {
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <h2
      style={{
        fontFamily: "var(--font-serif)",
        fontSize: "var(--text-heading-md, 22px)",
        fontWeight: 500,
        color: accent ? "var(--accent, var(--gold))" : "var(--color-foreground)",
        textAlign: "center",
        margin: 0,
        padding: "0 16px",
      }}
    >
      {children}
    </h2>
  );
}

function ModalBody({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontFamily: "var(--font-serif)",
        fontSize: "var(--text-body)",
        color: "var(--foreground-muted, var(--color-foreground))",
        opacity: 0.85,
        lineHeight: 1.55,
        textAlign: "center",
        margin: 0,
        padding: "0 8px",
      }}
    >
      {children}
    </p>
  );
}

function PrimaryAccentButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: "var(--accent, var(--gold))",
        color: "var(--accent-foreground, var(--gold-foreground, #000))",
        border: "none",
        borderRadius: 10,
        padding: "12px 20px",
        fontFamily: "var(--font-serif)",
        fontSize: "var(--text-body)",
        fontWeight: 500,
        cursor: "pointer",
        letterSpacing: "0.02em",
      }}
    >
      {children}
    </button>
  );
}