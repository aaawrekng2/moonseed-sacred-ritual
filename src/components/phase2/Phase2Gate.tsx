/**
 * Phase2Gate — wrap any Phase 2 feature. Renders its children only when the
 * current seeker has phase2_enabled === true; otherwise renders nothing
 * (hidden entirely, not disabled). Loading state (null) also renders nothing
 * so there is no flash of the feature before the flag resolves.
 */
import type { ReactNode } from "react";
import { usePhase2Enabled } from "@/lib/use-phase2";

export function Phase2Gate({ children }: { children: ReactNode }) {
  const enabled = usePhase2Enabled();
  if (enabled !== true) return null;
  return <>{children}</>;
}
