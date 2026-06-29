/**
 * v2.30 — Route-level AI gate. Renders its children only when the seeker has
 * AI access (useAIEnabled === true). When AI is off it redirects home, so the
 * page is genuinely unreachable rather than merely hidden from the nav. While
 * the AI flag is still loading (null) it renders nothing, avoiding a flash of
 * gated content before the redirect.
 */
import { useEffect } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAIEnabled } from "@/lib/use-ai-enabled";

export function AIRouteGuard({ children }: { children: ReactNode }) {
  const aiEnabled = useAIEnabled();
  const navigate = useNavigate();

  useEffect(() => {
    if (aiEnabled === false) {
      void navigate({ to: "/", replace: true });
    }
  }, [aiEnabled, navigate]);

  if (aiEnabled !== true) return null;
  return <>{children}</>;
}
