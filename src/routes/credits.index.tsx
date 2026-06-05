/**
 * Q103 — /credits — buy credit packs.
 *
 * Three tiles for Spark, Flame, Bonfire. Tapping a tile opens a
 * Stripe Checkout Session in the same tab via window.location.href.
 */
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState, type CSSProperties } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useAIEnabled } from "@/lib/use-ai-enabled";

export const Route = createFileRoute("/credits/")({
  head: () => ({ meta: [{ title: "Credits — Tarot Seed" }] }),
  component: CreditsPage,
});

type Pack = {
  sku: string;
  name: string;
  credits: number;
  price: string;
  perCredit: string;
  tagline: string;
};

const PACKS: Pack[] = [
  { sku: "spark_100", name: "Spark", credits: 100, price: "$4.99", perCredit: "5.0¢/credit", tagline: "A handful of sparks to begin." },
  { sku: "flame_500", name: "Flame", credits: 500, price: "$19.99", perCredit: "4.0¢/credit", tagline: "A steady flame for the seeker." },
  { sku: "bonfire_1500", name: "Bonfire", credits: 1500, price: "$49.99", perCredit: "3.3¢/credit", tagline: "A bonfire — the deepest journey." },
];

function CreditsPage() {
  // EK37 — Gate the entire /credits route on AI features. When AI is
  // off for this user, redirect to home — the seeker has no concept
  // of credits in their experience of Tarot Seed.
  const aiEnabled = useAIEnabled();
  const { user } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (aiEnabled === false) {
    return <Navigate to="/" />;
  }
  if (aiEnabled === null) {
    // Loading — render nothing briefly to avoid flashing the pricing
    // tiles before the gate resolves.
    return null;
  }

  async function buy(sku: string) {
    if (!user) {
      setError("Please sign in first.");
      return;
    }
    setBusy(sku);
    setError(null);
    try {
      const { data, error: invErr } = await supabase.functions.invoke<{ url: string }>(
        "create-checkout-session",
        { body: { pack_sku: sku } },
      );
      if (invErr || !data?.url) {
        setError("Could not start checkout. Please try again.");
        setBusy(null);
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("Could not start checkout. Please try again.");
      setBusy(null);
    }
  }

  return (
    <div style={pageStyle}>
      <h1 style={titleStyle}>Credits</h1>
      <p style={subtitleStyle}>
        Credits power Tarot Seed's AI features — deep readings, lenses, story
        weaving, memory recalls. Buy a pack, never expires.
      </p>

      {error && <div style={errorStyle}>{error}</div>}

      <div style={gridStyle}>
        {PACKS.map((p) => {
          const loading = busy === p.sku;
          return (
            <button
              key={p.sku}
              type="button"
              onClick={() => buy(p.sku)}
              disabled={busy !== null}
              style={tileStyle(loading)}
            >
              <div style={tileHeaderStyle}>
                <Sparkles size={20} strokeWidth={1.5} style={{ color: "var(--accent, var(--gold))" }} />
                <span style={tileNameStyle}>{p.name}</span>
              </div>
              <div style={tileCreditsStyle}>
                {p.credits}
                <span style={tileCreditsLabelStyle}>credits</span>
              </div>
              <div style={tilePriceStyle}>{p.price}</div>
              <div style={tilePerCreditStyle}>{p.perCredit}</div>
              <div style={tileTaglineStyle}>{p.tagline}</div>
              <div style={tileCtaStyle}>
                {loading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Redirecting…
                  </>
                ) : (
                  <>Buy {p.name}</>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <p style={footnoteStyle}>
        Credits never expire. Payment is securely processed by Stripe. Refunds
        available within 7 days of purchase — contact support.
      </p>
    </div>
  );
}

const pageStyle: CSSProperties = {
  maxWidth: 1100,
  margin: "0 auto",
  padding: "32px 20px 80px",
};
const titleStyle: CSSProperties = {
  fontFamily: "var(--font-serif)",
  fontStyle: "italic",
  fontSize: "var(--text-display, 36px)",
  margin: 0,
  marginBottom: 8,
  color: "var(--gold)",
};
const subtitleStyle: CSSProperties = {
  fontFamily: "var(--font-serif)",
  fontStyle: "italic",
  fontSize: "var(--text-body)",
  opacity: 0.75,
  lineHeight: 1.5,
  maxWidth: 640,
  marginBottom: 32,
};
const gridStyle: CSSProperties = {
  display: "grid",
  gap: 16,
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
};
const tileStyle = (loading: boolean): CSSProperties => ({
  display: "flex",
  flexDirection: "column",
  gap: 6,
  alignItems: "flex-start",
  padding: 22,
  borderRadius: 16,
  background: "var(--surface-card)",
  border: "1px solid var(--border-subtle, color-mix(in oklch, var(--gold) 18%, transparent))",
  textAlign: "left",
  cursor: loading ? "wait" : "pointer",
  opacity: loading ? 0.7 : 1,
  transition: "transform 150ms ease-out, opacity 150ms ease-out",
});
const tileHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 6,
};
const tileNameStyle: CSSProperties = {
  fontFamily: "var(--font-serif)",
  fontStyle: "italic",
  fontSize: "var(--text-heading-md, 22px)",
  color: "var(--gold)",
};
const tileCreditsStyle: CSSProperties = {
  fontFamily: "var(--font-serif)",
  fontStyle: "italic",
  fontSize: "var(--text-display, 32px)",
  lineHeight: 1,
  color: "var(--color-foreground)",
};
const tileCreditsLabelStyle: CSSProperties = {
  fontSize: "var(--text-body-sm)",
  opacity: 0.55,
  marginLeft: 4,
};
const tilePriceStyle: CSSProperties = {
  marginTop: 8,
  fontFamily: "var(--font-serif)",
  fontSize: "var(--text-heading-sm)",
  fontWeight: 500,
};
const tilePerCreditStyle: CSSProperties = {
  fontFamily: "var(--font-serif)",
  fontStyle: "italic",
  fontSize: "var(--text-caption)",
  opacity: 0.55,
};
const tileTaglineStyle: CSSProperties = {
  marginTop: 10,
  fontFamily: "var(--font-serif)",
  fontStyle: "italic",
  fontSize: "var(--text-body-sm)",
  opacity: 0.75,
  lineHeight: 1.4,
};
const tileCtaStyle: CSSProperties = {
  marginTop: 12,
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontFamily: "var(--font-serif)",
  fontStyle: "italic",
  fontSize: "var(--text-body-sm)",
  color: "var(--accent, var(--gold))",
};
const footnoteStyle: CSSProperties = {
  marginTop: 32,
  fontFamily: "var(--font-serif)",
  fontStyle: "italic",
  fontSize: "var(--text-caption)",
  opacity: 0.5,
  textAlign: "center",
};
const errorStyle: CSSProperties = {
  marginBottom: 16,
  padding: 12,
  borderRadius: 10,
  background: "color-mix(in oklch, red 15%, var(--surface-card))",
  fontFamily: "var(--font-serif)",
  fontStyle: "italic",
  fontSize: "var(--text-body-sm)",
};