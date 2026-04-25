import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ScrollText, Wand2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useOracleMode } from "@/lib/use-oracle-mode";
import {
  applyHeadingFont,
  applyHeadingFontSize,
  useSavedThemes,
  type SavedTheme,
} from "@/lib/use-saved-themes";
import { setStoredCardBack } from "@/lib/card-backs";
import { useRestingOpacity } from "@/lib/use-resting-opacity";

/**
 * Apply every facet of a saved sanctuary to the live document so a
 * single tap on the wand restores the full atmosphere — gradient,
 * accent, font, size, card back, resting opacity.
 */
function applySanctuary(
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

interface Props {
  initial?: string;
}

export function TopRightControls({ initial }: Props) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isOracle, toggle: toggleOracle } = useOracleMode();
  const { occupied, activeSlot, setActiveSlot } = useSavedThemes();
  const { setOpacity } = useRestingOpacity();
  const [oraclePopup, setOraclePopup] = useState<"in" | "out" | null>(null);
  const popupTimers = useRef<{ out?: number; clear?: number }>({});

  useEffect(() => {
    return () => {
      if (popupTimers.current.out) window.clearTimeout(popupTimers.current.out);
      if (popupTimers.current.clear)
        window.clearTimeout(popupTimers.current.clear);
    };
  }, []);

  const showOraclePopup = () => {
    if (popupTimers.current.out) window.clearTimeout(popupTimers.current.out);
    if (popupTimers.current.clear)
      window.clearTimeout(popupTimers.current.clear);
    setOraclePopup("in");
    popupTimers.current.out = window.setTimeout(
      () => setOraclePopup("out"),
      1500,
    );
    popupTimers.current.clear = window.setTimeout(
      () => setOraclePopup(null),
      1500 + 300,
    );
  };

  const handleOracleClick = () => {
    toggleOracle();
    // Show the popup with the *new* mode label.
    showOraclePopup();
  };

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
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("moonseed:sanctuary-changed"));
      window.dispatchEvent(new CustomEvent("moonseed:theme-changed"));
    }
  };

  const currentLabel =
    occupied.find((t) => t.slot === activeSlot)?.name ??
    occupied[0]?.name ??
    "Sanctuary";

  return (
    <div
      className="fixed right-4 z-50 flex items-center gap-2"
      style={{ top: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
    >
      <button
        type="button"
        aria-label={`Toggle Oracle voice (currently ${isOracle ? "Oracle" : "Plain"})`}
        title={isOracle ? "Oracle voice on" : "Plain voice"}
        onClick={handleOracleClick}
        style={{ opacity: isOracle ? 1 : "var(--ro-plus-0)" }}
        className="relative flex h-7 w-7 items-center justify-center text-gold transition-opacity hover:!opacity-100 focus:!opacity-100 focus:outline-none"
      >
        <ScrollText size={18} strokeWidth={1.5} />
        {oraclePopup && (
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap text-xs",
              // Note: `isOracle` is the *new* mode after toggle.
              isOracle
                ? "italic text-gold"
                : "text-muted-foreground",
              oraclePopup === "in"
                ? "animate-in fade-in duration-150"
                : "animate-out fade-out duration-300",
            )}
            style={{
              fontFamily: isOracle
                ? "var(--font-serif)"
                : "var(--font-sans)",
            }}
          >
            {isOracle ? "Oracle" : "Plain"}
          </span>
        )}
      </button>

      {occupied.length > 0 && (
        <button
          type="button"
          aria-label={`Cycle saved sanctuaries (current: ${currentLabel})`}
          title={`Sanctuary: ${currentLabel}`}
          onClick={cycleSanctuary}
          style={{ opacity: "var(--ro-plus-0)" }}
          className="flex h-7 w-7 items-center justify-center text-gold transition-opacity hover:!opacity-100 focus:!opacity-100 focus:outline-none"
        >
          <Wand2 size={18} strokeWidth={1.5} />
        </button>
      )}

      <button
        type="button"
        aria-label="Open settings"
        onClick={() => navigate({ to: "/settings" })}
        style={{ opacity: "var(--ro-plus-0)" }}
        className="flex h-7 w-7 items-center justify-center rounded-full font-display text-[13px] leading-none text-gold transition-opacity hover:!opacity-100 focus:!opacity-100 focus:outline-none"
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
    </div>
  );
}