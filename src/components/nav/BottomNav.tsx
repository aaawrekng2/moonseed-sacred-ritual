import { Link, useLocation } from "@tanstack/react-router";
import { Moon, BookOpen, SlidersHorizontal, Network } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { usePatternsCount } from "@/lib/patterns";
import { useEffect, useState } from "react";

type Tab = {
  to: "/" | "/journal" | "/settings" | "/threads";
  label: string;
  Icon: LucideIcon;
  primary?: boolean;
};

// Order: Journal (left), Home (center, primary), Settings (right).
// Home is the moon-phase landing — the primary destination of the app.
const BASE_TABS: readonly Tab[] = [
  { to: "/journal", label: "Journal", Icon: BookOpen },
  { to: "/", label: "Home", Icon: Moon, primary: true },
  { to: "/settings", label: "Settings", Icon: SlidersHorizontal },
] as const;

const THREADS_TAB: Tab = { to: "/threads", label: "Threads", Icon: Network };

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

  const tabs: Tab[] = showThreads
    ? [BASE_TABS[0], THREADS_TAB, BASE_TABS[1], BASE_TABS[2]]
    : [...BASE_TABS];

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
        style={{ height: 64, maxWidth: showThreads ? 380 : 320, gap: showThreads ? 36 : 48 }}
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
              : path === to;
          const iconSize = primary ? 32 : 20;
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
                  transform: primary ? undefined : "translateY(4px)",
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
                <Icon size={iconSize} strokeWidth={primary ? 1.5 : 1.6} aria-hidden="true" />
                <span
                  className={cn(
                    "clarity-label font-display tracking-wide",
                    primary ? "text-[13px] font-medium" : "text-[11px]",
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