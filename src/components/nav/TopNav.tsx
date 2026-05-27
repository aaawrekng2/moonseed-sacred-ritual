/**
 * EJ47 — TopNav.
 *
 * Renders on home, journal, numerology, insights, settings (and their
 * sub-routes). Equal-sized icons, home uses a Home icon (no longer a
 * moon), and the bar auto-hides on scroll down / reappears on any
 * scroll up — matching the Material Design "scroll-aware app bar"
 * pattern used by Reddit, Twitter/X, Google search, Medium, etc.
 *
 * The bar is render-mounted only by TopNavGate on the listed routes;
 * BottomNavGate suppresses the BottomNav on the same routes so we
 * never show two navs at once.
 *
 * EJ64 — Compact-default + expand-on-hover/click rail pattern.
 * Default state: 28px tall, icons only, no labels. Page content sits
 * at this height (TopNavGate spacer = 28px). Expanded state: 56px
 * tall with labels. Triggers: hover (desktop), click (mobile/tablet).
 * Auto-collapses 3s after expand. The expanded bar OVERLAYS content
 * beneath (the spacer doesn't grow), so the page never reflows.
 *
 * EJ65 — Pure navigation. Left rail and right spacer removed entirely.
 * All page-specific toggles (moon carousel hide, calendar cycler, view
 * swap) moved into the new left fly-out PageMenu. TopNav is now just
 * the 5 destination icons, centered.
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
// uses the Home icon (not the Moon).
const TABS: readonly Tab[] = [
  { to: "/journal", label: "Journal", Icon: BookOpen },
  { to: "/numerology", label: "Numerology", Icon: Hash },
  { to: "/", label: "Home", Icon: Home },
  { to: "/insights", label: "Insights", Icon: BarChart3 },
  { to: "/settings", label: "Settings", Icon: Settings },
] as const;

// Minimum vertical scroll delta (in px) before we'll change visible
// state. Prevents jitter on tiny corrective scrolls.
const SCROLL_THRESHOLD = 8;

// EJ64 — Auto-collapse delay after expand. 3 seconds is the industry
// midpoint for tap-to-expand auto-collapsing menus (Twitter, Stripe,
// Linear). Timer resets on icon tap so the seeker can act without
// the bar collapsing mid-interaction.
// EJ69 — Tightened from 3000ms to 2000ms. Cori wants less hang-time
// after seeker stops interacting; 2s is still industry-acceptable and
// matches Stripe's collapse timing.
const AUTO_COLLAPSE_MS = 2000;

// EJ64 — Heights. Default = compact (icons only). Expanded = full
// (icons + labels). Page content sits at the compact height via
// TopNavGate's spacer; the expanded bar overlays content beneath.
const COMPACT_HEIGHT = 28;
const EXPANDED_HEIGHT = 56;

export function TopNav() {
  const location = useLocation();
  const hideMenu = useDevHideMenu();
  const [visible, setVisible] = useState(true);
  const [expanded, setExpanded] = useState(false);
  // EJ68 — Track mobile breakpoint so we can tighten icon spacing.
  // The 24px desktop gap was crowding on narrow phones, especially
  // after EJ68 adds /draw to TopNav routes where there's less
  // horizontal room than on Home/Journal/etc. On mobile we drop
  // to 12px so all five icons sit comfortably between the
  // hamburger (far left) and X close (far right on /draw).
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(max-width: 640px)");
    setIsMobile(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const collapseTimerRef = useRef<number | null>(null);
  const lastYRef = useRef<number>(0);
  const lastDirRef = useRef<"up" | "down" | null>(null);

  const startCollapseTimer = () => {
    if (collapseTimerRef.current !== null) {
      window.clearTimeout(collapseTimerRef.current);
    }
    collapseTimerRef.current = window.setTimeout(() => {
      setExpanded(false);
      collapseTimerRef.current = null;
    }, AUTO_COLLAPSE_MS);
  };

  const clearCollapseTimer = () => {
    if (collapseTimerRef.current !== null) {
      window.clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
  };

  const handleMouseEnter = () => {
    clearCollapseTimer();
    setExpanded(true);
  };
  const handleMouseLeave = () => {
    startCollapseTimer();
  };
  const handleClick = () => {
    if (!expanded) {
      setExpanded(true);
      startCollapseTimer();
    } else {
      startCollapseTimer();
    }
  };
  // EJ64 — Reset auto-collapse timer when the seeker taps any nav
  // icon. Lets them dwell on the expanded bar without it shrinking.
  const handleIconInteraction = () => {
    if (expanded) startCollapseTimer();
  };

  useEffect(() => {
    return () => {
      if (collapseTimerRef.current !== null) {
        window.clearTimeout(collapseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    lastYRef.current = window.scrollY || 0;
    const onScroll = () => {
      const y = window.scrollY || 0;
      const dy = y - lastYRef.current;
      if (Math.abs(dy) < SCROLL_THRESHOLD) return;
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

  useEffect(() => {
    setVisible(true);
    setExpanded(false);
    clearCollapseTimer();
    lastYRef.current = typeof window !== "undefined" ? window.scrollY || 0 : 0;
    lastDirRef.current = "up";
  }, [location.pathname]);

  if (hideMenu) return null;

  const currentHeight = expanded ? EXPANDED_HEIGHT : COMPACT_HEIGHT;

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 top-0 border-b backdrop-blur-xl"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
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
      <div
        style={{
          height: currentHeight,
          transition: "height 200ms cubic-bezier(0.2, 0.8, 0.2, 1)",
          overflow: "hidden",
        }}
      >
        {/* EJ65 — Pure centered nav. Removed the 80px left rail and
            80px right spacer that were squeezing the icons on narrow
            mobile viewports. The 5 icons now use the full available
            width and stay visually centered. */}
        <ul
          className="mx-auto flex h-full items-center justify-center px-4"
          style={{ maxWidth: 720, gap: isMobile ? 8 : 24 }}
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
                  onClick={handleIconInteraction}
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
                  <Icon size={18} strokeWidth={1.6} aria-hidden="true" />
                  <span
                    className="clarity-label font-display tracking-wide text-[11px]"
                    style={{
                      maxHeight: expanded ? 16 : 0,
                      opacity: expanded ? 1 : 0,
                      overflow: "hidden",
                      transition:
                        "max-height 200ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 160ms ease-out",
                    }}
                  >
                    {label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}

/** Routes (including sub-routes) where TopNav is rendered.
 *  EJ68 — /draw added. Tabletop now shares the same TopNav as Home
 *  so the seeker has a consistent navigation surface across pages,
 *  and the draw page's count stepper / undo / redo row can sit
 *  directly under the nav band instead of inside its own bespoke
 *  top chrome. */
export const TOP_NAV_ROUTES = [
  "/",
  "/journal",
  "/numerology",
  "/insights",
  "/settings",
  "/draw",
] as const;

/** True when the current pathname is one of the TopNav routes. */
export function isTopNavRoute(pathname: string): boolean {
  if (pathname === "/") return true;
  for (const route of TOP_NAV_ROUTES) {
    if (route === "/") continue;
    if (pathname === route || pathname.startsWith(`${route}/`)) return true;
  }
  return false;
}
