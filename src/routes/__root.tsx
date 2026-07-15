import {
  Outlet,
  Link,
  createRootRoute,
  HeadContent,
  Scripts,
  useLocation,
} from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useState } from "react";
import { useAgeGate } from "@/lib/use-age-gate";
import { AgeLockout } from "@/components/feature-gate/AgeLockout";

import appCss from "../styles.css?url";
import { BottomNav } from "@/components/nav/BottomNav";
import { TopNav, isTopNavRoute } from "@/components/nav/TopNav";
import { useAuth } from "@/lib/auth";
import { usePreferencesSync } from "@/lib/use-preferences-sync";
// Q24 Fix 1 — useTapToPeek is dormant; Clarity feature was dropped, and
// "tap empty space → menu opens" is no longer desired UX.
import { usePWA } from "@/lib/use-pwa";
import { UpdateBanner } from "@/components/UpdateBanner";
// EJ47 — FloatingMenu mount removed from this file. Provider stays
// mounted because Tabletop / ReadingScreen still publish to it
// (tabletopActive flag, etc.). The visible `···` pop-down is gone.
import { FloatingMenuProvider } from "@/lib/floating-menu-context";
import { TipLayer } from "@/components/ui/TipLayer";
import { useThemeFontSync } from "@/lib/use-theme-font-sync";
import { useThemeColorSync } from "@/lib/use-theme-color-sync";
import { Toaster } from "@/components/ui/sonner";
import { useFloatingMenu } from "@/lib/floating-menu-context";
import { DevOverlay } from "@/components/dev/DevOverlay";
import { DevChip } from "@/components/dev/DevChip";
import { TimezoneMismatchDialog } from "@/components/settings/TimezoneMismatchDialog";
import { ActiveDeckProvider } from "@/lib/active-deck";
import { cleanupStaleSessions } from "@/lib/import-session";
import { runQ4StorageCleanup } from "@/lib/q4-storage-cleanup";
import { maybeRunTarotpulseImport } from "@/lib/tarotpulse-import";
import { ConfirmProvider } from "@/hooks/use-confirm";
import { claimStarterCredits } from "@/lib/starter-credits.functions";
import { useServerFn } from "@tanstack/react-start";

/**
 * Read the persisted resting opacity from localStorage and apply it to
 * the document root BEFORE first paint. Without this, the cascade still
 * holds the stylesheet default (0.50) until useRestingOpacity() runs in
 * an effect — long enough for top-bar icons to flash at the wrong fade
 * on every route change. Re-runs on every route change so a Settings →
 * Home navigation always opens with the freshest local value.
 */
function useApplyRestingOpacityEarly() {
  const location = useLocation();
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    // v3.47 — resting-opacity retired; always pin to fully opaque, ignoring any
    // previously-saved "interface fade" value so nothing renders dimmed.
    document.documentElement.style.setProperty("--resting-opacity", "1");
  }, [location.pathname]);
}

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-gold-gradient px-4 py-2 text-sm font-medium text-primary-foreground transition-colors"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content:
          "width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes, viewport-fit=cover",
      },
      { title: "Tarot Seed — Reclaim your agency, one card at a time" },
      {
        name: "description",
        content: "A daily tarot ritual. Sacred, luminous, and calm.",
      },
      { name: "author", content: "Tarot Seed" },
      { name: "theme-color", content: "#0f0c29" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "Tarot Seed" },
      { property: "og:title", content: "Tarot Seed — Reclaim your agency, one card at a time" },
      {
        property: "og:description",
        content: "A daily tarot ritual. Sacred, luminous, and calm.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Tarot Seed — Reclaim your agency, one card at a time" },
      {
        name: "description",
        content:
          "Tarot Seed is a tarot ritual web app that offers a sacred, daily experience with personalized tarot readings.",
      },
      {
        property: "og:description",
        content:
          "Tarot Seed is a tarot ritual web app that offers a sacred, daily experience with personalized tarot readings.",
      },
      {
        name: "twitter:description",
        content:
          "Tarot Seed is a tarot ritual web app that offers a sacred, daily experience with personalized tarot readings.",
      },
      {
        property: "og:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/8816e549-6b01-4556-8eb7-f41f3b24a55c/id-preview-9d9015a6--ba6ec5a7-7b63-4a64-8eba-dff94a3cdd6a.lovable.app-1777058776337.png",
      },
      {
        name: "twitter:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/8816e549-6b01-4556-8eb7-f41f3b24a55c/id-preview-9d9015a6--ba6ec5a7-7b63-4a64-8eba-dff94a3cdd6a.lovable.app-1777058776337.png",
      },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=EB+Garamond:wght@400;500;600;700&family=DM+Serif+Display&family=DM+Sans:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=Libre+Baskerville:wght@400;700&family=Playfair+Display:wght@400;500;600;700&family=Lora:wght@400;500;600;700&display=swap",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "manifest", href: "/manifest.json" },
      { rel: "apple-touch-icon", href: "/icons/icon-192.png" },
      { rel: "icon", type: "image/png", sizes: "192x192", href: "/icons/icon-192.png" },
      { rel: "icon", type: "image/png", sizes: "512x512", href: "/icons/icon-512.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {import.meta.env.DEV ? (
          <script
            dangerouslySetInnerHTML={{
              __html:
                "try{if('serviceWorker'in navigator&&navigator.serviceWorker.controller){var u=new URL(location.href);var clean=u.searchParams.has('__swclean');if(!clean&&window.stop)window.stop();Promise.all([navigator.serviceWorker.getRegistrations().then(function(rs){return Promise.all(rs.map(function(r){return r.unregister()}))}),('caches'in window?caches.keys().then(function(ks){return Promise.all(ks.filter(function(k){return k.indexOf('tarotseed-shell-')===0}).map(function(k){return caches.delete(k)}))}):Promise.resolve())]).then(function(){if(!clean){u.searchParams.set('__swclean','1');location.replace(u.href)}}).catch(function(){})}}catch(e){}",
            }}
          />
        ) : null}
        {/*
          v3.47 — resting-opacity RETIRED. This boot script used to default
          the "interface fade" to 50% when unset, which dimmed whole surfaces.
          It now pins --resting-opacity to 1 (fully opaque) so nothing is
          dimmed on first paint. Kept as a stub (rather than removed) so any
          direct reader of --resting-opacity also gets the opaque value.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{document.documentElement.style.setProperty('--resting-opacity','1');}catch(e){}",
          }}
        />
        {/*
          Synchronously rehydrate the persisted reading font size BEFORE
          first paint. Mirrors the resting-opacity boot script: any
          reading body text that reads `var(--reading-font-size, 17px)`
          will resolve to the seeker's saved value with zero flash.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var v=localStorage.getItem('tarotseed:reading-font-size');var n=v?Math.max(12,Math.min(32,Math.round(Number(v)))):17;document.documentElement.style.setProperty('--reading-font-size',n+'px');}catch(e){}",
          }}
        />
        {/*
          Synchronously rehydrate the seeker's chosen heading font and
          size BEFORE first paint. Without this, every fresh page load
          renders in the stylesheet default until they reopen Themes.
          Mirrors the resting-opacity / reading-font-size boot scripts.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var f=localStorage.getItem('tarotseed:heading-font');if(f){document.documentElement.style.setProperty('--font-serif','\"'+f+'\", ui-serif, Georgia, serif');}var s=localStorage.getItem('tarotseed:heading-font-size');if(s){var n=Math.max(16,Math.min(32,Math.round(Number(s))));if(Number.isFinite(n))document.documentElement.style.setProperty('--heading-scale',String(n/22));}var b=localStorage.getItem('tarotseed:body-font-size');if(b){var m=Math.max(12,Math.min(22,Math.round(Number(b))));if(Number.isFinite(m))document.documentElement.style.setProperty('--body-scale',String(m/15));}}catch(e){}",
          }}
        />
        {/*
          DP-2 — Pre-paint the seeker's saved community theme + accent
          theme attribute BEFORE first paint. Without this, the app
          flashes the stylesheet defaults (gold/Mystic) for one frame
          on every cold load. The token map below is inlined because
          this script runs in <head> before any JS modules. Keep in
          sync with src/lib/community-themes.ts.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var T={'mystic-default':{bgL:'#1e1b4b',bgR:'#2d1b69',sf:'#252056',se:'#2d2664',bs:'#ffffff14',bd:'#ffffff1f',fg:'#f5f3ff',fm:'#c4b8e8',ac:'#f59e0b',af:'#1e1b4b',ao:'#5b21b66b'},'midnight-oracle':{bgL:'#0a0a0f',bgR:'#1e0a3c',sf:'#16162e',se:'#1e1e3d',bs:'#ffffff14',bd:'#ffffff1f',fg:'#ede9fe',fm:'#a78bfa',ac:'#a78bfa',af:'#0a0a0f',ao:'#4c1d9540'},'blood-moon':{bgL:'#1a0000',bgR:'#5c0000',sf:'#330505',se:'#421010',bs:'#ffffff14',bd:'#ffffff1f',fg:'#fff5f0',fm:'#fca5a5',ac:'#fb7185',af:'#1a0000',ao:'#7f1d1d66'},'citrine-dawn':{bgL:'#1a1308',bgR:'#3d2c0a',sf:'#2a1f0c',se:'#372a14',bs:'#ffffff14',bd:'#ffffff1f',fg:'#fefce8',fm:'#fde68a',ac:'#facc15',af:'#1a1308',ao:'#a162074d'},'cups-tide':{bgL:'#001a2c',bgR:'#042234',sf:'#0a2a3f',se:'#10374f',bs:'#ffffff14',bd:'#ffffff1f',fg:'#ecfeff',fm:'#a5f3fc',ac:'#67e8f9',af:'#001a2c',ao:'#0e74904d'},'wands-ember':{bgL:'#1c0a0a',bgR:'#3d1408',sf:'#2a1410',se:'#3a1d18',bs:'#ffffff14',bd:'#ffffff1f',fg:'#fff7ed',fm:'#fed7aa',ac:'#fb923c',af:'#1c0a0a',ao:'#9a34124d'},'pentacles-moss':{bgL:'#0a1a14',bgR:'#16352b',sf:'#102a20',se:'#173a2c',bs:'#ffffff14',bd:'#ffffff1f',fg:'#ecfdf5',fm:'#86efac',ac:'#34d399',af:'#0a1a14',ao:'#1665344d'},'peacocks-tail':{bgL:'#0d0a1f',bgR:'#2a0a3d',sf:'#1a1430',se:'#241a3f',bs:'#ffffff14',bd:'#ffffff1f',fg:'#faf5ff',fm:'#d8b4fe',ac:'#c084fc',af:'#0d0a1f',ao:'#6b21a866'},'nightfall':{bgL:'#000000',bgR:'#1d1d1f',sf:'#1c1c1e',se:'#2c2c2e',bs:'#ffffff14',bd:'#ffffff1f',fg:'#f5f5f7',fm:'#aeaeb2',ac:'#0a84ff',af:'#ffffff'},'daybreak':{bgL:'#ffffff',bgR:'#f5f5f7',sf:'#ffffff',se:'#fbfbfd',bs:'#0000000f',bd:'#0000001f',fg:'#1d1d1f',fm:'#6e6e73',ac:'#0066cc',af:'#ffffff'}};var k=localStorage.getItem('tarotseed:community-theme');if(!k||!T[k])k='midnight-oracle';var t=T[k];var r=document.documentElement;var s=r.style;s.setProperty('--bg-gradient-left',t.bgL);s.setProperty('--bg-gradient-right',t.bgR);s.setProperty('--surface-card',t.sf);s.setProperty('--surface-card-hover',t.se);s.setProperty('--surface-elevated',t.se);s.setProperty('--border-subtle',t.bs);s.setProperty('--border-default',t.bd);s.setProperty('--border',t.bd);s.setProperty('--color-foreground',t.fg);s.setProperty('--foreground',t.fg);s.setProperty('--foreground-muted',t.fm);s.setProperty('--muted-foreground',t.fm);s.setProperty('--accent-color',t.ac);s.setProperty('--primary',t.ac);s.setProperty('--accent',t.ac);s.setProperty('--accent-foreground',t.af);s.setProperty('--ring',t.ac+'99');if(t.ao){s.setProperty('--atmosphere-overlay',t.ao);s.setProperty('--atmosphere-enabled','1');}else{s.setProperty('--atmosphere-enabled','0');}var a=localStorage.getItem('tarotseed:accent-theme');if(a&&a!=='default')r.setAttribute('data-theme',a);}catch(e){}",
          }}
        />
        <HeadContent />
      </head>
      <body>
        {children}
        <TipLayer />
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const location = useLocation();
  // Apply persisted resting opacity to --resting-opacity BEFORE first
  // paint of every route. All --ro-plus-N tokens recompute automatically
  // because they are calc()'d from --resting-opacity in styles.css.
  useApplyRestingOpacityEarly();
  // Anonymous-first auth: ensure every visitor has a Supabase session
  // before any feature reads/writes user-scoped data.
  const { user } = useAuth();
  const isSettingsRoute = location.pathname.startsWith("/settings");
  // v2.72 — adults-only gate. Under-18 (per entered Blueprint birthday) sees a
  // lockout on every route except Settings. Revalidate only across the Settings
  // boundary (not every navigation) so a corrected birthday clears the lock on
  // leaving Settings, without a query on each page.
  const { underage } = useAgeGate(isSettingsRoute ? "settings" : "app");
  // 26-05-08-Q4 — one-time best-effort cleanup of orphan storage
  // folders left behind from the pre-cascade-delete era.
  useEffect(() => {
    if (user?.id) void runQ4StorageCleanup(user.id);
  }, [user?.id]);
  // Q69 — Grant starter credits to brand-new users (idempotent).
  const claimStarter = useServerFn(claimStarterCredits);
  useEffect(() => {
    if (!user?.id || !user.email) return;
    void claimStarter({}).catch(() => {});
  }, [user?.id, user?.email, claimStarter]);
  // Q10 — one-time TarotPulse CSV import (gated to a specific email).
  useEffect(() => {
    if (user?.id) void maybeRunTarotpulseImport(user.id, user.email ?? null);
  }, [user?.id, user?.email]);
  // Mirror local preference values to the Cloud user_preferences row
  // once auth has settled. Local storage stays the source of truth for
  // initial render; this just keeps the server copy fresh.
  usePreferencesSync();
  // Apply the seeker's saved heading font + size globally — both from
  // localStorage on mount and from the server row once auth resolves.
  useThemeFontSync();
  // Q83 — apply saved community color theme + custom accent on every load.
  useThemeColorSync();
  // Q24 Fix 1 — useTapToPeek() removed. Clarity feature was dropped;
  // tapping empty space no longer opens the FloatingMenu.
  // Register the PWA service worker so Tarot Seed installs to home screen.
  usePWA();
  // EJ41 — mobile debug console (eruda). Loads only when explicitly
  // requested via `?debug=1` query param OR when a persisted flag is
  // set in localStorage (so the toggle survives page reloads). When
  // active, it injects a floating bug-icon button in the corner of the
  // page; tapping it opens a Chrome-DevTools-like console panel right
  // on the device. Zero cost for normal users — the library is loaded
  // from CDN lazily, only when the flag is on.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("debug") === "1") {
        localStorage.setItem("tarotseed:eruda", "1");
      } else if (params.get("debug") === "0") {
        localStorage.removeItem("tarotseed:eruda");
        return;
      }
      if (localStorage.getItem("tarotseed:eruda") !== "1") return;
      // Avoid loading twice if effect re-runs.
      const w = window as unknown as { eruda?: { init: () => void } };
      if (w.eruda) return;
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/eruda@3";
      s.onload = () => {
        try {
          (window as unknown as { eruda: { init: () => void } }).eruda.init();
        } catch {
          /* eruda init can be defensive */
        }
      };
      document.body.appendChild(s);
    } catch {
      /* localStorage access can throw in some privacy modes */
    }
  }, []);
  void location;
  // Render the sonner Toaster only after mount. Sonner injects a DOM
  // node that is not present in the SSR markup, which caused a hard
  // hydration mismatch ("server rendered HTML didn't match the client").
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  // Fire-and-forget cleanup of orphaned import-wizard sessions older
  // than 30 days (Stamp BJ Fix 3). Prevents IndexedDB blob accumulation.
  useEffect(() => {
    void cleanupStaleSessions();
  }, []);
  // Q69 — premium tier removed; tarotseed:open-premium listener gone.
  // v2.90 — the old WelcomeModal is retired; the home-screen WelcomeTour
  // (mounted in index.tsx, gated on the splash landing) replaces it.
  return (
    <FloatingMenuProvider>
      <ActiveDeckProvider>
        <ConfirmProvider>
          {/*
          Desktop max-width frame: on screens wider than the breakpoint
          the entire app is constrained to ~430px and centered, so the
          mobile-first layouts don't stretch awkwardly on a laptop. On
          mobile (<= 430px) this wrapper has no effect — width simply
          fills the viewport. The frame also clips overflow so fixed
          children stay within the column.
        */}
          <div
            className="relative mx-auto flex min-h-screen w-full flex-col"
            style={{ maxWidth: 1280 }}
          >
            {/* EJ47 — <FloatingMenu /> mount removed. The whole
                top-right `···` pop-down is gone; its functions either
                migrated into inline UI (Celtic Cross `?`) or live
                exclusively in Settings now (sanctuaries, moon
                carousel toggle, etc.). */}
            <TopNavGate />
            {underage && !isSettingsRoute ? <AgeLockout /> : <Outlet />}
            <BottomNavGate />
            <UpdateBanner />
            <DevOverlay />
            <DevChip />
            {mounted && <Toaster />}
            <TimezoneMismatchDialog />
          </div>
        </ConfirmProvider>
      </ActiveDeckProvider>
    </FloatingMenuProvider>
  );
}

/**
 * EJ47 — Top nav gate. Renders TopNav only on home, journal,
 * numerology, insights, settings (and their sub-routes). The
 * BottomNavGate below suppresses BottomNav on the same routes so we
 * never show two nav surfaces at once.
 */
function TopNavGate() {
  const location = useLocation();
  if (location.pathname.startsWith("/admin")) return null;
  if (!isTopNavRoute(location.pathname)) return null;
  return (
    <>
      <TopNav />
      {/* EJ47 — Flow-occupying spacer that reserves the visual band
          taken by the fixed TopNav (safe-area-inset-top + 56px =
          var(--topbar-pad)). This pushes ALL subsequent Outlet
          content down by exactly the TopNav's height, so pages can't
          accidentally render content under the nav. Pages that
          already added their own `env(safe-area-inset-top)` padding
          had that padding REMOVED for top-nav routes (see EJ48-A
          sweep below) so we don't double-count the safe area. */}
      <div
        aria-hidden
        style={{
          height: "var(--topbar-pad)",
          flexShrink: 0,
        }}
      />
    </>
  );
}

/**
 * Bottom nav gate — hides the global BottomNav while the seeker is on
 * the draw table choosing cards. Visibility is driven by a flag the
 * FloatingMenu context publishes from Tabletop. Also suppresses
 * BottomNav on the five routes where TopNav handles primary nav
 * (EJ47).
 */
function BottomNavGate() {
  const { tabletopActive } = useFloatingMenu();
  const location = useLocation();
  if (location.pathname.startsWith("/admin")) return null;
  if (tabletopActive) return null;
  // EJ47 — defer to TopNav on the five primary destinations.
  if (isTopNavRoute(location.pathname)) return null;
  return <BottomNav />;
}
