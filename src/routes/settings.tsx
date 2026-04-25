import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useLocation,
} from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import {
  Database,
  Palette,
  Sliders,
  Star,
  User as UserIcon,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { SettingsProvider } from "@/components/settings/SettingsContext";
import { TopRightControls } from "@/components/nav/TopRightControls";
import { BottomNav } from "@/components/nav/BottomNav";

/**
 * /settings — layout route. The route itself redirects to
 * /settings/profile, then renders the responsive nav shell + Outlet for
 * the active sub-tab.
 *
 * Mobile: horizontally scrollable underline tab bar at the top with the
 *   first-visit "scroll hint" carried over from the source bundle.
 * Desktop (md+): fixed-width sidebar on the left, content on the right.
 */
export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [{ title: "Settings — Moonseed" }],
  }),
  beforeLoad: ({ location }) => {
    if (
      location.pathname === "/settings" ||
      location.pathname === "/settings/"
    ) {
      throw redirect({ to: "/settings/profile" });
    }
  },
  component: SettingsLayout,
});

type TabKey = "profile" | "blueprint" | "preferences" | "themes" | "data";

type TabDef = {
  key: TabKey;
  label: string;
  to:
    | "/settings/profile"
    | "/settings/blueprint"
    | "/settings/preferences"
    | "/settings/themes"
    | "/settings/data";
  icon: typeof UserIcon;
};

const TABS: TabDef[] = [
  { key: "profile", label: "Profile", to: "/settings/profile", icon: UserIcon },
  { key: "blueprint", label: "Blueprint", to: "/settings/blueprint", icon: Star },
  { key: "preferences", label: "Preferences", to: "/settings/preferences", icon: Sliders },
  { key: "themes", label: "Themes", to: "/settings/themes", icon: Palette },
  { key: "data", label: "Data", to: "/settings/data", icon: Database },
];

function tabFromPath(pathname: string): TabKey | null {
  if (pathname.startsWith("/settings/profile")) return "profile";
  if (pathname.startsWith("/settings/blueprint")) return "blueprint";
  if (pathname.startsWith("/settings/preferences")) return "preferences";
  if (pathname.startsWith("/settings/themes")) return "themes";
  if (pathname.startsWith("/settings/data")) return "data";
  return null;
}

function SettingsLayout() {
  const { user, loading: authLoading } = useAuth();
  const location = useLocation();
  const activeTab = tabFromPath(location.pathname);
  const tabBarRef = useRef<HTMLDivElement | null>(null);

  // First-visit horizontal scroll hint (mobile tab bar) — mirrors the source.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const HINT_KEY = "moonseed.settings.tabsHintShown";
    try {
      if (localStorage.getItem(HINT_KEY)) return;
    } catch {
      return;
    }
    const el = tabBarRef.current;
    if (!el) return;
    if (el.scrollWidth <= el.clientWidth + 4) {
      try {
        localStorage.setItem(HINT_KEY, "1");
      } catch {
        /* noop */
      }
      return;
    }
    const t1 = window.setTimeout(
      () => el.scrollTo({ left: 40, behavior: "smooth" }),
      450,
    );
    const t2 = window.setTimeout(() => {
      el.scrollTo({ left: 0, behavior: "smooth" });
      try {
        localStorage.setItem(HINT_KEY, "1");
      } catch {
        /* noop */
      }
    }, 1100);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);

  if (authLoading || !user) return null;

  return (
    <SettingsProvider>
      <main className="min-h-screen overflow-y-auto bg-cosmos pb-28 pt-[calc(env(safe-area-inset-top)+24px)] text-foreground">
        <TopRightControls />
        <div className="mx-auto w-full max-w-5xl px-4">
          {/* Mobile tab bar: horizontally scrollable underline. */}
          <div className="-mx-4 mb-6 border-b border-gold/10 md:hidden">
            <div
              ref={tabBarRef}
              role="tablist"
              aria-label="Settings sections"
              className="scrollbar-none flex gap-1 overflow-x-auto px-3"
            >
              {TABS.map((t) => {
                const active = activeTab === t.key;
                return (
                  <Link
                    key={t.key}
                    to={t.to}
                    role="tab"
                    aria-selected={active}
                    className={cn(
                      "relative inline-flex shrink-0 items-center gap-2 whitespace-nowrap bg-transparent px-4 py-3 text-sm font-medium transition-colors",
                      active
                        ? "text-gold"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span>{t.label}</span>
                    <span
                      className={cn(
                        "pointer-events-none absolute inset-x-4 -bottom-px h-[2.5px] rounded-t-sm bg-gold transition-all duration-300",
                        active
                          ? "scale-x-100 opacity-100"
                          : "scale-x-0 opacity-0",
                      )}
                    />
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Desktop two-column shell: sidebar + content */}
          <div className="flex gap-0 md:gap-10">
            <aside className="sticky top-6 hidden h-fit shrink-0 self-start rounded-2xl border border-gold/10 bg-[oklch(0.13_0.04_280)] py-3 md:flex md:w-[240px] md:flex-col">
              {TABS.map((t) => {
                const Icon = t.icon;
                const active = activeTab === t.key;
                return (
                  <Link
                    key={t.key}
                    to={t.to}
                    className={cn(
                      "flex items-center gap-3 px-6 py-2.5 text-sm font-normal transition-colors duration-150",
                      active
                        ? "bg-[oklch(0.82_0.14_82_/_0.10)] text-foreground"
                        : "text-muted-foreground hover:bg-[oklch(0.82_0.14_82_/_0.05)] hover:text-foreground/80",
                    )}
                  >
                    <Icon className="h-4 w-4 opacity-70" />
                    <span>{t.label}</span>
                  </Link>
                );
              })}
            </aside>

            <div className="min-w-0 flex-1 md:max-w-[680px] md:pl-2">
              <Outlet />
            </div>
          </div>
        </div>
        <BottomNav />
      </main>
    </SettingsProvider>
  );
}