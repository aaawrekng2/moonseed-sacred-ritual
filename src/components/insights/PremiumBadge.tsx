/**
 * EO-11 — Subtle "Premium" badge shown on the Insights page header for
 * users with active premium. Tap navigates to /settings/moon so the
 * user can verify status. Returns null for non-premium users so callers
 * don't need to gate.
 */
import { Crown } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { usePremium } from "@/lib/premium";
import { useAuth } from "@/lib/auth";

export function PremiumBadge() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isPremium } = usePremium(user?.id);
  if (!isPremium) return null;
  return (
    <button
      type="button"
      onClick={() => void navigate({ to: "/settings/moon" })}
      className="inline-flex items-center gap-1.5"
      style={{
        color: "var(--gold)",
        fontFamily: "var(--font-serif)",
        fontStyle: "italic",
        fontSize: "var(--text-caption, 0.75rem)",
        opacity: 0.85,
      }}
    >
      <Crown size={12} aria-hidden />
      Premium
    </button>
  );
}