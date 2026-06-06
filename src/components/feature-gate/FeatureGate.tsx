/**
 * EK49 — FeatureGate.
 *
 * A tiny presentational wrapper that hides its children when a
 * feature flag is off. Designed so future asks like "gate X by
 * AI" or "gate Y by premium" become a one-line wrap:
 *
 *   import { FeatureGate } from "@/components/feature-gate/FeatureGate";
 *   import { useAIEnabled } from "@/lib/use-ai-enabled";
 *
 *   const aiEnabled = useAIEnabled();
 *   return (
 *     <FeatureGate enabled={aiEnabled}>
 *       <MoonOracleSelector />
 *     </FeatureGate>
 *   );
 *
 * That's the entire pattern. The wrapper renders children when
 * `enabled` is `true`, and renders nothing (or the optional
 * `fallback`) when `enabled` is `false`.
 *
 * Future gates can mix any number of conditions — combine multiple
 * hooks into a single boolean and pass it as `enabled`:
 *
 *   <FeatureGate enabled={aiEnabled && isPremium}>...</FeatureGate>
 *
 * Bypass mechanism: if a specific element should ALWAYS render
 * regardless of the gate, just don't wrap it. No special prop is
 * needed — the absence of the wrapper IS the bypass.
 *
 * The hook is intentionally NOT baked into this component (so the
 * wrapper stays presentational and can be unit-tested without a
 * Supabase context). Each caller pairs the hook with the wrapper.
 */
import type { ReactNode } from "react";

export type FeatureGateProps = {
  /** When true, render children. When false, render fallback (or
   *  nothing). When undefined or null, treat as false (the safe
   *  default — feature stays hidden until we know for sure). */
  enabled: boolean | null | undefined;
  /** Children to render when enabled is true. */
  children: ReactNode;
  /** Optional content shown when enabled is false. Default: null. */
  fallback?: ReactNode;
};

export function FeatureGate({
  enabled,
  children,
  fallback = null,
}: FeatureGateProps) {
  return <>{enabled === true ? children : fallback}</>;
}
