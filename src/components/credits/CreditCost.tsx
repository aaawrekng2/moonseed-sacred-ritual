/**
 * Q101 #8d — CreditCost.
 *
 * Tiny inline pill showing an action's credit cost: " · N ✦".
 * Renders nothing when cost is 0 or undefined.
 */
import { Sparkles } from "lucide-react";

export function CreditCost({ cost }: { cost?: number }) {
  if (!cost || cost <= 0) return null;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        fontSize: "var(--text-caption)",
        opacity: 0.65,
        color: "var(--accent, var(--gold))",
        fontStyle: "italic",
      }}
    >
      · {cost}
      <Sparkles size={11} strokeWidth={1.5} />
    </span>
  );
}