import { Link, useLocation } from "@tanstack/react-router";
import { Moon, Layers, SlidersHorizontal } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useRestingOpacity } from "@/lib/use-resting-opacity";
import { cn } from "@/lib/utils";

type Tab = {
  to: "/" | "/cards" | "/settings";
  label: string;
  Icon: LucideIcon;
  primary?: boolean;
};

// Order: Cards (left), Home (center, primary), Settings (right).
// Home is the moon-phase landing — the primary destination of the app.
const TABS: readonly Tab[] = [
  { to: "/cards", label: "Cards", Icon: Layers },
  { to: "/", label: "Home", Icon: Moon, primary: true },
  { to: "/settings", label: "Settings", Icon: SlidersHorizontal },
] as const;

export function BottomNav() {
  const { opacity } = useRestingOpacity();
  const restingAlpha = opacity / 100;
  const location = useLocation();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[color:var(--border)] backdrop-blur-xl"
      style={{
        background: "linear-gradient(to top, rgba(10,8,22,0.85), rgba(10,8,22,0.55))",
      }}
    >
      <ul
        className="mx-auto flex items-end justify-center px-4 pb-[calc(env(safe-area-inset-bottom)+8px)]"
        style={{ height: 64, maxWidth: 320, gap: 48 }}
      >
        {TABS.map(({ to, label, Icon, primary }) => {
          const active = location.pathname === to;
          const iconSize = primary ? 32 : 20;
          // Home (the primary moon tab) gets a gentle opacity boost so it
          // reads as the centerpiece even when the rest of the chrome is
          // resting at low opacity. When active, Home is fully solid.
          const tabAlpha = active
            ? 1
            : primary
              ? Math.min(1, restingAlpha + 0.2)
              : restingAlpha;
          return (
            <li key={to}>
              <Link
                to={to}
                aria-label={`${label}${active ? " (current page)" : ""}`}
                style={{
                  opacity: tabAlpha,
                  transform: primary ? undefined : "translateY(4px)",
                }}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg px-2 py-1 transition-all hover:opacity-100",
                  "outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-gold/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  active
                    ? "text-gold"
                    : primary
                      ? "text-gold/80"
                      : "text-muted-foreground",
                )}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={iconSize} strokeWidth={primary ? 1.5 : 1.6} aria-hidden="true" />
                <span
                  className={cn(
                    "font-display tracking-wide",
                    primary ? "text-[13px] font-medium" : "text-[11px]",
                  )}
                >
                  {label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}