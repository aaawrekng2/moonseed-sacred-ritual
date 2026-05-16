/**
 * EN-5 — Locked premium teaser at the bottom of the Recap tab.
 * Tap dispatches `tarotseed:open-premium` with featureName "Year of Lunations".
 */
import { Link } from "@tanstack/react-router";

export function YearOfLunationsLocked() {
  return (
    <Link
        to="/insights/year-of-lunations"
        className="block w-full overflow-hidden p-6 text-left"
        style={{
          background: "var(--surface-card)",
          borderRadius: 18,
          backgroundImage:
            "linear-gradient(135deg, color-mix(in oklab, var(--gold) 14%, transparent) 0%, transparent 60%)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-heading-sm, 1.4rem)",
            color: "var(--gold)",
            lineHeight: 1.2,
          }}
        >
          Year of Lunations
        </div>
        <div
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body-sm)",
            opacity: 0.75,
            marginTop: 6,
          }}
        >
          Open your 12-slide year story →
        </div>
    </Link>
  );
}