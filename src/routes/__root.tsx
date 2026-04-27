import { Outlet, Link, createRootRoute, HeadContent, Scripts, useLocation } from "@tanstack/react-router";
import { useLayoutEffect } from "react";

import appCss from "../styles.css?url";
import { BottomNav } from "@/components/nav/BottomNav";
import { RestingOpacityReadout } from "@/components/nav/RestingOpacityReadout";
import { useAuth } from "@/lib/auth";
import { usePreferencesSync } from "@/lib/use-preferences-sync";
import { OracleModeProvider } from "@/lib/use-oracle-mode";
import { useTapToPeek } from "@/lib/use-tap-to-peek";
import { usePWA } from "@/lib/use-pwa";
import { FloatingMenu } from "@/components/nav/FloatingMenu";
import { FloatingMenuProvider } from "@/lib/floating-menu-context";
import { useThemeFontSync } from "@/lib/use-theme-font-sync";
import { Toaster } from "@/components/ui/sonner";

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
    const raw = window.localStorage.getItem("moonseed:resting-opacity");
    if (raw == null) return;
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const pct = Math.max(25, Math.min(100, Math.round(n)));
    document.documentElement.style.setProperty(
      "--resting-opacity",
      String(pct / 100),
    );
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
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes, viewport-fit=cover" },
      { title: "Moonseed — Tarot that remembers you" },
      {
        name: "description",
        content: "A daily tarot ritual. Sacred, luminous, and calm.",
      },
      { name: "author", content: "Moonseed" },
      { name: "theme-color", content: "#0f0c29" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "Moonseed" },
      { property: "og:title", content: "Moonseed — Tarot that remembers you" },
      {
        property: "og:description",
        content: "A daily tarot ritual. Sacred, luminous, and calm.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Moonseed — Tarot that remembers you" },
      { name: "description", content: "Moonseed is a tarot ritual web app that offers a sacred, daily experience with personalized tarot readings." },
      { property: "og:description", content: "Moonseed is a tarot ritual web app that offers a sacred, daily experience with personalized tarot readings." },
      { name: "twitter:description", content: "Moonseed is a tarot ritual web app that offers a sacred, daily experience with personalized tarot readings." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/8816e549-6b01-4556-8eb7-f41f3b24a55c/id-preview-9d9015a6--ba6ec5a7-7b63-4a64-8eba-dff94a3cdd6a.lovable.app-1777058776337.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/8816e549-6b01-4556-8eb7-f41f3b24a55c/id-preview-9d9015a6--ba6ec5a7-7b63-4a64-8eba-dff94a3cdd6a.lovable.app-1777058776337.png" },
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
        href: "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=Inter:wght@400;500&display=swap",
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
        {/*
          Synchronously apply persisted resting opacity BEFORE any CSS
          paints. Sets --resting-opacity on <html> so all --ro-plus-N
          tokens (computed via clamp() in styles.css) resolve to the
          user's value on first paint — zero flash, zero jump.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var v=localStorage.getItem('moonseed:resting-opacity');var n=v?Math.max(25,Math.min(100,Math.round(Number(v)))):50;document.documentElement.style.setProperty('--resting-opacity',String(n/100));}catch(e){}",
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
              "try{var v=localStorage.getItem('moonseed:reading-font-size');var n=v?Math.max(12,Math.min(20,Math.round(Number(v)))):17;document.documentElement.style.setProperty('--reading-font-size',n+'px');}catch(e){}",
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
              "try{var f=localStorage.getItem('moonseed:heading-font');if(f){document.documentElement.style.setProperty('--font-serif','\"'+f+'\", ui-serif, Georgia, serif');}var s=localStorage.getItem('moonseed:heading-font-size');if(s){var n=Math.max(16,Math.min(32,Math.round(Number(s))));if(Number.isFinite(n))document.documentElement.style.setProperty('--heading-scale',String(n/22));}}catch(e){}",
          }}
        />
        <HeadContent />
      </head>
      <body>
        {children}
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
  useAuth();
  // Mirror local preference values to the Cloud user_preferences row
  // once auth has settled. Local storage stays the source of truth for
  // initial render; this just keeps the server copy fresh.
  usePreferencesSync();
  // Apply the seeker's saved heading font + size globally — both from
  // localStorage on mount and from the server row once auth resolves.
  useThemeFontSync();
  // Global "tap empty space to briefly reveal hidden UI" affordance.
  // Active in any Clarity level — costless when the user is already at Seen.
  useTapToPeek();
  // Register the PWA service worker so Moonseed installs to home screen.
  usePWA();
  // Bottom nav is now visible everywhere — including during the draw and
  // reading flow — so the seeker can always reach Home / Journal /
  // Settings without backing out of a reading.
  const hideChrome = false;
  void location;
  return (
    <OracleModeProvider>
      <FloatingMenuProvider>
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
          <FloatingMenu />
          <RestingOpacityReadout />
          <Outlet />
          {!hideChrome && <BottomNav />}
          <Toaster />
        </div>
      </FloatingMenuProvider>
    </OracleModeProvider>
  );
}
