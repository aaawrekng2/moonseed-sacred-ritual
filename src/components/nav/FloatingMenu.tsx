import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  CheckCheck,
  Clipboard,
  Eye,
  EyeClosed,
  EyeOff,
  RotateCw,
  ScrollText,
  Wand2,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useOracleMode } from "@/lib/use-oracle-mode";
import { useSavedThemes } from "@/lib/use-saved-themes";
import { useRestingOpacity } from "@/lib/use-resting-opacity";
import { useUIDensity } from "@/lib/use-ui-density";
import { useFloatingMenu } from "@/lib/floating-menu-context";
import { applySanctuary } from "@/components/nav/TopRightControls";
import { setStoredCommunityTheme } from "@/lib/community-themes";
import { dispatchActiveThemeChanged } from "@/lib/theme-events";

/**
 * Global floating ··· menu. Mounted ONCE in __root.tsx, hovers above
 * every screen at the top-right. At rest only the ··· trigger is
 * visible at resting opacity. On tap (or when a global peek event
 * fires) the trigger hides and a frosted pill drops down with all
 * available controls at 100% opacity. After a 2000ms hold the pill
 * fades back to resting opacity over 2000ms, then disappears and the
 * ··· returns.
 *
 * Per-screen controls (Copy / Refresh / X-close) are registered
 * through `floating-menu-context` so the menu itself never needs to
 * know which route is active.
 */
export function FloatingMenu() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isOracle, toggle: toggleOracle } = useOracleMode();
  const { occupied, activeSlot, setActiveSlot } = useSavedThemes();
  const { setOpacity } = useRestingOpacity();
  const { level, cycleLevel } = useUIDensity();
  const { closeHandler, copyText, showRefresh } = useFloatingMenu();

  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<"closed" | "open-bright" | "open-dim">(
    "closed",
  );
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const holdTimer = useRef<number | null>(null);
  const fadeTimer = useRef<number | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    const t = window.setTimeout(() => {
      mountedRef.current = true;
    }, 500);
    return () => window.clearTimeout(t);
  }, []);

  const clarityIcon =
    level === 1 ? (
      <Eye size={18} strokeWidth={1.5} />
    ) : level === 2 ? (
      <EyeOff size={18} strokeWidth={1.5} />
    ) : (
      <EyeClosed size={18} strokeWidth={1.5} />
    );

  const openMenu = () => {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    if (fadeTimer.current) window.clearTimeout(fadeTimer.current);
    setOpen(true);
    setPhase("open-bright");
    holdTimer.current = window.setTimeout(() => {
      setPhase("open-dim");
      fadeTimer.current = window.setTimeout(() => {
        setOpen(false);
        setPhase("closed");
      }, 2500);
    }, 2500);
  };

  // Listen for global peek events so the menu opens when the user taps
  // empty space anywhere on the page.
  useEffect(() => {
    const handler = () => {
      if (!mountedRef.current) return;
      if (!open) openMenu();
    };
    window.addEventListener("moonseed:peek", handler);
    return () => window.removeEventListener("moonseed:peek", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    return () => {
      if (holdTimer.current) window.clearTimeout(holdTimer.current);
      if (fadeTimer.current) window.clearTimeout(fadeTimer.current);
    };
  }, []);

  const handleCopy = () => {
    if (!copyText) return;
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard.writeText(copyText).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  const handleRefresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    window.setTimeout(() => {
      if (typeof window !== "undefined") window.location.reload();
    }, 500);
  };

  const cycleSanctuary = () => {
    if (occupied.length === 0) return;
    const currentIdx = occupied.findIndex((t) => t.slot === activeSlot);
    const nextIdx =
      currentIdx === -1 ? 0 : (currentIdx + 1) % occupied.length;
    const next = occupied[nextIdx];
    if (!next) return;
    applySanctuary(next, setOpacity);
    void setActiveSlot(next.slot);
    setStoredCommunityTheme(null);
    dispatchActiveThemeChanged({
      source: "sanctuary",
      name: next.name,
      accent: next.accent,
      sanctuarySlot: next.slot,
      communityKey: null,
    });
  };

  const derivedInitial = (() => {
    const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
    const name =
      (typeof meta.display_name === "string" && meta.display_name) ||
      (typeof meta.full_name === "string" && meta.full_name) ||
      (typeof meta.name === "string" && meta.name) ||
      user?.email ||
      "M";
    return name.trim().charAt(0).toUpperCase() || "M";
  })();

  return (
    <div
      className="fixed z-[60]"
      style={{
        top: "calc(env(safe-area-inset-top, 0px) + 8px)",
        right: "calc(env(safe-area-inset-right, 0px) + 12px)",
      }}
    >
      <button
        type="button"
        aria-label="Open menu"
        onClick={openMenu}
        style={{
          opacity: open ? 0 : "var(--ro-plus-0)",
          pointerEvents: open ? "none" : "auto",
          transition: "opacity 400ms ease",
          background: "transparent",
          border: "none",
          color: "var(--gold)",
          fontSize: 22,
          letterSpacing: 2,
          height: 44,
          minWidth: 44,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          padding: 0,
          lineHeight: 1,
          position: "absolute",
          top: 0,
          right: 0,
        }}
      >
        ···
      </button>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          padding: "4px 8px",
          borderRadius: 999,
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          background: "oklch(0.10 0.03 280 / 35%)",
          border:
            "1px solid color-mix(in oklch, var(--gold) 12%, transparent)",
          boxShadow: "0 2px 16px oklch(0 0 0 / 0.25)",
          opacity: open
            ? phase === "open-bright"
              ? "var(--ro-plus-40)"
              : "var(--ro-plus-10)"
            : 0,
          transform: open ? "translateY(0)" : "translateY(-12px)",
          pointerEvents: open ? "auto" : "none",
          transition: open
            ? "opacity 500ms ease, transform 500ms cubic-bezier(0.22, 1, 0.36, 1)"
            : "opacity 600ms ease, transform 600ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
          {copyText && (
            <MenuButton onClick={handleCopy} ariaLabel="Copy reading">
              {copied ? (
                <CheckCheck size={17} strokeWidth={1.5} />
              ) : (
                <Clipboard size={17} strokeWidth={1.5} />
              )}
            </MenuButton>
          )}

          {showRefresh && (
            <MenuButton onClick={handleRefresh} ariaLabel="Refresh">
              <RotateCw
                size={17}
                strokeWidth={1.5}
                style={{
                  animation: refreshing ? "spin 1s linear infinite" : undefined,
                }}
              />
            </MenuButton>
          )}

          <MenuButton
            onClick={toggleOracle}
            ariaLabel={`Voice: ${isOracle ? "Oracle" : "Plain"}`}
          >
            <ScrollText size={17} strokeWidth={1.5} />
          </MenuButton>

          {occupied.length > 0 && (
            <MenuButton onClick={cycleSanctuary} ariaLabel="Cycle sanctuaries">
              <Wand2 size={17} strokeWidth={1.5} />
            </MenuButton>
          )}

          <MenuButton
            onClick={cycleLevel}
            ariaLabel={`Clarity: ${
              level === 1 ? "Seen" : level === 2 ? "Glimpse" : "Veiled"
            }`}
          >
            {clarityIcon}
          </MenuButton>

          <MenuButton
            onClick={() => navigate({ to: "/settings" })}
            ariaLabel="Settings"
          >
            <span
              className="flex h-7 w-7 items-center justify-center rounded-full font-display text-[13px] leading-none"
              style={{
                background:
                  "color-mix(in oklch, var(--gold) 15%, transparent)",
                border:
                  "1px solid color-mix(in oklch, var(--gold) 40%, transparent)",
                color: "var(--gold)",
              }}
            >
              {derivedInitial}
            </span>
          </MenuButton>

          {closeHandler && (
            <MenuButton onClick={closeHandler} ariaLabel="Close">
              <X size={17} strokeWidth={1.5} />
            </MenuButton>
          )}
      </div>
    </div>
  );
}

function MenuButton({
  onClick,
  ariaLabel,
  children,
}: {
  onClick: () => void;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className="flex h-11 w-11 items-center justify-center rounded-full text-gold transition-colors hover:bg-gold/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
    >
      {children}
    </button>
  );
}