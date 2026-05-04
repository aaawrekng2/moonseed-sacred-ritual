/**
 * EN-5 — Locked premium teaser at the bottom of the Recap tab.
 * Tap dispatches `moonseed:open-premium` with featureName "Year of Lunations".
 */
import { Lock } from "lucide-react";
import { usePremium } from "@/lib/premium";
import { useAuth } from "@/lib/auth";
import { Link } from "@tanstack/react-router";

export function YearOfLunationsLocked() {
  const { user } = useAuth();
  const { isPremium } = usePremium(user?.id);
  if (isPremium) {
    /* EQ-9 — Premium tap opens the 12-slide year story. */
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
  const open = () =>
    window.dispatchEvent(
      new CustomEvent("moonseed:open-premium", {
        detail: { feature: "Year of Lunations", featureName: "Year of Lunations" },
      }),
    );
  return (
    <button
      type="button"
      onClick={open}
      className="relative w-full overflow-hidden p-6 text-left"
      style={{
        background: "var(--surface-card)",
        borderRadius: 18,
        backgroundImage:
          "linear-gradient(135deg, color-mix(in oklab, var(--gold) 14%, transparent) 0%, transparent 60%)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
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
            Your full year, told through the moon's cycles.
          </div>
        </div>
        <Lock size={18} style={{ color: "var(--gold)", opacity: 0.85, flexShrink: 0 }} />
      </div>
      <div
        style={{
          marginTop: 14,
          fontStyle: "italic",
          fontSize: "var(--text-caption, 0.75rem)",
          color: "var(--gold)",
          opacity: 0.85,
        }}
      >
        Premium — tap to unlock
      </div>
    </button>
  );
}