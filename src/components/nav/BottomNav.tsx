import { Link, useLocation } from "@tanstack/react-router";
import { Moon, BookOpen, SlidersHorizontal, Hash, BarChart3 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Tab = {
  to: "/" | "/journal" | "/settings" | "/numerology" | "/insights";
  label: string;
  Icon: LucideIcon;
  primary?: boolean;
};

// Q52a — Symmetric 5-tab layout: Numerology promoted to its own page,
// Stories moved into Insights as a sub-tab.
const TABS: readonly Tab[] = [
  { to: "/journal", label: "Journal", Icon: BookOpen },
  { to: "/numerology", label: "Numerology", Icon: Hash },
  { to: "/", label: "Home", Icon: Moon, primary: true },
  { to: "/insights", label: "Insights", Icon: BarChart3 },
  { to: "/settings", label: "Settings", Icon: SlidersHorizontal },
] as const;

export function BottomNav() {
  const location = useLocation();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 border-t backdrop-blur-xl"
      style={{
        zIndex: "var(--z-bottom-nav)" as unknown as number,
        background: "color-mix(in oklch, var(--surface-elevated) 90%, transparent)",
        borderTopColor: "var(--border-default)",
        minHeight: "calc(72px + env(safe-area-inset-bottom, 0px))",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <ul
        className="mx-auto flex items-center justify-center px-4"
        style={{ height: 72, maxWidth: 440, gap: 28, paddingTop: 8 }}
      >
        {TABS.map(({ to, label, Icon, primary }) => {
          const path = location.pathname;
          const hasSubRoutes = to !== "/" && to !== "/journal";
          const active = hasSubRoutes
            ? path === to || path.startsWith(`${to}/`)
            : path === to;
          const iconSize = primary ? 36 : 20;
          const tabAlpha = active ? "var(--ro-plus-10)" : "var(--ro-plus-0)";
          return (
            <li key={to}>
              <Link
                to={to}
                aria-label={`${label}${active ? " (current page)" : ""}`}
                style={{
                  opacity: tabAlpha,
                  color: active ? "var(--gold)" : undefined,
                }}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg px-2 py-1 transition-all hover:opacity-100",
                  "outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-gold/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  active ? "text-gold" : "text-foreground",
                )}
                aria-current={active ? "page" : undefined}
              >
                {primary ? (
                  <div className="relative" style={{ transform: "translateY(-6px)" }}>
                    <div
                      aria-hidden
                      style={{
                        position: "absolute",
                        inset: -12,
                        borderRadius: "50%",
                        background:
                          "radial-gradient(circle, color-mix(in oklab, var(--gold) 12%, transparent) 0%, transparent 70%)",
                        pointerEvents: "none",
                      }}
                    />
                    <Icon size={iconSize} strokeWidth={1.5} aria-hidden="true" />
                  </div>
                ) : (
                  <Icon size={iconSize} strokeWidth={1.6} aria-hidden="true" />
                )}
                <span
                  className={cn(
                    "clarity-label font-display tracking-wide",
                    primary ? "text-[13px] font-semibold" : "text-[11px]",
                    "hidden sm:inline-block",
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
