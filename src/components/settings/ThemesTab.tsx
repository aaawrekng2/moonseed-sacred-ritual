/**
 * Settings → Themes tab (Moonseed personal-only port).
 *
 * Sections (top → bottom):
 *   1. Reset to defaults (header right action)
 *   2. Card Back (Celestial / Void / Ember / Ocean / Verdant)
 *   3. Accent Color (5 preset gold/emerald/rose/blue/violet)
 *   4. Custom Accent (react-colorful hex picker)
 *   5. Background Gradient (6 presets + 2 custom hex pickers)
 *   6. Heading Font (5 fonts + size 16-32px slider with live preview)
 *   7. Interface Fade (resting opacity slider)
 *   8. Saved Themes (5 slots, name + load + delete)
 *
 * All state writes go through Supabase via SettingsContext +
 * updateUserPreferences. The existing localStorage hooks
 * (useBgGradient, useRestingOpacity, getStoredCardBack) drive the live
 * DOM, and `usePreferencesSync` mirrors them to the Supabase row.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { HexColorPicker } from "react-colorful";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CardBack } from "@/components/cards/CardBack";
import {
  CARD_BACKS,
  DEFAULT_CARD_BACK,
  getStoredCardBack,
  setStoredCardBack,
  type CardBackId,
} from "@/lib/card-backs";
import {
  DEFAULT_BG_LEFT,
  DEFAULT_BG_RIGHT,
} from "@/lib/use-bg-gradient";
import {
  DEFAULT_RESTING_OPACITY,
  MAX_RESTING_OPACITY,
  MIN_RESTING_OPACITY,
  useRestingOpacity,
} from "@/lib/use-resting-opacity";
import {
  applyHeadingFont,
  applyHeadingFontSize,
  DEFAULT_FONT_SIZE,
  DEFAULT_THEME_FONT,
  ensureFontLoaded,
  MAX_FONT_SIZE,
  MAX_SAVED_THEMES,
  MIN_FONT_SIZE,
  THEME_FONTS,
  useSavedThemes,
  type SavedTheme,
  type ThemeFont,
} from "@/lib/use-saved-themes";
import {
  COMMUNITY_THEMES,
  getStoredCommunityTheme,
  setStoredCommunityTheme,
} from "@/lib/community-themes";
import { updateUserPreferences } from "@/lib/user-preferences-write";
import {
  ThemeDirtyProvider,
  useThemeDirty,
} from "@/components/settings/ThemeDirtyContext";
import { SettingsSection } from "@/components/settings/sections";
import { useSettings } from "@/components/settings/SettingsContext";
import { useOracleMode } from "@/lib/use-oracle-mode";
import {
  dispatchActiveThemeChanged,
  subscribeActiveThemeChanged,
  type ActiveThemeDetail,
} from "@/lib/theme-events";
import { useBlocker } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

const ACCENT_PRESETS: ReadonlyArray<{
  value: string;
  label: string;
  swatch: string;
}> = [
  { value: "default", label: "Mystic Gold", swatch: "oklch(0.82 0.14 82)" },
  {
    value: "emerald-isle",
    label: "Emerald",
    swatch: "oklch(0.74 0.17 158)",
  },
  { value: "rose-quartz", label: "Rose", swatch: "oklch(0.70 0.20 15)" },
  {
    value: "celestial-blue",
    label: "Blue",
    swatch: "oklch(0.66 0.18 250)",
  },
  {
    value: "violet-flame",
    label: "Violet",
    swatch: "oklch(0.66 0.20 295)",
  },
];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const isHex = (v: string) => HEX_RE.test(v);

/** Read the currently applied accent (data-theme attr, falls back to default). */
function getAccentTheme(): string {
  if (typeof document === "undefined") return "default";
  return document.documentElement.getAttribute("data-theme") || "default";
}

function applyAccentTheme(value: string) {
  if (typeof document === "undefined") return;
  if (value === "default") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", value);
  }
}

/* ------------------------------------------------------------------ */
/*  Top-level                                                          */
/* ------------------------------------------------------------------ */

export function ThemesTab() {
  return (
    <ThemeDirtyProvider>
      <ThemesTabInner />
    </ThemeDirtyProvider>
  );
}

/**
 * Inner shell that runs INSIDE the ThemeDirtyProvider so it can capture
 * the baseline snapshot on mount and mount the unsaved-changes guard.
 */
function ThemesTabInner() {
  return (
    <>
      <BaselineCapture />
      <OracleDirtyWatcher />
      <UnsavedChangesGuard />
      <div className="space-y-10">
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <h2
              className="text-2xl font-semibold tracking-tight italic text-gold"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              The Atmosphere
            </h2>
            <p className="text-sm text-muted-foreground">
              Shape the space where your readings live.
            </p>
            <CurrentThemeBadge />
          </div>
          <ResetToDefaultsButton />
        </header>

        <LiveThemePreview />
        <TheFieldSection />
        <CardBackSection />
        <HeadingFontSection />
        <InterfaceFadeSection />
        <CommunityThemesSection />
        <SavedThemesSection />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Current Theme Badge                                                */
/* ------------------------------------------------------------------ */

/**
 * Displays an "always-current" pill below the Themes tab title showing
 * the active theme's name and accent color. Updates instantly when the
 * user loads a sanctuary, applies a Celestial Palette, or changes the
 * accent preset — driven by the `moonseed:theme-changed` and
 * `moonseed:sanctuary-changed` custom events plus reactive state from
 * `useSavedThemes`/`useSettings`.
 */
function CurrentThemeBadge() {
  const { isOracle } = useOracleMode();
  const { prefs } = useSettings();
  const { occupied, activeSlot } = useSavedThemes();
  const [communityKey, setCommunityKey] = useState<string | null>(null);
  // Last payload we received from the shared event bus. When present we
  // trust its `name`/`accent` directly so the badge reflects the change
  // in the same tick the dispatcher fired — no re-fetch, no race with
  // useSavedThemes' refetch.
  const [payload, setPayload] = useState<ActiveThemeDetail | null>(null);
  const [, bump] = useState(0);

  useEffect(() => {
    setCommunityKey(getStoredCommunityTheme());
    return subscribeActiveThemeChanged((detail) => {
      setCommunityKey(getStoredCommunityTheme());
      setPayload(detail);
      bump((n) => n + 1);
    });
  }, []);

  if (payload && payload.source !== "cleared") {
    return (
      <BadgeShell isOracle={isOracle} dot={payload.accent} name={payload.name} />
    );
  }

  // Resolution order: active sanctuary → active community palette →
  // accent preset label → custom hex → "Custom".
  const sanctuary = occupied.find((t) => t.slot === activeSlot) ?? null;
  const community = communityKey
    ? COMMUNITY_THEMES.find((t) => t.key === communityKey) ?? null
    : null;
  const accentPreset = ACCENT_PRESETS.find(
    (p) => p.value === getAccentTheme(),
  );

  let name: string;
  let dot: string;
  if (sanctuary) {
    name = sanctuary.name;
    dot = sanctuary.accent;
  } else if (community) {
    name = community.name;
    dot = community.accent;
  } else if (accentPreset) {
    name = accentPreset.label;
    dot = prefs.accent_color ?? accentPreset.swatch;
  } else {
    name = "Custom";
    dot = prefs.accent_color ?? "var(--gold)";
  }

  return <BadgeShell isOracle={isOracle} dot={dot} name={name} />;
}

function BadgeShell({
  isOracle,
  dot,
  name,
}: {
  isOracle: boolean;
  dot: string;
  name: string;
}) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-3 py-1 text-xs">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {isOracle ? "Current atmosphere" : "Current theme"}
      </span>
      <span
        aria-hidden
        className="h-3 w-3 rounded-full ring-1 ring-border/60"
        style={{ backgroundColor: dot }}
      />
      <span
        className="font-medium italic text-foreground"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        {name}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Baseline capture                                                   */
/* ------------------------------------------------------------------ */

/**
 * On first mount of the Themes tab, snapshot the currently-applied
 * theme into the dirty-context baseline. The "Keep exploring" → discard
 * action reverts every knob to this snapshot.
 *
 * After the baseline is captured we also call `markClean()` so a fresh
 * mount never trips the unsaved-changes prompt.
 */
function BaselineCapture() {
  const { prefs, loaded } = useSettings();
  const { isOracle } = useOracleMode();
  const { setBaseline, markClean } = useThemeDirty();
  const captured = useRef(false);

  useEffect(() => {
    if (captured.current) return;
    if (!loaded) return;
    captured.current = true;
    setBaseline({
      accent: getAccentTheme(),
      accent_color: prefs.accent_color ?? null,
      bg_left: prefs.bg_gradient_from ?? DEFAULT_BG_LEFT,
      bg_right: prefs.bg_gradient_to ?? DEFAULT_BG_RIGHT,
      font: (prefs.heading_font as ThemeFont) ?? DEFAULT_THEME_FONT,
      font_size: prefs.heading_font_size ?? DEFAULT_FONT_SIZE,
      card_back: getStoredCardBack(),
      resting_opacity: prefs.resting_opacity ?? DEFAULT_RESTING_OPACITY,
      oracle_mode: isOracle,
    });
    markClean();
  }, [loaded, prefs, isOracle, setBaseline, markClean]);

  return null;
}

/* ------------------------------------------------------------------ */
/*  Reset                                                              */
/* ------------------------------------------------------------------ */

function ResetToDefaultsButton() {
  const { user } = useSettings();
  const { setOpacity } = useRestingOpacity();
  const { markClean, setBaseline } = useThemeDirty();
  const { isOracle } = useOracleMode();
  const [open, setOpen] = useState(false);

  const reset = async () => {
    setStoredCardBack(DEFAULT_CARD_BACK);
    applyAccentTheme("default");
    if (typeof document !== "undefined") {
      document.documentElement.style.setProperty(
        "--bg-gradient-left",
        DEFAULT_BG_LEFT,
      );
      document.documentElement.style.setProperty(
        "--bg-gradient-right",
        DEFAULT_BG_RIGHT,
      );
    }
    setOpacity(DEFAULT_RESTING_OPACITY);
    applyHeadingFont(DEFAULT_THEME_FONT);
    applyHeadingFontSize(DEFAULT_FONT_SIZE);
    await updateUserPreferences(user.id, {
      card_back: DEFAULT_CARD_BACK,
      accent: "default",
      bg_gradient_from: null,
      bg_gradient_to: null,
      heading_font: DEFAULT_THEME_FONT,
      heading_font_size: DEFAULT_FONT_SIZE,
      resting_opacity: DEFAULT_RESTING_OPACITY,
      active_theme_slot: null,
    });
    setBaseline({
      accent: "default",
      accent_color: null,
      bg_left: DEFAULT_BG_LEFT,
      bg_right: DEFAULT_BG_RIGHT,
      font: DEFAULT_THEME_FONT,
      font_size: DEFAULT_FONT_SIZE,
      card_back: DEFAULT_CARD_BACK,
      resting_opacity: DEFAULT_RESTING_OPACITY,
      oracle_mode: isOracle,
    });
    markClean();
    setOpen(false);
    toast.success("Reset to default Moonseed");
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-2 text-muted-foreground hover:text-foreground"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        Return to silence
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear the altar?</AlertDialogTitle>
            <AlertDialogDescription>
              The veil, the thread, the horizon, the voice, and the veil
              opacity all return to silence. Your sanctuaries are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={reset}>Return to silence</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Card Back                                                          */
/* ------------------------------------------------------------------ */

function CardBackSection() {
  const { user } = useSettings();
  const { markDirty } = useThemeDirty();
  const [cardBack, setCardBack] = useState<CardBackId>(DEFAULT_CARD_BACK);

  useEffect(() => {
    setCardBack(getStoredCardBack());
  }, []);

  const choose = async (id: CardBackId) => {
    setCardBack(id);
    setStoredCardBack(id);
    markDirty();
    await updateUserPreferences(user.id, { card_back: id });
  };

  return (
    <SettingsSection
      title="The Veil"
      description="What the cards show before they speak."
    >
      <div className="grid grid-cols-5 gap-1.5 sm:gap-3">
        {CARD_BACKS.map((back) => {
          const active = cardBack === back.id;
          return (
            <button
              key={back.id}
              type="button"
              onClick={() => void choose(back.id)}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-2xl p-1.5 transition focus:outline-none sm:gap-2 sm:p-3",
              )}
              aria-pressed={active}
              aria-label={`Use ${back.label} card back`}
            >
              <CardBack id={back.id} width={40} />
              <span
                className={cn(
                  "text-[10px] sm:text-xs pb-0.5 border-b-2 transition-colors",
                  active
                    ? "border-gold text-gold"
                    : "border-transparent text-muted-foreground-strong",
                )}
              >
                {back.label}
              </span>
            </button>
          );
        })}
      </div>
    </SettingsSection>
  );
}


/* ------------------------------------------------------------------ */
/*  The Field — unified accent + horizon                                */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Live Theme Preview — small phone-shaped mock                        */
/* ------------------------------------------------------------------ */

/**
 * Tiny phone-shaped preview that mirrors the current theme state in
 * real time: the live --bg-gradient-left/right stops as the background,
 * the active card back centered like the home gateway card, and the
 * accent color glowing softly behind it. Updates instantly on every
 * picker change since it reads `prefs` straight from SettingsContext
 * and the live `--gold` CSS var.
 */
function LiveThemePreview() {
  const { prefs } = useSettings();
  const { isOracle } = useOracleMode();
  const [cardBack, setCardBack] = useState<CardBackId>(DEFAULT_CARD_BACK);

  // Keep the preview's card back in sync with the chosen one. The Card
  // Back picker calls setStoredCardBack() which writes localStorage; we
  // listen for the storage event (covers other tabs) and also subscribe
  // to the global theme-changed bus (covers same-tab updates).
  useEffect(() => {
    setCardBack(getStoredCardBack());
    if (typeof window === "undefined") return;
    const sync = () => setCardBack(getStoredCardBack());
    window.addEventListener("storage", sync);
    const unsub = subscribeActiveThemeChanged(sync);
    return () => {
      window.removeEventListener("storage", sync);
      unsub();
    };
  }, []);

  const left = prefs.bg_gradient_from ?? DEFAULT_BG_LEFT;
  const right = prefs.bg_gradient_to ?? DEFAULT_BG_RIGHT;
  const accent = prefs.accent_color ?? "var(--gold)";

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        aria-hidden
        className="relative overflow-hidden"
        style={{
          width: 160,
          height: 280,
          borderRadius: 24,
          border: "1px solid oklch(0.82 0.14 82 / 0.20)",
          background: `linear-gradient(135deg, ${left}, ${right})`,
          boxShadow:
            "0 12px 32px -16px rgba(0,0,0,0.55), inset 0 0 24px rgba(0,0,0,0.25)",
        }}
      >
        {/* Soft accent glow behind the card */}
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            width: 120,
            height: 120,
            transform: "translate(-50%, -50%)",
            borderRadius: "50%",
            background: `radial-gradient(circle, ${accent}44 0%, transparent 70%)`,
            filter: "blur(8px)",
          }}
        />
        {/* Centered card back, gateway-style */}
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
          }}
        >
          <CardBack id={cardBack} width={70} />
        </div>
      </div>
      <p
        className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground italic"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        {isOracle ? "A Glimpse" : "Live Preview"}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  The Field section body                                              */
/* ------------------------------------------------------------------ */

/**
 * Single section that combines what used to be "Your Signature" and
 * "The Horizon". Three swatches in a row drive (1) the accent color
 * (Your Signature), (2) the gradient left/past, and (3) the gradient
 * right/future. A preview bar below shows the live gradient. Tapping
 * a swatch opens an inline picker; only one is open at a time. No hex
 * codes are visible in resting state — the swatch IS the value.
 */
function TheFieldSection() {
  const { user, prefs, setPrefs } = useSettings();
  const { markDirty } = useThemeDirty();

  // Live values, falling back to defaults so the gradient bar always
  // renders with a sensible preview even before any user customization.
  const accentValue = prefs.accent_color ?? "#f59e0b";
  const leftValue = prefs.bg_gradient_from ?? DEFAULT_BG_LEFT;
  const rightValue = prefs.bg_gradient_to ?? DEFAULT_BG_RIGHT;

  const [openSwatch, setOpenSwatch] = useState<
    "signature" | "past" | "future" | null
  >(null);

  // Push the resolved accent into the live --gold/--primary tokens on
  // mount + whenever it changes, so other gold-themed UI picks it up
  // even before the user opens a picker.
  useEffect(() => {
    if (!prefs.accent_color || typeof document === "undefined") return;
    document.documentElement.style.setProperty("--gold", prefs.accent_color);
    document.documentElement.style.setProperty("--primary", prefs.accent_color);
    document.documentElement.style.setProperty(
      "--ring",
      `${prefs.accent_color}99`,
    );
    document.documentElement.style.setProperty(
      "--sidebar-primary",
      prefs.accent_color,
    );
  }, [prefs.accent_color]);

  // Apply the gradient stops live whenever they change in prefs.
  useEffect(() => {
    if (!prefs.bg_gradient_from || !prefs.bg_gradient_to) return;
    document.documentElement.style.setProperty(
      "--bg-gradient-left",
      prefs.bg_gradient_from,
    );
    document.documentElement.style.setProperty(
      "--bg-gradient-right",
      prefs.bg_gradient_to,
    );
  }, [prefs.bg_gradient_from, prefs.bg_gradient_to]);

  const applyAccent = async (hex: string) => {
    if (!isHex(hex)) return;
    const lower = hex.toLowerCase();
    document.documentElement.style.setProperty("--gold", lower);
    document.documentElement.style.setProperty("--primary", lower);
    document.documentElement.style.setProperty("--ring", `${lower}99`);
    document.documentElement.style.setProperty("--sidebar-primary", lower);
    markDirty();
    await updateUserPreferences(user.id, { accent_color: lower });
    setPrefs({ ...prefs, accent_color: lower });
    setOpenSwatch(null);
  };

  const applyGradient = async (left: string, right: string) => {
    if (!isHex(left) || !isHex(right)) return;
    document.documentElement.style.setProperty("--bg-gradient-left", left);
    document.documentElement.style.setProperty("--bg-gradient-right", right);
    markDirty();
    await updateUserPreferences(user.id, {
      bg_gradient_from: left.toLowerCase(),
      bg_gradient_to: right.toLowerCase(),
    });
    setPrefs({
      ...prefs,
      bg_gradient_from: left.toLowerCase(),
      bg_gradient_to: right.toLowerCase(),
    });
    setOpenSwatch(null);
  };

  return (
    <SettingsSection
      title="The Field"
      description="Cast your color into the space — and the horizon it lives within."
    >
      <div className="space-y-5">
        {/* Three swatches in a row */}
        <div className="grid grid-cols-3 gap-3">
          <FieldSwatch
            label="Your Signature"
            value={accentValue}
            isOpen={openSwatch === "signature"}
            onToggle={() =>
              setOpenSwatch(openSwatch === "signature" ? null : "signature")
            }
          />
          <FieldSwatch
            label="The Past"
            value={leftValue}
            isOpen={openSwatch === "past"}
            onToggle={() =>
              setOpenSwatch(openSwatch === "past" ? null : "past")
            }
          />
          <FieldSwatch
            label="The Future"
            value={rightValue}
            isOpen={openSwatch === "future"}
            onToggle={() =>
              setOpenSwatch(openSwatch === "future" ? null : "future")
            }
          />
        </div>

        {/* Live gradient preview bar */}
        <div
          aria-hidden
          className="h-12 w-full rounded-lg border border-gold/30"
          style={{
            background: `linear-gradient(to right, ${leftValue}, ${rightValue})`,
          }}
        />

        {/* Inline picker — only one open at a time. Hex codes hidden;
            the picker is fully visual. */}
        {openSwatch === "signature" && (
          <FieldPicker
            initial={accentValue}
            onApply={applyAccent}
            onCancel={() => setOpenSwatch(null)}
          />
        )}
        {openSwatch === "past" && (
          <FieldPicker
            initial={leftValue}
            onApply={(hex) => applyGradient(hex, rightValue)}
            onCancel={() => setOpenSwatch(null)}
            onReset={() => applyGradient(DEFAULT_BG_LEFT, rightValue)}
          />
        )}
        {openSwatch === "future" && (
          <FieldPicker
            initial={rightValue}
            onApply={(hex) => applyGradient(leftValue, hex)}
            onCancel={() => setOpenSwatch(null)}
            onReset={() => applyGradient(leftValue, DEFAULT_BG_RIGHT)}
          />
        )}
      </div>
    </SettingsSection>
  );
}

function FieldSwatch({
  label,
  value,
  isOpen,
  onToggle,
}: {
  label: string;
  value: string;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-label={`${label} — tap to change`}
        className={cn(
          "relative inline-flex aspect-square w-12 shrink-0 rounded-full transition-all",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ring-offset-2 ring-offset-background",
        )}
        style={{
          backgroundColor: value,
          border: isOpen
            ? "2px solid oklch(0.82 0.14 82 / 0.90)"
            : "2px solid oklch(0.82 0.14 82 / 0.40)",
          transition: "border-color 200ms ease",
        }}
        onMouseEnter={(e) => {
          if (!isOpen)
            e.currentTarget.style.borderColor =
              "oklch(0.82 0.14 82 / 0.80)";
        }}
        onMouseLeave={(e) => {
          if (!isOpen)
            e.currentTarget.style.borderColor =
              "oklch(0.82 0.14 82 / 0.40)";
        }}
      />
      <span
        className="text-center text-[11px] uppercase tracking-wider text-muted-foreground"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        {label}
      </span>
    </div>
  );
}

function FieldPicker({
  initial,
  onApply,
  onCancel,
  onReset,
}: {
  initial: string;
  onApply: (hex: string) => void | Promise<void>;
  onCancel: () => void;
  onReset?: () => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(initial);
  useEffect(() => setDraft(initial), [initial]);
  return (
    <div className="rounded-xl border border-border/60 bg-card/80 p-4 backdrop-blur-xl animate-in fade-in slide-in-from-top-1 duration-200">
      <div className="flex justify-center">
        <div className="custom-color-picker w-full max-w-[320px]">
          <HexColorPicker color={draft} onChange={setDraft} />
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Button
          onClick={() => void onApply(draft)}
          disabled={!isHex(draft)}
          className="bg-gold-gradient text-gold-foreground shadow-glow hover:opacity-95 flex-1"
        >
          Apply
        </Button>
        {onReset && (
          <Button
            variant="ghost"
            onClick={() => void onReset()}
            className="flex-1 text-muted-foreground"
          >
            Reset
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={onCancel}
          className="flex-1 text-muted-foreground"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Heading Font + Size                                                */
/* ------------------------------------------------------------------ */

function HeadingFontSection() {
  const { user, prefs, setPrefs } = useSettings();
  const { markDirty } = useThemeDirty();
  const [font, setFont] = useState<ThemeFont>(
    (prefs.heading_font as ThemeFont) ?? DEFAULT_THEME_FONT,
  );
  const [size, setSize] = useState<number>(
    prefs.heading_font_size ?? DEFAULT_FONT_SIZE,
  );

  useEffect(() => {
    THEME_FONTS.forEach((f) => ensureFontLoaded(f));
  }, []);

  useEffect(() => {
    applyHeadingFont(font);
    applyHeadingFontSize(size);
  }, [font, size]);

  const pickFont = async (next: ThemeFont) => {
    setFont(next);
    markDirty();
    await updateUserPreferences(user.id, { heading_font: next });
    setPrefs({ ...prefs, heading_font: next });
  };

  const commitSize = async (next: number) => {
    setSize(next);
    markDirty();
    await updateUserPreferences(user.id, { heading_font_size: next });
    setPrefs({ ...prefs, heading_font_size: next });
  };

  return (
    <SettingsSection
      title="The Voice"
      description="How the cards speak in text."
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-x-5 gap-y-2.5">
          {THEME_FONTS.map((f) => {
            const selected = f === font;
            return (
              <button
                key={f}
                type="button"
                onClick={() => void pickFont(f)}
                className={cn(
                  "px-1 py-1 text-sm transition border-b-2",
                  selected
                    ? "border-gold text-gold"
                    : "border-transparent text-muted-foreground hover:text-gold/80",
                )}
                style={{ fontFamily: `"${f}", ui-serif, Georgia, serif` }}
              >
                {f}
              </button>
            );
          })}
        </div>

        <div
          className="rounded-lg border px-4 py-3"
          style={{
            backgroundColor: "oklch(0.16 0.02 270)",
            borderColor: "color-mix(in oklab, var(--gold) 35%, transparent)",
          }}
        >
          <div
            style={{
              fontFamily: `"${font}", ui-serif, Georgia, serif`,
              fontSize: `${size}px`,
              lineHeight: 1.15,
              color: "color-mix(in oklab, var(--gold) 75%, white)",
            }}
          >
            Sample Heading
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            This is how your headings will appear
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              The Weight
            </Label>
            <span className="font-mono text-sm tabular-nums text-foreground">
              {size}px
            </span>
          </div>
          <Slider
            min={MIN_FONT_SIZE}
            max={MAX_FONT_SIZE}
            step={1}
            value={[size]}
            onValueChange={(v) => {
              const n = v[0];
              if (typeof n === "number") setSize(n);
            }}
            onValueCommit={(v) => {
              const n = v[0];
              if (typeof n === "number") void commitSize(n);
            }}
          />
        </div>
      </div>
    </SettingsSection>
  );
}

/* ------------------------------------------------------------------ */
/*  Interface Fade                                                     */
/* ------------------------------------------------------------------ */

function InterfaceFadeSection() {
  const { user, prefs, setPrefs } = useSettings();
  const { opacity, setOpacity } = useRestingOpacity();
  const { markDirty } = useThemeDirty();
  const [draft, setDraft] = useState(opacity);

  useEffect(() => {
    setDraft(opacity);
  }, [opacity]);

  const commit = async (next: number) => {
    setOpacity(next);
    markDirty();
    await updateUserPreferences(user.id, { resting_opacity: next });
    setPrefs({ ...prefs, resting_opacity: next });
  };

  return (
    <SettingsSection
      title="The Veil Opacity"
      description="How quietly the interface rests when not needed."
    >
      <div className="space-y-3">
        <FadePreviewBar opacity={draft} />
        <div className="flex items-center justify-between">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            At rest
          </Label>
          <span className="font-mono text-sm tabular-nums text-foreground">
            {draft}%
          </span>
        </div>
        <Slider
          min={MIN_RESTING_OPACITY}
          max={MAX_RESTING_OPACITY}
          step={1}
          value={[draft]}
          onValueChange={(v) => {
            const n = v[0];
            if (typeof n === "number") setDraft(n);
          }}
          onValueCommit={(v) => {
            const n = v[0];
            if (typeof n === "number") void commit(n);
          }}
        />
        <div className="flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground/70">
          <span>Whisper</span>
          <span>Speak</span>
        </div>
      </div>
    </SettingsSection>
  );
}

/**
 * Inline preview that mirrors the top-bar wand icon + user initial at the
 * current draft opacity, so the user can see exactly how the global
 * resting-opacity system will render the chrome before they commit. Reads
 * the user's display-name initial from the auth metadata, with safe
 * fallbacks identical to TopRightControls.
 */
function FadePreviewBar({ opacity }: { opacity: number }) {
  const { user } = useSettings();
  const meta = ((user as { user_metadata?: Record<string, unknown> })
    .user_metadata ?? {}) as Record<string, unknown>;
  const name =
    (typeof meta.display_name === "string" && meta.display_name) ||
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    (user as { email?: string }).email ||
    "M";
  const initial = (name as string).trim().charAt(0).toUpperCase() || "M";
  const alpha = Math.max(0.25, Math.min(1, opacity / 100));
  return (
    <div
      aria-hidden
      className="flex items-center justify-end gap-2 rounded-lg border border-border/50 bg-background/40 px-4 py-3"
    >
      <span
        className="flex h-7 w-7 items-center justify-center text-gold"
        style={{ opacity: alpha }}
      >
        <Wand2 size={18} strokeWidth={1.5} />
      </span>
      <span
        className="flex h-7 w-7 items-center justify-center rounded-full font-display text-[13px] leading-none text-gold"
        style={{ opacity: alpha }}
      >
        <span
          className="flex h-7 w-7 items-center justify-center rounded-full"
          style={{
            background: "color-mix(in oklch, var(--gold) 15%, transparent)",
            border:
              "1px solid color-mix(in oklch, var(--gold) 40%, transparent)",
          }}
        >
          {initial}
        </span>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared carousel chrome (hover arrows + dot pagination)             */
/* ------------------------------------------------------------------ */

const CARD_WIDTH = 220;
const CARD_GAP = 12;

/**
 * Wraps a horizontal snap-scroll row with hover-revealed left/right
 * arrow buttons, dot pagination beneath the row, and a "Swipe to
 * explore" hint. The caller passes children = the actual cards. The
 * hook owns the scroll math so both Celestial Palettes and Your
 * Sanctuaries behave identically.
 */
function ThemeCarousel({
  count,
  children,
  ariaLabel,
}: {
  count: number;
  children: React.ReactNode;
  ariaLabel: string;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const scrollByCard = useCallback((dir: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * (CARD_WIDTH + CARD_GAP), behavior: "smooth" });
  }, []);

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      const idx = Math.round(el.scrollLeft / (CARD_WIDTH + CARD_GAP));
      setActiveIndex(Math.min(count - 1, Math.max(0, idx)));
    },
    [count],
  );

  return (
    <>
      <div className="group/carousel relative -mx-2">
        <div
          ref={scrollerRef}
          onScroll={handleScroll}
          aria-label={ariaLabel}
          className="flex gap-3 overflow-x-auto px-2 pb-2 snap-x snap-mandatory scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {children}
        </div>
        <button
          type="button"
          aria-label="Scroll left"
          onClick={() => scrollByCard(-1)}
          className="absolute left-1 top-1/2 -translate-y-1/2 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-background/80 text-gold opacity-0 ring-1 ring-gold/40 backdrop-blur transition-opacity duration-200 hover:bg-background group-hover/carousel:opacity-100 focus-visible:opacity-100"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          type="button"
          aria-label="Scroll right"
          onClick={() => scrollByCard(1)}
          className="absolute right-1 top-1/2 -translate-y-1/2 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-background/80 text-gold opacity-0 ring-1 ring-gold/40 backdrop-blur transition-opacity duration-200 hover:bg-background group-hover/carousel:opacity-100 focus-visible:opacity-100"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
      <div className="mt-2 flex items-center justify-center gap-1.5">
        {Array.from({ length: count }).map((_, i) => (
          <span
            key={i}
            aria-hidden
            className={cn(
              "block h-1.5 rounded-full transition-all",
              i === activeIndex ? "w-4 bg-gold" : "w-1.5 bg-gold/30",
            )}
          />
        ))}
      </div>
      <p className="mt-1 text-center text-[10px] uppercase tracking-widest text-gold/70">
        Swipe to explore
      </p>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Celestial Palettes carousel (formerly Community Themes)            */
/* ------------------------------------------------------------------ */

/**
 * Curated, named gradient + accent presets. Tapping a card applies
 * everything instantly and persists the choice.
 *
 * - Gradient + accent are written into user_preferences so other
 *   devices pick up the look on next login.
 * - The active community key is cached in localStorage to highlight the
 *   selected card on reload (no DB column needed).
 */
function CommunityThemesSection() {
  const { user, prefs, setPrefs } = useSettings();
  const { markDirty } = useThemeDirty();
  const [activeKey, setActiveKey] = useState<string | null>(null);

  useEffect(() => {
    setActiveKey(getStoredCommunityTheme());
    return subscribeActiveThemeChanged((detail) => {
      // If a payload tells us the active source isn't `community`, drop
      // our highlight immediately rather than waiting on a re-read.
      if (detail && detail.source !== "community") {
        setActiveKey(null);
        return;
      }
      setActiveKey(getStoredCommunityTheme());
    });
  }, []);

  const apply = async (theme: (typeof COMMUNITY_THEMES)[number]) => {
    document.documentElement.style.setProperty(
      "--bg-gradient-left",
      theme.bgLeft,
    );
    document.documentElement.style.setProperty(
      "--bg-gradient-right",
      theme.bgRight,
    );
    document.documentElement.style.setProperty("--gold", theme.accent);
    document.documentElement.style.setProperty("--primary", theme.accent);
    document.documentElement.style.setProperty("--ring", `${theme.accent}99`);

    setStoredCommunityTheme(theme.key);
    setActiveKey(theme.key);
    markDirty();

    await updateUserPreferences(user.id, {
      bg_gradient_from: theme.bgLeft.toLowerCase(),
      bg_gradient_to: theme.bgRight.toLowerCase(),
      accent_color: theme.accent.toLowerCase(),
    });
    setPrefs({
      ...prefs,
      bg_gradient_from: theme.bgLeft.toLowerCase(),
      bg_gradient_to: theme.bgRight.toLowerCase(),
      accent_color: theme.accent.toLowerCase(),
    });
    dispatchActiveThemeChanged({
      source: "community",
      name: theme.name,
      accent: theme.accent,
      sanctuarySlot: null,
      communityKey: theme.key,
    });
    toast.success(`Applied ${theme.name}`);
  };

  return (
    <SettingsSection
      title="Celestial Palettes"
      description="Curated atmospheres — designed with intention, named for the cosmos."
    >
      <ThemeCarousel
        count={COMMUNITY_THEMES.length}
        ariaLabel="Celestial palettes"
      >
        {COMMUNITY_THEMES.map((theme) => {
          const active = activeKey === theme.key;
          return (
            <button
              key={theme.key}
              type="button"
              onClick={() => void apply(theme)}
              aria-pressed={active}
              aria-label={`Apply ${theme.name} theme`}
              className={cn(
                "group relative flex w-[220px] shrink-0 snap-start flex-col gap-2 rounded-2xl p-3 text-left transition",
                active
                  ? "border-2 border-gold shadow-glow"
                  : "border border-border/60 hover:border-gold/40",
              )}
            >
              {active && (
                <span
                  aria-hidden
                  className="absolute left-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-gold text-gold-foreground"
                >
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
              )}
              <span
                aria-hidden
                className="block h-20 w-full rounded-xl ring-1 ring-border/40"
                style={{
                  background: `linear-gradient(to right, ${theme.bgLeft}, ${theme.bgRight})`,
                }}
              />
              <div className="flex items-start gap-2">
                <span
                  aria-hidden
                  className="mt-0.5 inline-block h-3 w-3 shrink-0 rounded-full ring-1 ring-border/60"
                  style={{ backgroundColor: theme.accent }}
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "truncate italic text-sm",
                      active ? "text-gold" : "text-foreground",
                    )}
                    style={{ fontFamily: "var(--font-serif)" }}
                  >
                    {theme.name}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                    {theme.tagline}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </ThemeCarousel>
    </SettingsSection>
  );
}

/* ------------------------------------------------------------------ */
/*  Your Sanctuaries — 5-slot carousel (formerly Saved Themes)         */
/* ------------------------------------------------------------------ */

function SavedThemesSection() {
  const { prefs } = useSettings();
  const { isOracle } = useOracleMode();
  const {
    themes,
    activeSlot,
    loaded,
    saveSlot,
    deleteSlot,
    setActiveSlot,
  } = useSavedThemes();
  const { setOpacity } = useRestingOpacity();
  const { hasUnsavedChanges, markClean, setBaseline } = useThemeDirty();

  const [nameDialogSlot, setNameDialogSlot] = useState<number | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [overwriteSlot, setOverwriteSlot] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SavedTheme | null>(null);
  const [discardThenLoad, setDiscardThenLoad] = useState<SavedTheme | null>(
    null,
  );

  const slots = useMemo(() => {
    const bySlot = new Map(themes.map((t) => [t.slot, t]));
    return Array.from({ length: MAX_SAVED_THEMES }, (_, i) => {
      const n = i + 1;
      return { slot: n, theme: bySlot.get(n) ?? null };
    });
  }, [themes]);

  const captureCurrent = (
    overrideName?: string,
  ): Omit<SavedTheme, "slot"> => {
    return {
      name: (overrideName ?? "My Theme").trim().slice(0, 20) || "My Theme",
      bg_left: prefs.bg_gradient_from ?? DEFAULT_BG_LEFT,
      bg_right: prefs.bg_gradient_to ?? DEFAULT_BG_RIGHT,
      accent: prefs.accent_color ?? "#f59e0b",
      font: (prefs.heading_font as ThemeFont) ?? DEFAULT_THEME_FONT,
      font_size: prefs.heading_font_size ?? DEFAULT_FONT_SIZE,
      card_back: getStoredCardBack(),
      resting_opacity: prefs.resting_opacity ?? DEFAULT_RESTING_OPACITY,
    };
  };

  const dontAskKey = "moonseed:overwrite-confirm-skip";
  const skipOverwriteConfirm = () =>
    typeof window !== "undefined" &&
    window.localStorage.getItem(dontAskKey) === "1";

  const performSave = async (slot: number, name: string) => {
    const snap = captureCurrent(name);
    await saveSlot(slot, snap);
    setBaseline({
      accent: getAccentTheme(),
      accent_color: prefs.accent_color ?? null,
      bg_left: snap.bg_left,
      bg_right: snap.bg_right,
      font: snap.font ?? DEFAULT_THEME_FONT,
      font_size: snap.font_size ?? DEFAULT_FONT_SIZE,
      card_back: snap.card_back ?? DEFAULT_CARD_BACK,
      resting_opacity: snap.resting_opacity ?? DEFAULT_RESTING_OPACITY,
      oracle_mode: isOracle,
    });
    markClean();
    toast.success(`Saved to slot ${slot}`);
  };

  const handleSaveClick = (slot: number, existing: SavedTheme | null) => {
    if (!existing) {
      setNameDialogSlot(slot);
      setNameDraft("");
      return;
    }
    if (skipOverwriteConfirm()) {
      void performSave(slot, existing.name);
      return;
    }
    setOverwriteSlot(slot);
  };

  const handleLoad = async (theme: SavedTheme) => {
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
      document.documentElement.style.setProperty(
        "--ring",
        `${theme.accent}99`,
      );
    }
    if (theme.font) applyHeadingFont(theme.font);
    if (theme.font_size) applyHeadingFontSize(theme.font_size);
    if (theme.card_back) setStoredCardBack(theme.card_back);
    if (typeof theme.resting_opacity === "number")
      setOpacity(theme.resting_opacity);
    await setActiveSlot(theme.slot);
    setBaseline({
      accent: getAccentTheme(),
      accent_color: theme.accent ?? null,
      bg_left: theme.bg_left,
      bg_right: theme.bg_right,
      font: (theme.font as ThemeFont) ?? DEFAULT_THEME_FONT,
      font_size: theme.font_size ?? DEFAULT_FONT_SIZE,
      card_back: (theme.card_back as CardBackId) ?? DEFAULT_CARD_BACK,
      resting_opacity: theme.resting_opacity ?? DEFAULT_RESTING_OPACITY,
      oracle_mode: isOracle,
    });
    markClean();
    // Loading a sanctuary supersedes any community palette selection.
    setStoredCommunityTheme(null);
    dispatchActiveThemeChanged({
      source: "sanctuary",
      name: theme.name,
      accent: theme.accent,
      sanctuarySlot: theme.slot,
      communityKey: null,
    });
    toast.success(`Loaded "${theme.name}"`);
  };

  const requestLoad = (theme: SavedTheme) => {
    if (hasUnsavedChanges) {
      setDiscardThenLoad(theme);
      return;
    }
    void handleLoad(theme);
  };

  return (
    <SettingsSection
      title="Your Sanctuaries"
      description="Capture the atmosphere of a perfect reading. Return to it anytime."
    >
      <ThemeCarousel count={MAX_SAVED_THEMES} ariaLabel="Your sanctuaries">
        {slots.map(({ slot, theme }) => {
          const active = activeSlot === slot;
          return (
            <div
              key={slot}
              className={cn(
                "group relative flex w-[220px] shrink-0 snap-start flex-col gap-3 rounded-2xl p-3 transition",
                active
                  ? "border-2 border-gold shadow-glow"
                  : "border border-border/60 hover:border-gold/40",
              )}
            >
              {theme ? (
                <>
                  {active && (
                    <span
                      aria-hidden
                      className="absolute left-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-gold text-gold-foreground"
                    >
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(theme)}
                    aria-label={`Delete ${theme.name}`}
                    className="absolute right-2 top-2 z-10 rounded-full bg-background/70 p-1 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-destructive focus:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => requestLoad(theme)}
                    aria-label={`Load ${theme.name}`}
                    className="flex flex-1 flex-col gap-3 text-left focus:outline-none"
                  >
                    <span
                      aria-hidden
                      className="block h-20 w-full rounded-xl ring-1 ring-border/40"
                      style={{
                        background: `linear-gradient(to right, ${theme.bg_left}, ${theme.bg_right})`,
                      }}
                    />
                    <div className="flex items-start gap-2">
                      <span
                        aria-hidden
                        className="mt-0.5 inline-block h-3 w-3 shrink-0 rounded-full ring-1 ring-border/60"
                        style={{ backgroundColor: theme.accent }}
                      />
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            "truncate italic text-sm",
                            active ? "text-gold" : "text-foreground",
                          )}
                          style={{ fontFamily: "var(--font-serif)" }}
                        >
                          {theme.name}
                        </p>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Slot {slot}
                          {active && " · active"}
                        </p>
                      </div>
                    </div>
                  </button>
                  <div className="mt-auto grid grid-cols-2 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleSaveClick(slot, theme)}
                      className="gap-1"
                    >
                      <Save className="h-3.5 w-3.5" />
                      Overwrite
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDeleteTarget(theme)}
                      className="gap-1 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Erase
                    </Button>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => handleSaveClick(slot, null)}
                  aria-label={`Preserve current theme to slot ${slot}`}
                  className="flex h-full min-h-[180px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/60 text-muted-foreground transition hover:border-gold/50 hover:text-gold"
                >
                  <Plus className="h-6 w-6" />
                  <span className="text-xs">Preserve this moment</span>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                    Slot {slot}
                  </span>
                </button>
              )}
            </div>
          );
        })}
      </ThemeCarousel>

      {!loaded && (
        <p className="mt-3 text-center text-xs text-muted-foreground">
          <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
          Loading saved themes…
        </p>
      )}

      {/* Name dialog (new save) */}
      <AlertDialog
        open={nameDialogSlot != null}
        onOpenChange={(o) => !o && setNameDialogSlot(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Name this theme</AlertDialogTitle>
            <AlertDialogDescription>
              Give it a memorable name so you can find it later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            maxLength={20}
            placeholder="Midnight Garden"
            style={{ fontSize: 16 }}
          />
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setNameDraft("")}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (nameDialogSlot != null) {
                  void performSave(
                    nameDialogSlot,
                    nameDraft.trim() || "My Theme",
                  );
                  setNameDialogSlot(null);
                  setNameDraft("");
                }
              }}
            >
              <Save className="mr-1 h-4 w-4" />
              Save
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Overwrite confirm */}
      <AlertDialog
        open={overwriteSlot != null}
        onOpenChange={(o) => !o && setOverwriteSlot(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Overwrite this sanctuary{" "}
              {overwriteSlot != null
                ? `— ${slots.find((s) => s.slot === overwriteSlot)?.theme?.name}`
                : ""}
              ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This replaces the saved snapshot with the current look. The
              previous version cannot be recovered.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              onChange={(e) => {
                if (typeof window === "undefined") return;
                if (e.target.checked)
                  window.localStorage.setItem(dontAskKey, "1");
                else window.localStorage.removeItem(dontAskKey);
              }}
            />
            Don&apos;t ask again
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (overwriteSlot != null) {
                  const existing = slots.find(
                    (s) => s.slot === overwriteSlot,
                  )?.theme;
                  void performSave(
                    overwriteSlot,
                    existing?.name ?? "My Theme",
                  );
                  setOverwriteSlot(null);
                }
              }}
            >
              Overwrite this sanctuary
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Erase confirm */}
      <AlertDialog
        open={deleteTarget != null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Erase this sanctuary?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.name ? `"${deleteTarget.name}" ` : ""}
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) {
                  void deleteSlot(deleteTarget.slot);
                  toast.success(`Erased "${deleteTarget.name}"`);
                  setDeleteTarget(null);
                }
              }}
            >
              Erase
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Discard-then-load confirm */}
      <AlertDialog
        open={discardThenLoad != null}
        onOpenChange={(o) => !o && setDiscardThenLoad(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved theme changes. Loading{" "}
              {discardThenLoad?.name ?? "this theme"} will replace them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (discardThenLoad) {
                  void handleLoad(discardThenLoad);
                  setDiscardThenLoad(null);
                }
              }}
            >
              Discard &amp; load
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  );
}

/* ------------------------------------------------------------------ */
/*  Oracle-mode dirty watcher                                          */
/* ------------------------------------------------------------------ */

/**
 * The Oracle/Plain toggle lives in the global top bar. When the user
 * flips it while sitting in the Themes tab we still want the unsaved-
 * changes prompt to fire if they navigate away. This component watches
 * the oracle flag against the baseline and calls `markDirty()` when it
 * diverges.
 */
function OracleDirtyWatcher() {
  const { isOracle } = useOracleMode();
  const { baseline, markDirty } = useThemeDirty();
  useEffect(() => {
    if (!baseline) return;
    if (isOracle !== baseline.oracle_mode) markDirty();
  }, [isOracle, baseline, markDirty]);
  return null;
}

/* ------------------------------------------------------------------ */
/*  Unsaved-changes navigation guard                                   */
/* ------------------------------------------------------------------ */

/**
 * Intercepts navigation away from /settings/themes when there are
 * unsaved theme changes and shows a zen prompt with four options:
 *
 *   1. Save to current sanctuary  (when an active slot is loaded)
 *   2. Preserve as new sanctuary  (when at least one slot is empty)
 *   3. Replace a sanctuary        (when ALL slots are full — replaces #2)
 *   4. Keep exploring             (discard, revert to baseline)
 *
 * Uses TanStack Router's `useBlocker` with `withResolver: true` so we
 * can show the dialog and either `proceed()` or `reset()` the pending
 * navigation based on the user's choice.
 */
function UnsavedChangesGuard() {
  const { user, prefs, setPrefs } = useSettings();
  const { hasUnsavedChanges, markClean, baseline } = useThemeDirty();
  const { isOracle, setOracle } = useOracleMode();
  const { themes, activeSlot, saveSlot, setActiveSlot } = useSavedThemes();
  const { setOpacity } = useRestingOpacity();

  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) => {
      if (!hasUnsavedChanges) return false;
      // Don't block intra-tab navigation (no real change).
      if (current.pathname === next.pathname) return false;
      return true;
    },
    enableBeforeUnload: () => hasUnsavedChanges,
    withResolver: true,
  });

  const [nameMode, setNameMode] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  // Find the next empty slot (1..MAX_SAVED_THEMES) for "Save as new".
  const nextEmptySlot = useMemo(() => {
    const taken = new Set(themes.map((t) => t.slot));
    for (let s = 1; s <= MAX_SAVED_THEMES; s++) {
      if (!taken.has(s)) return s;
    }
    return null;
  }, [themes]);

  const allFull = nextEmptySlot == null;
  const activeTheme = useMemo(
    () => themes.find((t) => t.slot === activeSlot) ?? null,
    [themes, activeSlot],
  );

  const open = blocker.status === "blocked";
  const proceed = useCallback(() => {
    markClean();
    if (blocker.status === "blocked") blocker.proceed();
  }, [blocker, markClean]);
  const cancel = useCallback(() => {
    if (blocker.status === "blocked") blocker.reset();
    setNameMode(false);
    setNameDraft("");
  }, [blocker]);

  const captureCurrent = useCallback(
    (overrideName?: string): Omit<SavedTheme, "slot"> => ({
      name: (overrideName ?? "My Theme").trim().slice(0, 20) || "My Theme",
      bg_left: prefs.bg_gradient_from ?? DEFAULT_BG_LEFT,
      bg_right: prefs.bg_gradient_to ?? DEFAULT_BG_RIGHT,
      accent: prefs.accent_color ?? "#f59e0b",
      font: (prefs.heading_font as ThemeFont) ?? DEFAULT_THEME_FONT,
      font_size: prefs.heading_font_size ?? DEFAULT_FONT_SIZE,
      card_back: getStoredCardBack(),
      resting_opacity: prefs.resting_opacity ?? DEFAULT_RESTING_OPACITY,
    }),
    [prefs],
  );

  // Option 1: save to active sanctuary.
  const saveToActive = useCallback(async () => {
    if (!activeTheme) return;
    await saveSlot(activeTheme.slot, captureCurrent(activeTheme.name));
    toast.success(`Saved to ${activeTheme.name}`);
    proceed();
  }, [activeTheme, captureCurrent, saveSlot, proceed]);

  // Option 2: save as new sanctuary (after name input).
  const saveAsNew = useCallback(async () => {
    if (nextEmptySlot == null) return;
    const name = nameDraft.trim() || "My Theme";
    await saveSlot(nextEmptySlot, captureCurrent(name));
    await setActiveSlot(nextEmptySlot);
    toast.success(`Preserved as "${name}"`);
    setNameMode(false);
    setNameDraft("");
    proceed();
  }, [
    nextEmptySlot,
    nameDraft,
    captureCurrent,
    saveSlot,
    setActiveSlot,
    proceed,
  ]);

  // Option 3: replace a sanctuary — close the dialog, scroll to the
  // sanctuaries section so the user can pick which slot to overwrite.
  // Does NOT proceed with navigation.
  const replaceFlow = useCallback(() => {
    if (blocker.status === "blocked") blocker.reset();
    setNameMode(false);
    setNameDraft("");
    if (typeof document !== "undefined") {
      const el = document.querySelector(
        "[aria-label='Your sanctuaries']",
      ) as HTMLElement | null;
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [blocker]);

  // Option 4: keep exploring → discard all changes, revert to baseline.
  const discardAndProceed = useCallback(async () => {
    if (baseline) {
      // Restore card back, accent, gradient, font, font size, opacity.
      setStoredCardBack(baseline.card_back);
      applyAccentTheme(baseline.accent);
      if (typeof document !== "undefined") {
        document.documentElement.style.setProperty(
          "--bg-gradient-left",
          baseline.bg_left,
        );
        document.documentElement.style.setProperty(
          "--bg-gradient-right",
          baseline.bg_right,
        );
        if (baseline.accent_color) {
          document.documentElement.style.setProperty(
            "--gold",
            baseline.accent_color,
          );
          document.documentElement.style.setProperty(
            "--primary",
            baseline.accent_color,
          );
          document.documentElement.style.setProperty(
            "--ring",
            `${baseline.accent_color}99`,
          );
        } else {
          document.documentElement.style.removeProperty("--gold");
          document.documentElement.style.removeProperty("--primary");
          document.documentElement.style.removeProperty("--ring");
        }
      }
      applyHeadingFont(baseline.font);
      applyHeadingFontSize(baseline.font_size);
      setOpacity(baseline.resting_opacity);
      if (isOracle !== baseline.oracle_mode) setOracle(baseline.oracle_mode);
      // Persist the reverted state so future loads see the baseline.
      await updateUserPreferences(user.id, {
        card_back: baseline.card_back,
        accent: baseline.accent,
        accent_color: baseline.accent_color,
        bg_gradient_from: baseline.accent_color
          ? baseline.bg_left.toLowerCase()
          : null,
        bg_gradient_to: baseline.accent_color
          ? baseline.bg_right.toLowerCase()
          : null,
        heading_font: baseline.font,
        heading_font_size: baseline.font_size,
        resting_opacity: baseline.resting_opacity,
      });
      setPrefs({
        ...prefs,
        accent_color: baseline.accent_color,
        bg_gradient_from: baseline.accent_color
          ? baseline.bg_left.toLowerCase()
          : null,
        bg_gradient_to: baseline.accent_color
          ? baseline.bg_right.toLowerCase()
          : null,
        heading_font: baseline.font,
        heading_font_size: baseline.font_size,
        resting_opacity: baseline.resting_opacity,
      });
    }
    proceed();
  }, [baseline, isOracle, setOracle, setOpacity, proceed, user, prefs, setPrefs]);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) cancel();
      }}
    >
      <AlertDialogContent className="panel animate-in fade-in duration-200">
        <AlertDialogHeader>
          <AlertDialogTitle
            className="italic text-gold"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            {isOracle
              ? "Your atmosphere has shifted"
              : "You have unsaved changes"}
          </AlertDialogTitle>
          <AlertDialogDescription className="sr-only">
            Choose how to handle your unsaved theme changes before leaving.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {!nameMode ? (
          <div className="flex flex-col">
            {activeTheme && (
              <button
                type="button"
                onClick={() => void saveToActive()}
                className="flex w-full items-center justify-between gap-3 border-b border-border/40 px-1 py-3 text-left text-sm text-foreground transition hover:text-gold"
              >
                <span>
                  {isOracle
                    ? `Save to ${activeTheme.name}`
                    : "Save to current theme"}
                </span>
                <Save className="h-4 w-4 text-muted-foreground" />
              </button>
            )}

            {!allFull ? (
              <button
                type="button"
                onClick={() => setNameMode(true)}
                className="flex w-full items-center justify-between gap-3 border-b border-border/40 px-1 py-3 text-left text-sm text-foreground transition hover:text-gold"
              >
                <span>
                  {isOracle ? "Preserve as new sanctuary" : "Save as new theme"}
                </span>
                <Plus className="h-4 w-4 text-muted-foreground" />
              </button>
            ) : (
              <button
                type="button"
                onClick={replaceFlow}
                className="flex w-full items-center justify-between gap-3 border-b border-border/40 px-1 py-3 text-left text-sm text-foreground transition hover:text-gold"
              >
                <span>
                  {isOracle ? "Replace a sanctuary" : "Replace a saved theme"}
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            )}

            <button
              type="button"
              onClick={() => void discardAndProceed()}
              className="flex w-full flex-col items-start gap-1 px-1 py-3 text-left transition hover:text-gold"
            >
              <span className="text-sm text-foreground">
                Leave without saving to a sanctuary
              </span>
              <span className="text-[11px] text-muted-foreground">
                Your current look stays, but won't be preserved
              </span>
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Name this {isOracle ? "sanctuary" : "theme"}
            </Label>
            <Input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              maxLength={20}
              placeholder="Midnight Garden"
              style={{ fontSize: 16 }}
            />
            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setNameMode(false);
                  setNameDraft("");
                }}
                className="flex-1"
              >
                Back
              </Button>
              <Button
                onClick={() => void saveAsNew()}
                className="flex-1 bg-gold-gradient text-gold-foreground hover:opacity-95"
              >
                <Save className="mr-1 h-4 w-4" />
                Save
              </Button>
            </div>
          </div>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
