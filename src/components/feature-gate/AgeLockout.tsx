import { Link } from "@tanstack/react-router";

/**
 * v2.72 — Adults-only lockout. Shown in place of the app on every non-Settings
 * route when the entered Blueprint birth date computes to under 18. Settings
 * stays reachable so the seeker can correct the date, export, or delete data.
 */
export function AgeLockout() {
  return (
    <div
      style={{
        minHeight: "70dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 20px",
      }}
    >
      <div style={{ maxWidth: 460, textAlign: "center" }}>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "var(--text-heading-lg)",
            margin: "0 0 12px",
            lineHeight: 1.15,
          }}
        >
          Tarot Seed is for adults 18+
        </h1>
        <p
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "var(--text-body)",
            lineHeight: 1.6,
            color: "var(--color-foreground)",
            marginBottom: 10,
          }}
        >
          The birthday on your account indicates you&rsquo;re under 18, so access to
          readings, journal, and insights is turned off. Tarot Seed is intended for adults only.
        </p>
        <p
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "var(--text-body-sm)",
            lineHeight: 1.6,
            color: "var(--color-foreground-muted)",
            marginBottom: 24,
          }}
        >
          If your birthday was entered incorrectly, you can fix it in Settings &rarr; Blueprint.
          You can also download or delete your data anytime in Settings &rarr; Data.
        </p>
        <Link
          to="/settings/blueprint"
          style={{
            display: "inline-block",
            fontFamily: "var(--font-serif)",
            fontSize: "var(--text-body)",
            color: "var(--color-foreground)",
            textDecoration: "none",
            padding: "10px 20px",
            borderRadius: 10,
            border: "1px solid color-mix(in oklab, var(--gold) 30%, transparent)",
            background: "color-mix(in oklab, var(--gold) 8%, transparent)",
          }}
        >
          Go to Settings
        </Link>
      </div>
    </div>
  );
}
