/**
 * Q103 — Stripe success return page.
 *
 * The webhook is the authoritative source for crediting — we don't
 * trust the URL. We poll getCreditsSnapshot for up to ~10 seconds
 * to surface the new balance once the webhook lands.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type CSSProperties } from "react";
import { Sparkles, CheckCircle2 } from "lucide-react";
import { useCredits } from "@/lib/use-credits";

export const Route = createFileRoute("/credits/success")({
  head: () => ({ meta: [{ title: "Thank you — Tarot Seed" }] }),
  validateSearch: (s: Record<string, unknown>) => ({
    session_id: typeof s.session_id === "string" ? s.session_id : undefined,
  }),
  component: SuccessPage,
});

function SuccessPage() {
  const { balance, refresh, loading } = useCredits();
  const [initialBalance] = useState<number>(balance);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    if (tries >= 7) return;
    if (!loading && balance > initialBalance) return;
    const t = setTimeout(() => {
      void refresh();
      setTries((n) => n + 1);
    }, 1500);
    return () => clearTimeout(t);
  }, [tries, balance, initialBalance, loading, refresh]);

  const credited = !loading && balance > initialBalance;

  return (
    <div style={pageStyle}>
      <CheckCircle2 size={48} strokeWidth={1.2} style={{ color: "var(--accent, var(--gold))" }} />
      <h1 style={titleStyle}>Thank you</h1>
      <p style={subtitleStyle}>
        {credited
          ? "Your credits have arrived."
          : tries < 7
            ? "Processing your purchase…"
            : "Your purchase is recorded — credits should appear in a moment."}
      </p>
      <div style={balanceRowStyle}>
        <span style={balanceLabelStyle}>Current balance</span>
        <div style={balanceValStyle}>
          {balance}{" "}
          <Sparkles size={22} strokeWidth={1.5} style={{ color: "var(--accent, var(--gold))" }} />
        </div>
      </div>
      <div style={ctaRowStyle}>
        <Link to="/" style={primaryLinkStyle}>Continue</Link>
        <Link to="/credits" style={secondaryLinkStyle}>Buy another pack</Link>
      </div>
    </div>
  );
}

const pageStyle: CSSProperties = {
  maxWidth: 480,
  margin: "0 auto",
  padding: "64px 20px 80px",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  textAlign: "center",
  gap: 16,
};
const titleStyle: CSSProperties = {
  fontFamily: "var(--font-serif)",
  fontStyle: "italic",
  fontSize: "var(--text-display, 36px)",
  margin: 0,
  color: "var(--gold)",
};
const subtitleStyle: CSSProperties = {
  fontFamily: "var(--font-serif)",
  fontStyle: "italic",
  fontSize: "var(--text-body)",
  opacity: 0.75,
  margin: 0,
};
const balanceRowStyle: CSSProperties = {
  marginTop: 16,
  padding: "18px 24px",
  borderRadius: 14,
  background: "var(--surface-card)",
  border: "1px solid var(--border-subtle, color-mix(in oklch, var(--gold) 18%, transparent))",
  minWidth: 240,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 6,
};
const balanceLabelStyle: CSSProperties = {
  fontFamily: "var(--font-serif)",
  fontStyle: "italic",
  fontSize: "var(--text-caption)",
  opacity: 0.55,
};
const balanceValStyle: CSSProperties = {
  fontFamily: "var(--font-serif)",
  fontStyle: "italic",
  fontSize: "var(--text-display, 36px)",
  lineHeight: 1,
  display: "flex",
  alignItems: "center",
  gap: 8,
};
const ctaRowStyle: CSSProperties = {
  marginTop: 16,
  display: "flex",
  gap: 24,
};
const primaryLinkStyle: CSSProperties = {
  fontFamily: "var(--font-serif)",
  fontStyle: "italic",
  fontSize: "var(--text-body)",
  color: "var(--accent, var(--gold))",
  textDecoration: "underline",
};
const secondaryLinkStyle: CSSProperties = {
  fontFamily: "var(--font-serif)",
  fontStyle: "italic",
  fontSize: "var(--text-body)",
  opacity: 0.65,
};