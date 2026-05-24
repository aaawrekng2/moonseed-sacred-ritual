import { createFileRoute, Link, Outlet, redirect, useLocation } from "@tanstack/react-router";
import { type CSSProperties } from "react";
import {
  Database,
  MessageSquare,
  Palette,
  ShieldCheck,
  Sliders,
  Star,
  User as UserIcon,
  Wand2,
  Layers,
  BarChart2,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { SettingsProvider } from "@/components/settings/SettingsContext";
import { useNavigate } from "@tanstack/react-router";
import { useRegisterCloseHandler } from "@/lib/floating-menu-context";
import { usePortraitOnly } from "@/lib/use-portrait-only";
import { supabase } from "@/lib/supabase";
import { HorizontalScroll } from "@/components/HorizontalScroll";
import { signOutAndClear } from "@/lib/sign-out";

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
    meta: [{ title: "Settings — Tarot Seed" }],
  }),
  beforeLoad: ({ location }) => {
    if (location.pathname === "/settings" || location.pathname === "/settings/") {
      throw redirect({ to: "/settings/profile" });
    }
  },
  component: SettingsLayout,
});

type TabKey =
  | "profile"
  | "blueprint"
  | "preferences"
  | "themes"
  | "guides"
  | "decks"
  | "usage"
  | "feedback"
  | "security"
  | "data";

type TabDef = {
  key: TabKey;
  label: string;
  to:
    | "/settings/profile"
    | "/settings/blueprint"
    | "/settings/preferences"
    | "/settings/themes"
    | "/settings/guides"
    | "/settings/decks"
    | "/settings/usage"
    | "/settings/feedback"
    | "/settings/security"
    | "/settings/data";
  icon: typeof UserIcon;
};

const TABS: TabDef[] = [
  { key: "feedback", label: "Feedback", to: "/settings/feedback", icon: MessageSquare },
  { key: "profile", label: "Profile", to: "/settings/profile", icon: UserIcon },
  { key: "blueprint", label: "Blueprint", to: "/settings/blueprint", icon: Star },
  { key: "security", label: "Security", to: "/settings/security", icon: ShieldCheck },
  { key: "preferences", label: "Preferences", to: "/settings/preferences", icon: Sliders },
  { key: "themes", label: "Themes", to: "/settings/themes", icon: Palette },
  { key: "guides", label: "Guides", to: "/settings/guides", icon: Wand2 },
  { key: "decks", label: "My Decks", to: "/settings/decks", icon: Layers },
  { key: "usage", label: "Usage", to: "/settings/usage", icon: BarChart2 },
  { key: "data", label: "Data", to: "/settings/data", icon: Database },
];

function tabFromPath(pathname: string): TabKey | null {
  if (pathname.startsWith("/settings/feedback")) return "feedback";
  if (pathname.startsWith("/settings/profile")) return "profile";
  if (pathname.startsWith("/settings/blueprint")) return "blueprint";
  if (pathname.startsWith("/settings/security")) return "security";
  if (pathname.startsWith("/settings/preferences")) return "preferences";
  if (pathname.startsWith("/settings/themes")) return "themes";
  if (pathname.startsWith("/settings/guides")) return "guides";
  if (pathname.startsWith("/settings/decks")) return "decks";
  if (pathname.startsWith("/settings/usage")) return "usage";
  if (pathname.startsWith("/settings/data")) return "data";
  return null;
}

function SettingsLayout() {
  // BX — settings stays portrait-only (covers all sub-routes via Outlet).
  usePortraitOnly();
  const { user, loading: authLoading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const activeTab = tabFromPath(location.pathname);

  // Register the X close affordance with the global FloatingMenu so
  // settings still gets a one-tap exit without owning a per-screen
  // top-bar cluster.
  useRegisterCloseHandler(() => void navigate({ to: "/" }));

  // EJ43 — used to be `if (authLoading || !user) return null` which
  // produced a fully blank screen if the anonymous session never
  // resolved. Replaced with a visible fallback so blank screens become
  // diagnostic instead of mysterious.
  if (authLoading) {
    return (
      <main
        className="flex items-center justify-center bg-cosmos px-6"
        style={{
          // EJ47 — TopNav spacer reserves the top band; this main
          // takes the remaining viewport height so the loading text
          // stays vertically centered in the visible area.
          height: "calc(100dvh - var(--topbar-pad))",
          paddingTop: 0,
        }}
      >
        <p
          className="font-serif italic"
          style={{
            color: "var(--color-foreground)",
            opacity: 0.55,
            fontSize: "var(--text-body)",
          }}
        >
          Loading…
        </p>
      </main>
    );
  }
  if (!user) {
    return (
      <main
        className="flex items-center justify-center bg-cosmos px-6"
        style={{
          height: "calc(100dvh - var(--topbar-pad))",
          paddingTop: 0,
        }}
      >
        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          <p
            className="font-serif italic"
            style={{
              color: "var(--color-foreground)",
              opacity: 0.85,
              fontSize: "var(--text-body-lg)",
              lineHeight: 1.5,
            }}
          >
            Couldn't set up your session.
          </p>
          <p
            className="font-serif italic"
            style={{
              color: "var(--color-foreground)",
              opacity: 0.55,
              fontSize: "var(--text-body-sm)",
              lineHeight: 1.6,
            }}
          >
            Tap the moon below to try again. If this keeps happening, open tarotseed.com/?debug=1 to
            surface the cause in the console.
          </p>
          <button
            type="button"
            onClick={() => {
              try {
                window.location.reload();
              } catch {
                /* noop */
              }
            }}
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-body-sm)",
              color: "var(--gold)",
              opacity: 0.85,
              background: "none",
              border: "1px solid color-mix(in oklab, var(--gold) 30%, transparent)",
              padding: "10px 22px",
              borderRadius: 999,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </main>
    );
  }

  return (
    <SettingsProvider>
      {/*
        Scroll fix: html/body/#root are pinned with overflow:hidden, so this
        scroll container needs an explicit viewport height (h-dvh) and its
        own overflow-y-auto to make the Settings content scrollable. The
        bottom padding clears the global BottomNav rendered in __root.tsx
        (do NOT render another BottomNav here — that would duplicate it).
      */}
      <main
        className="overflow-y-auto bg-cosmos pb-28 text-foreground"
        style={{
          // EJ47 — viewport minus TopNav band, matching the other
          // four top-nav routes (journal, numerology, insights, home).
          height: "calc(100dvh - var(--topbar-pad))",
          paddingTop: 0,
        }}
      >
        <div className="mx-auto w-full max-w-5xl px-4">
          {/* Mobile tab bar: canonical tab strip pattern (FU-12). */}
          <div className="-mx-4 mb-6 md:hidden" role="tablist" aria-label="Settings sections">
            <HorizontalScroll className="py-2" contentClassName="items-center gap-6 px-4">
              {TABS.map((t) => {
                const active = activeTab === t.key;
                return (
                  <Link
                    key={t.key}
                    to={t.to}
                    role="tab"
                    aria-selected={active}
                    className="whitespace-nowrap pb-1"
                    style={
                      {
                        fontFamily: "var(--tab-font-family)",
                        fontStyle: "var(--tab-font-style)",
                        fontSize: "var(--tab-font-size)",
                        letterSpacing: "var(--tab-letter-spacing)",
                        textTransform: "var(--tab-text-transform)",
                        color: active ? "var(--tab-active-color)" : "var(--color-foreground)",
                        opacity: active
                          ? "var(--tab-active-opacity)"
                          : "var(--tab-inactive-opacity)",
                        borderBottom: active
                          ? "1px solid var(--tab-underline-color)"
                          : "1px solid transparent",
                      } as CSSProperties
                    }
                  >
                    {t.label}
                  </Link>
                );
              })}
            </HorizontalScroll>
          </div>

          {/* Desktop two-column shell: sidebar + content */}
          <div className="flex gap-0 md:gap-10">
            {/*
              Sidebar: flush against the content edge — no rounded card,
              no surrounding border. Only a faint right divider separates
              it from the content. Sticks to the top of the scroll
              container and grows to roughly the visible viewport height.
            */}
            <aside
              className="sticky top-0 hidden shrink-0 self-start py-6 md:flex md:w-[240px] md:flex-col"
              style={{
                // EJ47 — negative margins removed: parent <main> no
                // longer adds var(--topbar-pad), so the sidebar
                // doesn't need to cancel it out. TopNav spacer
                // reserves the top band.
                marginTop: 0,
                marginBottom: 0,
                background: "var(--surface-card)",
                borderRight: "1px solid var(--border-subtle)",
                minHeight: "100dvh",
              }}
            >
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
                        ? "bg-accent/10 text-foreground"
                        : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground/80",
                    )}
                  >
                    {/*
                      Sidebar nav icons obey the global resting opacity at
                      rest, with active rows getting a +10% bump per the
                      design system.
                    */}
                    <Icon
                      className="h-4 w-4"
                      style={{
                        opacity: active ? "var(--ro-plus-10)" : "var(--ro-plus-0)",
                      }}
                    />
                    <span>{t.label}</span>
                  </Link>
                );
              })}
            </aside>

            <div className="min-w-0 flex-1 md:max-w-[680px] md:pl-2">
              <Outlet />
            </div>
          </div>

          {user.email && (
            <div className="flex justify-center pt-4 pb-8">
              <button
                type="button"
                onClick={async () => {
                  await signOutAndClear();
                }}
                style={{
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: "var(--text-body-sm)",
                  color: "var(--foreground)",
                  opacity: 0.25,
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                }}
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </main>
    </SettingsProvider>
  );
}
