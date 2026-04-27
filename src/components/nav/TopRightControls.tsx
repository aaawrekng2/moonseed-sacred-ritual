import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Eye, EyeOff, Wand2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  applyHeadingFont,
  applyHeadingFontSize,
  useSavedThemes,
  type SavedTheme,
} from "@/lib/use-saved-themes";
import { setStoredCardBack } from "@/lib/card-backs";
import { useRestingOpacity } from "@/lib/use-resting-opacity";
import { useUIDensity } from "@/lib/use-ui-density";
import { dispatchActiveThemeChanged } from "@/lib/theme-events";
import { setStoredCommunityTheme } from "@/lib/community-themes";
import { triggerPeek } from "@/lib/use-tap-to-peek";

/**
 * Apply every facet of a saved sanctuary to the live document so a
 * single tap on the wand restores the full atmosphere — gradient,
 * accent, font, size, card back, resting opacity.
 */
export function applySanctuary(
  theme: SavedTheme,
  setOpacity: (n: number) => void,
) {
  if (typeof document === "undefined") return;
  if (theme.bg_left && theme.bg_right) {
    document.documentElement.style.setProperty(
      "--bg-gradient-left",
      theme.bg_left,
    );
    document.documentElement.style.setProperty(
      "--bg-gradient-right",
      theme.bg_right,
    );
  }
  if (theme.accent) {
    document.documentElement.style.setProperty("--gold", theme.accent);
    document.documentElement.style.setProperty("--primary", theme.accent);
    document.documentElement.style.setProperty("--ring", `${theme.accent}99`);
  }
  if (theme.font) applyHeadingFont(theme.font);
  if (theme.font_size) applyHeadingFontSize(theme.font_size);
  if (theme.card_back) setStoredCardBack(theme.card_back);
  if (typeof theme.resting_opacity === "number") setOpacity(theme.resting_opacity);
}

/**
 * Top-bar pill button: shows just the icon at rest, expands horizontally
 * to icon + label when tapped, then contracts back to icon-only after
 * 1500ms. The expansion uses a smooth width transition so the label
 * appears to slide out of the icon. Used for both the Oracle/Plain
 * toggle and the Sanctuary cycler — anywhere we need a brief, in-place
 * confirmation of *what* the tap just did without a separate popover.
 */
export function ExpandingIconButton({
  icon,
  label,
  labelFont,
  labelStyle = "muted",
  onClick,
  ariaLabel,
  title,
}: {
  icon: ReactNode;
  label: string;
  /** CSS font-family for the label text. */
  labelFont?: string;
  /** Italic gold (Oracle voice) vs. muted plain. */
  labelStyle?: "italic-gold" | "muted";
  onClick: () => void;
  ariaLabel: string;
  title?: string;
}) {
  const [expanding, setExpanding] = useState(false);
  const collapseTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (collapseTimer.current) window.clearTimeout(collapseTimer.current);
    };
  }, []);

  const handleClick = () => {
    onClick();
    // Trigger global peek — brightens everything to 100% for 1500ms
    // then fades back to resting opacity via the same system as
    // tap-to-peek. No per-icon opacity management needed.
    triggerPeek(1500);
    if (collapseTimer.current) window.clearTimeout(collapseTimer.current);
    setExpanding(true);
    collapseTimer.current = window.setTimeout(() => setExpanding(false), 1500);
  };

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={title}
      onClick={handleClick}
      className="relative flex h-11 min-w-[44px] items-center justify-center overflow-hidden rounded-full text-gold focus:outline-none"
      style={{
        // Opacity is NOT set here — it is controlled globally by
        // --resting-opacity via peekRestingOpacity(). The entire
        // top bar inherits from the document root CSS variable.
        width: expanding ? "auto" : "44px",
        minWidth: "44px",
        paddingLeft: expanding ? "0.5rem" : "0",
        paddingRight: expanding ? "0.5rem" : "0",
        background: expanding
          ? "color-mix(in oklch, var(--gold) 12%, transparent)"
          : "transparent",
        border: expanding
          ? "1px solid color-mix(in oklch, var(--gold) 30%, transparent)"
          : "1px solid transparent",
        transition:
          "width 300ms cubic-bezier(0.22, 1, 0.36, 1), padding 300ms cubic-bezier(0.22, 1, 0.36, 1), background 200ms ease, border-color 200ms ease",
      }}
    >
      {icon}
      <span
        aria-hidden
        className="overflow-hidden whitespace-nowrap text-xs"
        style={{
          maxWidth: expanding ? "160px" : "0px",
          opacity: expanding ? 1 : 0,
          marginLeft: expanding ? "0.35rem" : "0",
          fontFamily: labelFont,
          fontStyle: labelStyle === "italic-gold" ? "italic" : "normal",
          color:
            labelStyle === "italic-gold"
              ? "var(--gold)"
              : "color-mix(in oklch, var(--gold) 70%, transparent)",
          transition:
            "max-width 300ms cubic-bezier(0.22, 1, 0.36, 1), opacity 150ms ease, margin-left 300ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        {label}
      </span>
    </button>
  );
}

interface Props {
  initial?: string;
  /**
   * Optional extra control rendered as the LEFTMOST item in the cluster
   * — before the ScrollText (Oracle/Plain) icon. Used by the reading
   * surface to inject the Copy-to-clipboard icon.
   */
  extraFirst?: ReactNode;
  /**
   * Optional extra controls — rendered to the LEFT of the X button and
   * RIGHT of the user-initial chip. Used by the draw screen to inject the
   * Clarity (eye) toggle into the same horizontal row.
   */
  extraStart?: ReactNode;
  /**
   * Optional close affordance. When provided, rendered as the rightmost
   * icon (always at far right) with 44px tap target.
   */
  onClose?: () => void;
  /** Aria-label for the close button. */
  closeLabel?: string;
  /**
   * Render the built-in Clarity (Eye / EyeOff) toggle inside the cluster.
   * Defaults to TRUE on every screen so the home, settings, and reading
   * screens get the icon for free. Tabletop opts out (passes `false`)
   * because it injects its own 3-level density cycler via `extraStart`
   * — keeping both would duplicate the eye icon in the cluster.
   */
  includeClarity?: boolean;
}

export function TopRightControls({
  initial,
  extraFirst,
  extraStart,
  onClose,
  closeLabel = "Close",
  includeClarity = true,
}: Props) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { occupied, activeSlot, setActiveSlot } = useSavedThemes();
  const { setOpacity } = useRestingOpacity();
  // The Clarity — 3-level density cycler (Seen → Glimpse → Veiled).
  // Persisted to localStorage + user_preferences.ui_density so the
  // choice carries across devices. Other surfaces (e.g. spread labels)
  // continue to read useShowLabels for now; mapping that boolean from
  // this 3-level value is a separate follow-up.
  const { level, cycleLevel } = useUIDensity();
  const isVeiled = level === 3;
  const clarityLabel =
    level === 1 ? "Seen" : level === 2 ? "Glimpse" : "Veiled";
  // After cycling the wand we briefly show the just-loaded sanctuary
  // name inside the wand pill so the user knows which atmosphere is now
  // active. Tracked here (rather than inside ExpandingIconButton) so the
  // label reflects the freshly-loaded sanctuary, not the previous one.
  const [wandLabel, setWandLabel] = useState<string | null>(null);

  const derivedInitial =
    initial ??
    (() => {
      const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
      const name =
        (typeof meta.display_name === "string" && meta.display_name) ||
        (typeof meta.full_name === "string" && meta.full_name) ||
        (typeof meta.name === "string" && meta.name) ||
        user?.email ||
        "M";
      return name.trim().charAt(0) || "M";
    })();

  // Wand cycles occupied saved-theme slots only. If none are saved we
  // hide the wand entirely.
  const cycleSanctuary = () => {
    if (occupied.length === 0) return;
    const currentIdx = occupied.findIndex((t) => t.slot === activeSlot);
    const nextIdx =
      currentIdx === -1 ? 0 : (currentIdx + 1) % occupied.length;
    const next = occupied[nextIdx];
    if (!next) return;
    applySanctuary(next, setOpacity);
    void setActiveSlot(next.slot);
    // Loading a sanctuary supersedes any community palette selection.
    setStoredCommunityTheme(null);
    dispatchActiveThemeChanged({
      source: "sanctuary",
      name: next.name,
      accent: next.accent,
      sanctuarySlot: next.slot,
      communityKey: null,
    });
    // Surface the loaded name briefly inside the wand pill.
    setWandLabel(next.name);
  };

  const currentLabel =
    occupied.find((t) => t.slot === activeSlot)?.name ??
    occupied[0]?.name ??
    "Sanctuary";

  return (
    <div
      className="fixed z-50 flex items-center"
      style={{
        top: "calc(env(safe-area-inset-top, 0px) + 6px)",
        right: "calc(env(safe-area-inset-right, 0px) + 12px)",
        gap: "2px",
        opacity: "var(--ro-plus-0)",
        transition: "opacity 600ms ease",
      }}
    >
      {extraFirst}
      {occupied.length > 0 && (
        <ExpandingIconButton
          icon={<Wand2 size={18} strokeWidth={1.5} />}
          label={wandLabel ?? currentLabel}
          labelFont="var(--font-serif)"
          labelStyle="italic-gold"
          onClick={cycleSanctuary}
          ariaLabel={`Cycle saved sanctuaries (current: ${currentLabel})`}
          title={`Sanctuary: ${currentLabel}`}
        />
      )}

      {extraStart}

      {includeClarity && (
        <ExpandingIconButton
          icon={
            isVeiled ? (
              <EyeOff size={18} strokeWidth={1.5} />
            ) : (
              <Eye size={18} strokeWidth={1.5} />
            )
          }
          label={clarityLabel}
          labelFont="var(--font-sans)"
          labelStyle="muted"
          onClick={cycleLevel}
          ariaLabel={`The Clarity: ${clarityLabel} — tap to cycle (Seen → Glimpse → Veiled)`}
          title={`The Clarity: ${clarityLabel}`}
        />
      )}

      <button
        type="button"
        aria-label="Open settings"
        onClick={() => navigate({ to: "/settings" })}
        className="flex h-11 w-11 items-center justify-center rounded-full font-display text-[13px] leading-none text-gold transition-opacity hover:opacity-100 focus:outline-none"
        css-hint="gold-circle"
      >
        <span
          className="flex h-7 w-7 items-center justify-center rounded-full"
          style={{
            background: "color-mix(in oklch, var(--gold) 15%, transparent)",
            border:
              "1px solid color-mix(in oklch, var(--gold) 40%, transparent)",
          }}
        >
          {derivedInitial.slice(0, 1).toUpperCase()}
        </span>
      </button>

      {onClose && (
        <button
          type="button"
          aria-label={closeLabel}
          onClick={onClose}
          className="flex h-11 w-11 items-center justify-center rounded-full text-gold transition-opacity touch-manipulation [-webkit-tap-highlight-color:transparent] hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}