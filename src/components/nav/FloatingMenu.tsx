import { useEffect, useRef, useState } from "react";
import {
  CheckCheck,
  Clipboard,
  Bug,
  HelpCircle,
  Moon,
  RotateCw,
  UserRound,
  Wand2,
  Bell,
  MoreHorizontal,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useSavedThemes } from "@/lib/use-saved-themes";
import { useFloatingMenu } from "@/lib/floating-menu-context";
import { applySanctuary } from "@/components/nav/TopRightControls";
import { setStoredCommunityTheme } from "@/lib/community-themes";
import { dispatchActiveThemeChanged } from "@/lib/theme-events";
import { useAuth } from "@/lib/auth";
import { setDevMode } from "@/components/dev/DevOverlay";
import { supabase } from "@/lib/supabase";
import { emitMoonPrefsChanged, useMoonPrefs } from "@/lib/use-moon-prefs";
import { updateUserPreferences } from "@/lib/user-preferences-write";
import {
  useHoverSnooze,
  applySnooze,
  clearSnooze,
  SNOOZE_OPTIONS,
} from "@/lib/hover-snooze";

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
function tipsMenuItemStyle(highlight: boolean): React.CSSProperties {
  return {
    textAlign: "left",
    fontFamily: "var(--font-serif)",
    fontSize: 12,
    padding: "6px 8px",
    border: "none",
    borderRadius: "var(--radius-sm, 6px)",
    background: "transparent",
    cursor: "pointer",
    color: highlight ? "var(--accent, var(--gold))" : "var(--color-foreground)",
    whiteSpace: "nowrap",
  };
}

export function FloatingMenu() {
  const { occupied, activeSlot, setActiveSlot } = useSavedThemes();
  const { closeHandler, copyText, showRefresh, shareBuilderClose, hidden } = useFloatingMenu();
  const { helpHandler } = useFloatingMenu();
  const { user } = useAuth();
  const moonPrefs = useMoonPrefs();
  // CL Group 3 — admin-only dev mode toggle, mirroring DevOverlay's
  // user_preferences.role check. Anonymous and non-admin sessions
  // never see the button.
  const [isAdmin, setIsAdmin] = useState(false);
  const [devOn, setDevOn] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("tarotseed:dev_mode") === "true";
  });
  useEffect(() => {
    if (!user) {
      setIsAdmin(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("user_preferences")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      const role = (data as { role?: string } | null)?.role;
      setIsAdmin(role === "admin" || role === "super_admin");
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<boolean>).detail;
      setDevOn(
        typeof detail === "boolean"
          ? detail
          : window.localStorage.getItem("tarotseed:dev_mode") === "true",
      );
    };
    window.addEventListener("tarotseed:dev-mode-changed", onChange);
    return () => window.removeEventListener("tarotseed:dev-mode-changed", onChange);
  }, []);
  const navigate = useNavigate();
  const userInitial =
    (user?.email?.[0] as string | undefined) ??
    ((user?.user_metadata as { display_name?: string } | undefined)?.display_name?.[0] as
      | string
      | undefined) ??
    null;

  const [open, setOpen] = useState(false);
  const [tipsMenuOpen, setTipsMenuOpen] = useState(false);
  const { snoozed: tipsSnoozed } = useHoverSnooze();
  const [phase, setPhase] = useState<"closed" | "open-bright" | "open-dim">("closed");
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [tapLabel, setTapLabel] = useState<{ text: string; x: number } | null>(null);
  const holdTimer = useRef<number | null>(null);
  const fadeTimer = useRef<number | null>(null);
  const labelTimer = useRef<number | null>(null);
  const mountedRef = useRef(false);
  const pillRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => {
      mountedRef.current = true;
    }, 500);
    return () => window.clearTimeout(t);
  }, []);

  // EJ43 — long-press handler removed. Cori reported it stomps the
  // native long-press / context-menu gesture on mobile, and the global
  // FloatingMenu trigger is preserved via other entry points (BottomNav
  // taps surface the menu when needed). Path B (Q33 Fix 5) is retired.

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
      }, 500);
    }, 800);
  };

  // Reset the auto-close timer whenever the user interacts with an icon
  // inside the open pill. Keeps the menu visible for another full hold so
  // the user can chain multiple toggles without it disappearing mid-action.
  const resetTimer = () => {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    if (fadeTimer.current) window.clearTimeout(fadeTimer.current);
    setPhase("open-bright");
    holdTimer.current = window.setTimeout(() => {
      setPhase("open-dim");
      fadeTimer.current = window.setTimeout(() => {
        setOpen(false);
        setPhase("closed");
      }, 500);
    }, 800);
  };

  // Briefly show a small italic label below the pill describing the
  // change the user just made (e.g. "Oracle", "Veiled", a sanctuary name).
  const showLabel = (text: string, e?: React.MouseEvent) => {
    if (labelTimer.current) window.clearTimeout(labelTimer.current);
    let x = 0;
    if (e) {
      const btn = e.currentTarget as HTMLElement;
      const btnRect = btn.getBoundingClientRect();
      const pillRect = pillRef.current?.getBoundingClientRect();
      if (pillRect) {
        x = btnRect.left + btnRect.width / 2 - pillRect.left;
      }
    }
    setTapLabel({ text, x });
    labelTimer.current = window.setTimeout(() => setTapLabel(null), 1500);
  };

  // Q24 Fix 1 — tarotseed:peek listener removed. The ··· button is now
  // the ONLY way to open the FloatingMenu; tap-to-peek is gone with
  // the Clarity feature.

  useEffect(() => {
    return () => {
      if (holdTimer.current) window.clearTimeout(holdTimer.current);
      if (fadeTimer.current) window.clearTimeout(fadeTimer.current);
      if (labelTimer.current) window.clearTimeout(labelTimer.current);
    };
  }, []);

  if (hidden) return null;

  const handleCopy = () => {
    if (!copyText) return;
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard.writeText(copyText).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
    resetTimer();
  };

  const handleRefresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    window.setTimeout(() => {
      if (typeof window !== "undefined") window.location.reload();
    }, 500);
  };

  const toggleMoonCarousel = (e: React.MouseEvent) => {
    const next = !moonPrefs.moon_show_carousel;
    emitMoonPrefsChanged({ moon_show_carousel: next });
    if (user) {
      void updateUserPreferences(user.id, { moon_show_carousel: next });
    }
    showLabel(next ? "Moon on" : "Moon off", e);
    resetTimer();
  };

  const cycleSanctuary = (e: React.MouseEvent) => {
    if (occupied.length === 0) return;
    const currentIdx = occupied.findIndex((t) => t.slot === activeSlot);
    const nextIdx = currentIdx === -1 ? 0 : (currentIdx + 1) % occupied.length;
    const next = occupied[nextIdx];
    if (!next) return;
    applySanctuary(next);
    void setActiveSlot(next.slot);
    setStoredCommunityTheme(null);
    dispatchActiveThemeChanged({
      source: "sanctuary",
      name: next.name,
      accent: next.accent,
      sanctuarySlot: next.slot,
      communityKey: null,
    });
    showLabel(next.name, e);
    resetTimer();
  };

  return (
    <div
      className="fixed"
      style={{
        top: "env(safe-area-inset-top, 0px)",
        right: "calc(env(safe-area-inset-right, 0px) + 10px)",
        zIndex: "var(--z-modal-nested)",
        pointerEvents: open ? "auto" : "none",
      }}
    >
      <div
        ref={pillRef}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          padding: "2px 6px",
          borderRadius: 999,
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          background: "oklch(0.10 0.03 280 / 35%)",
          border: "1px solid color-mix(in oklch, var(--gold) 12%, transparent)",
          boxShadow: "0 2px 16px oklch(0 0 0 / 0.25)",
          opacity: open ? (phase === "open-bright" ? "var(--ro-plus-40)" : "var(--ro-plus-10)") : 0,
          transform: open ? "translateY(0)" : "translateY(-12px)",
          pointerEvents: open ? "auto" : "none",
          transition: open
            ? "opacity 500ms ease, transform 500ms cubic-bezier(0.22, 1, 0.36, 1)"
            : "opacity 600ms ease, transform 600ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        <MenuButton
          onClick={(e) => {
            if (helpHandler) {
              helpHandler();
            } else {
              void navigate({ to: "/help" });
            }
            showLabel("Help", e);
            resetTimer();
          }}
          ariaLabel="Help"
        >
          <HelpCircle size={17} strokeWidth={1.5} />
        </MenuButton>

        {copyText && (
          <MenuButton
            onClick={(e) => {
              handleCopy();
              showLabel("Copied", e);
            }}
            ariaLabel="Copy reading"
          >
            {copied ? (
              <CheckCheck size={17} strokeWidth={1.5} />
            ) : (
              <Clipboard size={17} strokeWidth={1.5} />
            )}
          </MenuButton>
        )}

        {showRefresh && (
          <MenuButton
            onClick={(e) => {
              handleRefresh();
              showLabel("Refreshing", e);
            }}
            ariaLabel="Refresh"
          >
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
          onClick={toggleMoonCarousel}
          ariaLabel={moonPrefs.moon_show_carousel ? "Hide moon carousel" : "Show moon carousel"}
        >
          <Moon
            size={17}
            strokeWidth={1.5}
            fill={moonPrefs.moon_show_carousel ? "currentColor" : "none"}
          />
        </MenuButton>

        {/* EK79 — Hide hover tips: same snooze the popover bell sets. */}
        <div style={{ position: "relative", display: "flex" }}>
          <MenuButton
            onClick={() => {
              resetTimer();
              setTipsMenuOpen((v) => !v);
            }}
            ariaLabel={tipsSnoozed ? "Hover tips hidden — change" : "Hide hover tips"}
          >
            <Bell size={17} strokeWidth={1.5} fill={tipsSnoozed ? "currentColor" : "none"} />
          </MenuButton>
          {tipsMenuOpen && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                right: 0,
                marginTop: 6,
                minWidth: 180,
                background: "var(--surface-elevated, var(--surface-card))",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-md, 8px)",
                boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
                padding: 4,
                display: "flex",
                flexDirection: "column",
                gap: 2,
                zIndex: 60,
              }}
            >
              {/* On/off switch — on = tips showing; flip off = hidden until
                  turned back on. A timed choice below flips it off for a while
                  and it returns by itself. */}
              <button
                type="button"
                onClick={() => {
                  resetTimer();
                  if (tipsSnoozed) clearSnooze();
                  else applySnooze("indefinite");
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "6px 8px",
                  border: "none",
                  borderRadius: "var(--radius-sm, 6px)",
                  background: "transparent",
                  cursor: "pointer",
                  color: "var(--color-foreground)",
                  fontFamily: "var(--font-serif)",
                  fontSize: 12,
                }}
                aria-label={tipsSnoozed ? "Turn hover tips on" : "Turn hover tips off"}
              >
                <span>Hover tips</span>
                <span
                  aria-hidden
                  style={{
                    width: 32,
                    height: 18,
                    borderRadius: 999,
                    background: !tipsSnoozed
                      ? "var(--accent, var(--gold))"
                      : "var(--border-strong, var(--border-default))",
                    position: "relative",
                    transition: "background 140ms ease-out",
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      top: 2,
                      left: !tipsSnoozed ? 16 : 2,
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      background: "var(--surface-card)",
                      transition: "left 140ms ease-out",
                    }}
                  />
                </span>
              </button>
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--color-foreground-muted, var(--color-foreground))",
                  padding: "6px 8px 2px",
                  borderTop: "1px solid var(--border-subtle)",
                  marginTop: 2,
                }}
              >
                Hide for
              </div>
              {SNOOZE_OPTIONS.map((opt) => (
                <button
                  key={String(opt.value)}
                  type="button"
                  onClick={() => {
                    resetTimer();
                    applySnooze(opt.value);
                    setTipsMenuOpen(false);
                  }}
                  style={tipsMenuItemStyle(false)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {occupied.length > 0 && (
          <MenuButton onClick={cycleSanctuary} ariaLabel="Cycle saved themes">
            <Wand2 size={17} strokeWidth={1.5} />
          </MenuButton>
        )}

        <button
          type="button"
          onClick={() => {
            resetTimer();
            void navigate({ to: "/settings/profile" });
          }}
          aria-label="Your profile"
          className="flex items-center justify-center rounded-full transition-opacity focus:outline-none"
          style={{
            width: 26,
            height: 26,
            marginLeft: 4,
            marginRight: 4,
            background: "color-mix(in oklab, var(--gold) 18%, transparent)",
            border: "1px solid color-mix(in oklab, var(--gold) 35%, transparent)",
            color: "var(--gold)",
            fontSize: "var(--text-caption)",
            fontFamily: "var(--font-serif)",
            fontWeight: 600,
            letterSpacing: "0.05em",
            cursor: "pointer",
          }}
        >
          {userInitial ? userInitial.toUpperCase() : <UserRound size={13} strokeWidth={1.5} />}
        </button>

        {isAdmin && (
          <MenuButton
            onClick={(e) => {
              const next = !devOn;
              setDevMode(next);
              setDevOn(next);
              showLabel(next ? "Dev on" : "Dev off", e);
              resetTimer();
            }}
            ariaLabel={devOn ? "Disable dev mode" : "Enable dev mode"}
          >
            <Bug size={17} strokeWidth={1.5} style={{ opacity: devOn ? 1 : 0.4 }} />
          </MenuButton>
        )}
      </div>

      {/* EK81 — always-visible ··· trigger. The pill above renders at
          opacity 0 until `open`, and nothing called openMenu() anymore, so
          the menu was unreachable. This dots button opens it; it hides while
          open (the pill takes over) and has its own pointerEvents so it stays
          tappable even though the container is pointer-none at rest. */}
      {!open && (
        <button
          type="button"
          onClick={openMenu}
          aria-label="Open menu"
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: 34,
            height: 34,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 999,
            border: "1px solid color-mix(in oklch, var(--gold) 12%, transparent)",
            background: "oklch(0.10 0.03 280 / 35%)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            boxShadow: "0 2px 16px oklch(0 0 0 / 0.25)",
            color: "var(--color-foreground)",
            cursor: "pointer",
            pointerEvents: "auto",
            opacity: "var(--ro-plus-20)",
          }}
        >
          <MoreHorizontal size={18} strokeWidth={1.5} />
        </button>
      )}

      {tapLabel && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            left: tapLabel.x,
            transform: "translateX(-50%)",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body-sm)",
            color: "var(--gold)",
            opacity: "var(--ro-plus-20)",
            whiteSpace: "nowrap",
            pointerEvents: "none",
            animation: "reading-fade-in 200ms ease both",
            letterSpacing: "0.04em",
          }}
        >
          {tapLabel.text}
        </div>
      )}
    </div>
  );
}

function MenuButton({
  onClick,
  ariaLabel,
  children,
}: {
  onClick: (e: React.MouseEvent) => void;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      onTouchEnd={(e) => {
        // Q30 Fix B6 — guarantee taps on touch devices reach the handler
        // even when an ancestor absorbs synthetic clicks.
        e.stopPropagation();
      }}
      style={{ touchAction: "manipulation" }}
      className="flex h-7 w-7 items-center justify-center rounded-full text-gold transition-colors hover:bg-gold/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
    >
      {children}
    </button>
  );
}
