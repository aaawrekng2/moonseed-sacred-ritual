import { Link, useLocation } from "@tanstack/react-router";
import { Moon, BookOpen, SlidersHorizontal } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Tab = {
  to: "/" | "/journal" | "/settings";
  label: string;
  Icon: LucideIcon;
  primary?: boolean;
};

// Order: Journal (left), Home (center, primary), Settings (right).
// Home is the moon-phase landing — the primary destination of the app.
const TABS: readonly Tab[] = [
  { to: "/journal", label: "Journal", Icon: BookOpen },
  { to: "/", label: "Home", Icon: Moon, primary: true },
  { to: "/settings", label: "Settings", Icon: SlidersHorizontal },
] as const;

export function BottomNav() {
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
          // Settings nav nests sub-routes (/settings/profile, /settings/themes,
          // …) so an exact-match active check left the icon perpetually
          // un-highlighted. Use a prefix match for /settings, exact match for
          // the others (otherwise "/" would stay active everywhere).
          const path = location.pathname;
          const active =
            to === "/settings"
              ? path === "/settings" || path.startsWith("/settings/")
              : path === to;
          const iconSize = primary ? 32 : 20;
          // Active = signature gold. Inactive (including Home) = neutral
          // foreground/white tint. Primary keeps a slight size advantage.
          const tabAlpha = active
            ? "var(--ro-plus-10)"
            : "var(--ro-plus-0)";
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
                    : "text-foreground",
                )}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={iconSize} strokeWidth={primary ? 1.5 : 1.6} aria-hidden="true" />
                <span
                  className={cn(
                    "clarity-label font-display tracking-wide",
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