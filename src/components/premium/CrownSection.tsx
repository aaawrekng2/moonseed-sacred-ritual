import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Section card with a faint gold accent. The source bundle named this
 * "CrownSection" because it prefixed the heading with a 👑 — the Moonseed
 * spec removes all crown icons, so this is now a plain titled card.
 * Kept under its source-bundle name for drop-in compatibility.
 */
export function CrownSection({
  title,
  description,
  children,
  className,
  headingId,
}: {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
  headingId?: string;
}) {
  return (
    <section
      className={cn(
        "space-y-4 rounded-xl border border-gold/40 bg-gold/[0.05] p-4 shadow-[0_0_24px_-12px_var(--gold)]",
        className,
      )}
    >
      <header className="space-y-1">
        <h3
          id={headingId}
          className="text-sm font-normal text-foreground"
        >
          {title}
        </h3>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </header>
      {children}
    </section>
  );
}