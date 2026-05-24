/**
 * EJ47 — TopNav.
 *
 * Renders on home, journal, numerology, insights, settings (and their
 * sub-routes). Equal-sized icons (no cascade), home uses a Home icon
 * (no longer a moon), and the bar auto-hides on scroll down /
 * reappears on any scroll up — matching the Material Design "scroll-
 * aware app bar" pattern used by Reddit, Twitter/X, Google search,
 * Medium, etc.
 *
 * The bar is render-mounted only by TopNavGate on the listed routes;
 * BottomNavGate suppresses the BottomNav on the same routes so we
 * never show two navs at once.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { Home, BookOpen, Settings, Hash, BarChart3 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDevHideMenu } from "@/components/dev/DevOverlay";

type Tab = {
  to: "/" | "/journal" | "/settings" | "/numerology" | "/insights";
  label: string;
  Icon: LucideIcon;
};

// Equal-weight 5-tab order. Same destinations as BottomNav, but Home
// uses the Home icon (not the Moon) and no tab is marked primary —
// all icons render at the same 20px size with 11px labels (the
// "current smallest" values from BottomNav per the EJ47 spec).
const TABS: readonly Tab[] = [
  { to: "/journal", label: "Journal", Icon: BookOpen },
  { to: "/numerology", label: "Numerology", Icon: Hash },
  { to: "/", label: "Home", Icon: Home },
  { to: "/insights", label: "Insights", Icon: BarChart3 },
  { to: "/settings", label: "Settings", Icon: Settings },
] as const;

// Minimum vertical scroll delta (in px) before we'll change visible
// state. Prevents the bar from jittering when the seeker's finger
// makes tiny corrective scrolls. Matches Material's default behavior.
const SCROLL_THRESHOLD = 8;

export function TopNav() {
  const location = useLocation();
  // EJ49 — Admin dev toggle: when "Hide menu" is on, suppress the
  // TopNav UI entirely. The TopNavGate spacer stays in document flow
  // upstream of us, so page content does NOT shift up — there's just
  // an empty band at the top of the viewport. Lets admins inspect
  // what would otherwise be hidden behind the fixed nav.
  const hideMenu = useDevHideMenu();
  const [visible, setVisible] = useState(true);
  const lastYRef = useRef<number>(0);
  const lastDirRef = useRef<"up" | "down" | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    lastYRef.current = window.scrollY || 0;
    const onScroll = () => {
      const y = window.scrollY || 0;
      const dy = y - lastYRef.current;
      if (Math.abs(dy) < SCROLL_THRESHOLD) return; // jitter guard
      // Always show when near the top of the page.
      if (y < 24) {
        setVisible(true);
        lastYRef.current = y;
        lastDirRef.current = "up";
        return;
      }
      if (dy > 0 && lastDirRef.current !== "down") {
        setVisible(false);
        lastDirRef.current = "down";
      } else if (dy < 0 && lastDirRef.current !== "up") {
        setVisible(true);
        lastDirRef.current = "up";
      }
      lastYRef.current = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Reset visible state on route change so the seeker never lands on
  // a new page with the bar hidden.
  useEffect(() => {
    setVisible(true);
    lastYRef.current = typeof window !== "undefined" ? window.scrollY || 0 : 0;
    lastDirRef.current = "up";
  }, [location.pathname]);

  // EJ49 — dev "Hide menu" toggle takes precedence over all other
  // visibility logic. The spacer in TopNavGate is unconditional and
  // stays mounted, so suppressing only the <nav> element here doesn't
  // shift any page layout.
  if (hideMenu) return null;

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 top-0 border-b backdrop-blur-xl"
      style={{
        zIndex: "var(--z-bottom-nav)" as unknown as number,
        background: "color-mix(in oklch, var(--surface-elevated) 90%, transparent)",
        borderBottomColor: "var(--border-default)",
        paddingTop: "env(safe-area-inset-top, 0px)",
        transform: visible ? "translateY(0)" : "translateY(-110%)",
        transition: "transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)",
        willChange: "transform",
      }}
    >
      <ul
        className="mx-auto flex items-center justify-center px-4"
        style={{ height: 56, maxWidth: 560, gap: 24 }}
      >
        {TABS.map(({ to, label, Icon }) => {
          const path = location.pathname;
          const hasSubRoutes = to !== "/" && to !== "/journal";
          const active = hasSubRoutes ? path === to || path.startsWith(`${to}/`) : path === to;
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
                  "flex flex-col items-center gap-0.5 rounded-lg px-2 py-1 transition-all hover:opacity-100",
                  "outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-gold/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  active ? "text-gold" : "text-foreground",
                )}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={20} strokeWidth={1.6} aria-hidden="true" />
                <span
                  className={cn(
                    "clarity-label font-display tracking-wide text-[11px]",
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

/** Routes (including sub-routes) where TopNav is rendered. */
export const TOP_NAV_ROUTES = ["/", "/journal", "/numerology", "/insights", "/settings"] as const;

/** True when the current pathname is one of the TopNav routes. */
export function isTopNavRoute(pathname: string): boolean {
  // Home is exact-match only ("/" alone, not "/something").
  if (pathname === "/") return true;
  for (const route of TOP_NAV_ROUTES) {
    if (route === "/") continue;
    if (pathname === route || pathname.startsWith(`${route}/`)) return true;
  }
  return false;
}
