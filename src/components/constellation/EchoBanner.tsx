/**
 * Phase 19 — shared "An Echo" breathing banner.
 * Mirrors the banner block previously inlined in QuickLog.
 */
import type { EchoState } from "@/lib/use-echo";

export function EchoBanner({ echo }: { echo: EchoState }) {
  if (!echo.active) return null;
  return (
    <div style={{ position: "relative", margin: "8px 24px 0" }}>
      <div
        aria-hidden
        className="tarotseed-constellation-breathe"
        style={{
          position: "absolute",
          top: -12,
          left: -16,
          right: -16,
          bottom: -12,
          background:
            "radial-gradient(ellipse at center, color-mix(in oklab, var(--accent, var(--gold)) 48%, transparent) 0%, color-mix(in oklab, var(--accent, var(--gold)) 28%, transparent) 50%, transparent 85%)",
          pointerEvents: "none",
          zIndex: 0,
          borderRadius: 60,
        }}
      />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          height: 44,
          borderRadius: 22,
          border: "1px solid var(--accent, var(--gold))",
          background: "var(--surface-card)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          style={{
            fontSize: 14,
            color: "var(--accent, var(--gold))",
            fontStyle: "italic",
            fontFamily: "var(--font-display)",
            letterSpacing: "0.05em",
            textAlign: "center",
            padding: "0 12px",
          }}
        >
          An Echo — {echo.participatingCardIds.length} of these cards have met before
        </span>
      </div>
    </div>
  );
}