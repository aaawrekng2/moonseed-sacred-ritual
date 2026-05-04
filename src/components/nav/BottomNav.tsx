import { Link, useLocation } from "@tanstack/react-router";
import { Moon, BookOpen, SlidersHorizontal, Network, BarChart3 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { usePatternsCount } from "@/lib/patterns";
import { useEffect, useState } from "react";

type Tab = {
  to: "/" | "/journal" | "/settings" | "/threads" | "/insights";
  label: string;
  Icon: LucideIcon;
  primary?: boolean;
};

// EJ-2 — Order: Journal (left), Insights, Home (center, primary), Settings (right).
// Stories appears as a 5th tab when the seeker has any patterns.
const BASE_TABS: readonly Tab[] = [
  { to: "/journal", label: "Journal", Icon: BookOpen },
  { to: "/insights", label: "Insights", Icon: BarChart3 },
  { to: "/", label: "Home", Icon: Moon, primary: true },
  { to: "/settings", label: "Settings", Icon: SlidersHorizontal },
] as const;

const THREADS_TAB: Tab = { to: "/threads", label: "Stories", Icon: Network };

export function BottomNav() {
  const location = useLocation();
  const { user } = useAuth();
  const { count } = usePatternsCount(user?.id);
  // Once a pattern exists we mount the tab and fade it in (200ms).
  // We never *unmount* it after first appearance within this session
  // even if the count drops back to 0 mid-flight — patterns becoming
  // ephemeral would be jarring.
  const [showThreads, setShowThreads] = useState(false);
  const [threadsOpacity, setThreadsOpacity] = useState(0);
  useEffect(() => {
    if (count > 0 && !showThreads) {
      setShowThreads(true);
      // next paint -> fade in
      requestAnimationFrame(() => setThreadsOpacity(1));
    } else if (count > 0) {
      setThreadsOpacity(1);
    }
  }, [count, showThreads]);

  // With Stories: Journal, Stories, Insights, Home, Settings.
  const tabs: Tab[] = showThreads
    ? [BASE_TABS[0], THREADS_TAB, BASE_TABS[1], BASE_TABS[2], BASE_TABS[3]]
    : [...BASE_TABS];

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur-xl"
      style={{
        background: "color-mix(in oklch, var(--surface-elevated) 90%, transparent)",
        borderTopColor: "var(--border-default)",
        minHeight: "calc(64px + env(safe-area-inset-bottom, 0px))",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <ul
        className="mx-auto flex items-center justify-center px-4"
        style={{ height: 72, maxWidth: showThreads ? 440 : 360, gap: showThreads ? 28 : 36, paddingTop: 8 }}
      >
        {tabs.map(({ to, label, Icon, primary }) => {
          // Settings nav nests sub-routes (/settings/profile, /settings/themes,
          // …) so an exact-match active check left the icon perpetually
          // un-highlighted. Use a prefix match for /settings, exact match for
          // the others (otherwise "/" would stay active everywhere).
          const path = location.pathname;
          const active =
            to === "/settings"
              ? path === "/settings" || path.startsWith("/settings/")
              : to === "/threads"
              ? path === "/threads" || path.startsWith("/threads/")
              : to === "/insights"
              ? path === "/insights" || path.startsWith("/insights/")
              : path === to;
          const iconSize = primary ? 36 : 20;
          // Active = signature gold. Inactive (including Home) = neutral
          // foreground/white tint. Primary keeps a slight size advantage.
          const tabAlpha = active
            ? "var(--ro-plus-10)"
            : "var(--ro-plus-0)";
          const isThreadsTab = to === "/threads";
          return (
            <li
              key={to}
              style={
                isThreadsTab
                  ? { opacity: threadsOpacity, transition: "opacity 200ms ease-out" }
                  : undefined
              }
            >
              <Link
                to={to}
                aria-label={`${label}${active ? " (current page)" : ""}`}
                style={{
                  opacity: isThreadsTab ? undefined : tabAlpha,
                  color: active ? "var(--gold)" : undefined,
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
                {primary ? (
                  <div className="relative" style={{ transform: "translateY(-6px)" }}>
                    <div
                      aria-hidden
                      style={{
                        position: "absolute",
                        inset: -12,
                        borderRadius: "50%",
                        background:
                          "radial-gradient(circle, color-mix(in oklab, var(--gold) 25%, transparent) 0%, transparent 70%)",
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