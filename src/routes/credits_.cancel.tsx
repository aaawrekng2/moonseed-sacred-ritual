/**
 * Q103 — Stripe cancel return page. User aborted at Stripe checkout.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import type { CSSProperties } from "react";

export const Route = createFileRoute("/credits_/cancel")({
  head: () => ({ meta: [{ title: "Cancelled — Tarot Seed" }] }),
  component: CancelPage,
});

function CancelPage() {
  return (
    <div style={pageStyle}>
      <h1 style={titleStyle}>Cancelled</h1>
      <p style={subtitleStyle}>Your purchase was cancelled. No charge was made.</p>
      <div style={ctaRowStyle}>
        <Link to="/credits" style={primaryLinkStyle}>Try again</Link>
        <Link to="/" style={secondaryLinkStyle}>Back to home</Link>
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