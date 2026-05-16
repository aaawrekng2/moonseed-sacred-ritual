import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getMyUsage } from "@/lib/admin-usage.functions";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import { formatDateLong } from "@/lib/dates";
import { LoadingText } from "@/components/ui/loading-text";

export const Route = createFileRoute("/settings/usage")({
  component: UsagePage,
});

type Usage = Awaited<ReturnType<typeof getMyUsage>>;

function UsagePage() {
  const fn = useServerFn(getMyUsage);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        const res = await fn({ headers });
        if (!cancelled) setUsage(res);
      } catch (e) {
        console.error("[settings/usage] getMyUsage failed", e);
        if (!cancelled) setError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [fn]);

  if (error) {
    return (
      <p style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", opacity: 0.6, padding: "var(--space-4, 16px)" }}>
        Usage data unavailable.
      </p>
    );
  }
  if (!usage) return <LoadingText>Loading usage…</LoadingText>;

  const used = usage.ai.used;
  const total = Math.max(1, usage.ai.quota);
  const pct = Math.min(1, Math.max(0, used / total));
  const planLabel = "AI CREDITS";

  return (
    <section
      style={{
        background: "var(--surface-card)",
        padding: "var(--space-4, 16px)",
        borderRadius: "var(--radius-md, 10px)",
        display: "grid",
        gap: "var(--space-3, 12px)",
      }}
    >
      <p
        style={{
          fontSize: "var(--text-caption)",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--color-foreground-muted, var(--color-foreground))",
          opacity: 0.6,
          margin: 0,
        }}
      >
        {planLabel}
      </p>
      <p style={{ fontSize: "var(--text-body)", margin: 0 }}>
        {used} / {usage.ai.quota} credits
      </p>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={usage.ai.quota}
        aria-valuenow={used}
        style={{
          width: "100%",
          height: 4,
          background: "var(--border-subtle)",
          borderRadius: "var(--radius-full, 999px)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct * 100}%`,
            height: "100%",
            background: "var(--accent, var(--gold))",
            borderRadius: "var(--radius-full, 999px)",
          }}
        />
      </div>
      <p
        style={{
          fontSize: "var(--text-caption)",
          color: "var(--color-foreground-muted, var(--color-foreground))",
          opacity: 0.6,
          margin: 0,
        }}
      >
        {usage.ai.remaining} remaining
      </p>
      {usage.ai.nextResetAt && (
        <p
          style={{
            fontSize: "var(--text-caption)",
            color: "var(--color-foreground-muted, var(--color-foreground))",
            opacity: 0.6,
            margin: 0,
          }}
        >
          Resets {formatDateLong(usage.ai.nextResetAt)}
        </p>
      )}
    </section>
  );
}
