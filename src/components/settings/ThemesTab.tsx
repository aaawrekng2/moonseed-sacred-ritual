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
import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, RotateCcw, Save, Trash2, Wand2 } from "lucide-react";
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
  BG_PRESETS,
  DEFAULT_BG_LEFT,
  DEFAULT_BG_RIGHT,
  useBgGradient,
  type BgPresetName,
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
      <div className="space-y-10">
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <h2 className="text-xl font-semibold tracking-tight">Themes</h2>
            <p className="text-sm text-muted-foreground">
              Make your reading room your own.
            </p>
          </div>
          <ResetToDefaultsButton />
        </header>

        <CardBackSection />
        <AccentColorSection />
        <CustomAccentSection />
        <BackgroundGradientSection />
        <HeadingFontSection />
        <InterfaceFadeSection />
        <CommunityThemesSection />
        <SavedThemesSection />
      </div>
    </ThemeDirtyProvider>
  );
}

/* ------------------------------------------------------------------ */
/*  Reset                                                              */
/* ------------------------------------------------------------------ */

function ResetToDefaultsButton() {
  const { user } = useSettings();
  const { setPreset } = useBgGradient();
  const { setOpacity } = useRestingOpacity();
  const { markClean } = useThemeDirty();
  const [open, setOpen] = useState(false);

  const reset = async () => {
    setStoredCardBack(DEFAULT_CARD_BACK);
    applyAccentTheme("default");
    setPreset("midnight");
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
        Reset
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset all theme settings?</AlertDialogTitle>
            <AlertDialogDescription>
              Card back, accent, background, font and interface fade will return
              to their original Moonseed defaults. Your saved themes are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={reset}>Reset</AlertDialogAction>
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
    <SettingsSection title="Card Back" description="The back face of every drawn card.">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
        {CARD_BACKS.map((back) => {
          const active = cardBack === back.id;
          return (
            <button
              key={back.id}
              type="button"
              onClick={() => void choose(back.id)}
              className={cn(
                "flex flex-col items-center gap-2 rounded-2xl border p-3 transition",
                active
                  ? "border-gold shadow-glow"
                  : "border-border/60 hover:border-gold/40",
              )}
              aria-pressed={active}
              aria-label={`Use ${back.label} card back`}
            >
              <CardBack id={back.id} width={48} />
              <span className="text-xs text-muted-foreground-strong">
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
/*  Accent Color (presets)                                             */
/* ------------------------------------------------------------------ */

function AccentColorSection() {
  const { user } = useSettings();
  const { markDirty } = useThemeDirty();
  const [accent, setAccent] = useState<string>("default");

  useEffect(() => {
    setAccent(getAccentTheme());
  }, []);

  const choose = async (value: string) => {
    setAccent(value);
    applyAccentTheme(value);
    markDirty();
    await updateUserPreferences(user.id, { accent: value });
  };

  return (
    <SettingsSection
      title="Accent Color"
      description="The gold-equivalent that highlights headings, rings and active states."
    >
      <div className="flex flex-wrap gap-3">
        {ACCENT_PRESETS.map((p) => {
          const active = accent === p.value;
          return (
            <button
              key={p.value}
              type="button"
              onClick={() => void choose(p.value)}
              aria-pressed={active}
              aria-label={`Apply ${p.label} accent`}
              className={cn(
                "group flex flex-col items-center gap-2 rounded-lg p-2 transition",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-gold",
              )}
            >
              <span
                className={cn(
                  "block h-10 w-10 rounded-full transition-all",
                  active
                    ? "ring-2 ring-gold ring-offset-2 ring-offset-background shadow-glow"
                    : "ring-1 ring-border/60 group-hover:ring-gold/50",
                )}
                style={{ backgroundColor: p.swatch }}
              />
              <span
                className={cn(
                  "text-[11px] leading-tight",
                  active ? "text-gold" : "text-muted-foreground",
                )}
              >
                {p.label}
              </span>
            </button>
          );
        })}
      </div>
    </SettingsSection>
  );
}

/* ------------------------------------------------------------------ */
/*  Custom Accent Picker                                               */
/* ------------------------------------------------------------------ */

function CustomAccentSection() {
  const { user, prefs, setPrefs } = useSettings();
  const { markDirty } = useThemeDirty();
  const [open, setOpen] = useState(false);
  const initial = prefs.accent_color ?? "#f59e0b";
  const [draft, setDraft] = useState(initial);
  const [hexInput, setHexInput] = useState(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (prefs.accent_color && typeof document !== "undefined") {
      // Push the custom color into the gold token so all gold-themed UI picks it up.
      document.documentElement.style.setProperty("--gold", prefs.accent_color);
      document.documentElement.style.setProperty("--primary", prefs.accent_color);
      document.documentElement.style.setProperty(
        "--ring",
        `${prefs.accent_color}99`,
      );
    }
  }, [prefs.accent_color]);

  const apply = async () => {
    if (!isHex(draft)) return;
    setSaving(true);
    document.documentElement.style.setProperty("--gold", draft);
    document.documentElement.style.setProperty("--primary", draft);
    document.documentElement.style.setProperty("--ring", `${draft}99`);
    const { error } = await updateUserPreferences(user.id, {
      accent_color: draft.toLowerCase(),
    });
    setSaving(false);
    if (error) {
      toast.error("Couldn't save your color.");
      return;
    }
    setPrefs({ ...prefs, accent_color: draft.toLowerCase() });
    markDirty();
    setOpen(false);
    toast.success("Custom accent applied");
  };

  const clear = async () => {
    setSaving(true);
    document.documentElement.style.removeProperty("--gold");
    document.documentElement.style.removeProperty("--primary");
    document.documentElement.style.removeProperty("--ring");
    await updateUserPreferences(user.id, { accent_color: null });
    setPrefs({ ...prefs, accent_color: null });
    setSaving(false);
    setOpen(false);
    toast.success("Reset to preset accent");
  };

  const display = prefs.accent_color ?? initial;

  return (
    <SettingsSection
      title="Custom Accent"
      description="Pick any hex color — overrides the preset above."
    >
      <div className="flex items-start gap-4">
        <button
          type="button"
          onClick={() => {
            setDraft(display);
            setHexInput(display);
            setOpen((v) => !v);
          }}
          aria-expanded={open}
          aria-label={`Custom accent — current ${display}, tap to change`}
          className={cn(
            "relative inline-flex aspect-square w-12 shrink-0 items-center justify-center rounded-full transition-all",
            "ring-offset-2 ring-offset-background",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold",
            prefs.accent_color
              ? "ring-2 ring-gold shadow-glow"
              : "ring-1 ring-border/60 hover:ring-gold/50",
          )}
          style={{ backgroundColor: display }}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-foreground">
            {prefs.accent_color ? "Custom" : "Using preset"}
          </p>
          <p className="mt-0.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground-weak">
            {display.toUpperCase()}
          </p>
        </div>
      </div>

      {open && (
        <div className="mt-4 rounded-xl border border-border/60 bg-card/80 p-4 backdrop-blur-xl">
          <div className="flex justify-center">
            <div className="custom-color-picker w-full max-w-[320px]">
              <HexColorPicker
                color={draft}
                onChange={(v) => {
                  setDraft(v);
                  setHexInput(v);
                }}
              />
            </div>
          </div>
          <div className="mt-4 space-y-1.5">
            <Label htmlFor="accent-hex" className="text-xs uppercase tracking-widest text-muted-foreground">
              Hex
            </Label>
            <Input
              id="accent-hex"
              value={hexInput}
              onChange={(e) => {
                const v = e.target.value.startsWith("#")
                  ? e.target.value
                  : `#${e.target.value}`;
                setHexInput(v);
                if (isHex(v)) setDraft(v.toLowerCase());
              }}
              maxLength={7}
              className="font-mono uppercase"
              style={{ fontSize: 16 }}
              aria-invalid={!isHex(hexInput)}
            />
          </div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button
              onClick={apply}
              disabled={saving || !isHex(draft)}
              className="bg-gold-gradient text-gold-foreground shadow-glow hover:opacity-95 flex-1"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Apply
            </Button>
            <Button
              variant="ghost"
              onClick={clear}
              disabled={saving}
              className="flex-1 text-muted-foreground"
            >
              Reset to preset
            </Button>
          </div>
        </div>
      )}
    </SettingsSection>
  );
}

/* ------------------------------------------------------------------ */
/*  Background Gradient                                                */
/* ------------------------------------------------------------------ */

function BackgroundGradientSection() {
  const { user, prefs, setPrefs } = useSettings();
  const { preset, setPreset } = useBgGradient();
  const { markDirty } = useThemeDirty();

  const [leftHex, setLeftHex] = useState(
    prefs.bg_gradient_from ?? DEFAULT_BG_LEFT,
  );
  const [rightHex, setRightHex] = useState(
    prefs.bg_gradient_to ?? DEFAULT_BG_RIGHT,
  );
  const [openSide, setOpenSide] = useState<"left" | "right" | null>(null);

  // Apply custom hexes whenever they change in prefs.
  useEffect(() => {
    if (prefs.bg_gradient_from && prefs.bg_gradient_to) {
      document.documentElement.style.setProperty(
        "--bg-gradient-left",
        prefs.bg_gradient_from,
      );
      document.documentElement.style.setProperty(
        "--bg-gradient-right",
        prefs.bg_gradient_to,
      );
      setLeftHex(prefs.bg_gradient_from);
      setRightHex(prefs.bg_gradient_to);
    }
  }, [prefs.bg_gradient_from, prefs.bg_gradient_to]);

  const choosePreset = async (name: BgPresetName) => {
    setPreset(name);
    markDirty();
    const found = BG_PRESETS.find((p) => p.value === name);
    if (!found) return;
    setLeftHex(found.left);
    setRightHex(found.right);
    await updateUserPreferences(user.id, {
      bg_gradient_from: null,
      bg_gradient_to: null,
    });
    setPrefs({ ...prefs, bg_gradient_from: null, bg_gradient_to: null });
  };

  const applyCustom = async (left: string, right: string) => {
    if (!isHex(left) || !isHex(right)) return;
    document.documentElement.style.setProperty("--bg-gradient-left", left);
    document.documentElement.style.setProperty("--bg-gradient-right", right);
    setLeftHex(left);
    setRightHex(right);
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
  };

  const liveLeft = prefs.bg_gradient_from ?? leftHex;
  const liveRight = prefs.bg_gradient_to ?? rightHex;

  return (
    <SettingsSection
      title="Background Gradient"
      description="The deep gradient behind every screen."
    >
      <div className="space-y-5">
        <div
          aria-hidden
          className="h-20 w-full rounded-2xl border border-gold/30"
          style={{
            background: `linear-gradient(to right, ${liveLeft}, ${liveRight})`,
          }}
        />

        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Presets
          </Label>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {BG_PRESETS.map((p) => {
              const active = preset === p.value && !prefs.bg_gradient_from;
              return (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => void choosePreset(p.value)}
                  aria-pressed={active}
                  className={cn(
                    "group flex flex-col items-center gap-1.5 focus:outline-none",
                  )}
                >
                  <span
                    className={cn(
                      "block h-12 w-full rounded-lg transition-all",
                      active
                        ? "ring-2 ring-gold shadow-glow"
                        : "ring-1 ring-border/60 group-hover:ring-gold/50",
                    )}
                    style={{
                      background: `linear-gradient(to right, ${p.left}, ${p.right})`,
                    }}
                  />
                  <span
                    className={cn(
                      "text-[10px] leading-tight",
                      active ? "text-gold" : "text-muted-foreground",
                    )}
                  >
                    {p.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-4">
          <BgHexPicker
            label="Left Color"
            value={liveLeft}
            open={openSide === "left"}
            onToggle={() => setOpenSide(openSide === "left" ? null : "left")}
            onApply={(hex) => void applyCustom(hex, liveRight)}
            onReset={() => void applyCustom(DEFAULT_BG_LEFT, liveRight)}
          />
          <BgHexPicker
            label="Right Color"
            value={liveRight}
            open={openSide === "right"}
            onToggle={() => setOpenSide(openSide === "right" ? null : "right")}
            onApply={(hex) => void applyCustom(liveLeft, hex)}
            onReset={() => void applyCustom(liveLeft, DEFAULT_BG_RIGHT)}
          />
        </div>
      </div>
    </SettingsSection>
  );
}

function BgHexPicker({
  label,
  value,
  open,
  onToggle,
  onApply,
  onReset,
}: {
  label: string;
  value: string;
  open: boolean;
  onToggle: () => void;
  onApply: (hex: string) => void;
  onReset: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const [hexInput, setHexInput] = useState(value);

  useEffect(() => {
    if (open) {
      setDraft(value);
      setHexInput(value);
    }
  }, [open, value]);

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-4">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={`${label} — current ${value}`}
          className="relative inline-flex aspect-square w-12 shrink-0 rounded-full ring-1 ring-border/60 transition-all hover:ring-gold/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ring-offset-2 ring-offset-background"
          style={{ backgroundColor: value }}
        />
        <div className="min-w-0 flex-1">
          <Label className="text-sm font-medium text-foreground">{label}</Label>
          <p className="mt-0.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground-weak">
            {value.toUpperCase()}
          </p>
        </div>
      </div>
      {open && (
        <div className="rounded-xl border border-border/60 bg-card/80 p-4 backdrop-blur-xl">
          <div className="flex justify-center">
            <div className="custom-color-picker w-full max-w-[320px]">
              <HexColorPicker
                color={draft}
                onChange={(v) => {
                  setDraft(v);
                  setHexInput(v);
                }}
              />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <Input
              value={hexInput}
              onChange={(e) => {
                const v = e.target.value.startsWith("#")
                  ? e.target.value
                  : `#${e.target.value}`;
                setHexInput(v);
                if (isHex(v)) setDraft(v.toLowerCase());
              }}
              maxLength={7}
              className="font-mono uppercase"
              style={{ fontSize: 16 }}
            />
          </div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button
              onClick={() => isHex(draft) && onApply(draft)}
              disabled={!isHex(draft)}
              className="bg-gold-gradient text-gold-foreground shadow-glow hover:opacity-95 flex-1"
            >
              Apply
            </Button>
            <Button
              variant="ghost"
              onClick={onReset}
              className="flex-1 text-muted-foreground"
            >
              Reset
            </Button>
          </div>
        </div>
      )}
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
      title="Heading Font"
      description="The display font + size used across headings."
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2.5">
          {THEME_FONTS.map((f) => {
            const selected = f === font;
            return (
              <button
                key={f}
                type="button"
                onClick={() => void pickFont(f)}
                className={cn(
                  "rounded-full border px-4 py-2 text-sm transition",
                  selected
                    ? "border-gold bg-gold/15 text-gold"
                    : "border-border/60 text-muted-foreground hover:border-gold/40",
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
              Font Size
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
  const { user } = useSettings();
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
  };

  return (
    <SettingsSection
      title="Interface Fade"
      description="How subtle the top bar icons appear at rest."
    >
      <div className="space-y-3">
        <FadePreviewBar opacity={draft} />
        <div className="flex items-center justify-between">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Resting opacity
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
          <span>Subtle</span>
          <span>Bold</span>
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
/*  Community Themes carousel                                          */
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
    toast.success(`Applied ${theme.name}`);
  };

  return (
    <SettingsSection
      title="Community Themes"
      description="Curated looks crafted by the Moonseed community."
    >
      <div className="-mx-2 overflow-x-auto">
        <div className="flex gap-3 px-2 pb-2 snap-x snap-mandatory">
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
                  "group relative flex w-[220px] shrink-0 snap-start flex-col gap-2 rounded-2xl border p-3 text-left transition",
                  active
                    ? "border-gold shadow-glow"
                    : "border-border/60 hover:border-gold/40",
                )}
              >
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
        </div>
      </div>
      <p className="mt-2 text-center text-[10px] uppercase tracking-widest text-muted-foreground/70">
        Swipe to explore
      </p>
    </SettingsSection>
  );
}

/* ------------------------------------------------------------------ */
/*  Saved Themes — 5-slot carousel                                     */
/* ------------------------------------------------------------------ */

function SavedThemesSection() {
  const { prefs } = useSettings();
  const {
    themes,
    activeSlot,
    loaded,
    saveSlot,
    deleteSlot,
    setActiveSlot,
  } = useSavedThemes();
  const { setOpacity } = useRestingOpacity();
  const { hasUnsavedChanges, markClean } = useThemeDirty();

  const [activeIndex, setActiveIndex] = useState(0);
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
    await saveSlot(slot, captureCurrent(name));
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
    markClean();
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
      title="Saved Themes"
      description={`Snapshot the current look — up to ${MAX_SAVED_THEMES} slots.`}
    >
      <div className="-mx-2 overflow-x-auto">
        <div
          className="flex gap-3 px-2 pb-2 snap-x snap-mandatory"
          onScroll={(e) => {
            const el = e.currentTarget;
            const card = 220 + 12; // width + gap
            const idx = Math.round(el.scrollLeft / card);
            setActiveIndex(Math.min(MAX_SAVED_THEMES - 1, Math.max(0, idx)));
          }}
        >
          {slots.map(({ slot, theme }) => {
            const active = activeSlot === slot;
            return (
              <div
                key={slot}
                className={cn(
                  "relative flex w-[220px] shrink-0 snap-start flex-col gap-3 rounded-2xl border p-3 transition",
                  active
                    ? "border-gold shadow-glow"
                    : "border-border/60 hover:border-gold/40",
                )}
              >
                {theme ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(theme)}
                      aria-label={`Delete ${theme.name}`}
                      className="absolute right-2 top-2 z-10 rounded-full bg-background/70 p-1 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-destructive focus:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
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
                            "truncate text-sm font-medium",
                            active ? "text-gold" : "text-foreground",
                          )}
                        >
                          {theme.name}
                        </p>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Slot {slot}
                          {active && " · active"}
                        </p>
                      </div>
                    </div>
                    <div className="mt-auto grid grid-cols-2 gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSaveClick(slot, theme)}
                        className="gap-1"
                      >
                        <Save className="h-3.5 w-3.5" />
                        Save
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => requestLoad(theme)}
                        className="bg-gold-gradient text-gold-foreground hover:opacity-95"
                      >
                        Load
                      </Button>
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleSaveClick(slot, null)}
                    aria-label={`Save current theme to slot ${slot}`}
                    className="flex h-full min-h-[180px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/60 text-muted-foreground transition hover:border-gold/50 hover:text-gold"
                  >
                    <Plus className="h-6 w-6" />
                    <span className="text-xs">Save current theme</span>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                      Slot {slot}
                    </span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Dot pagination */}
      <div className="mt-2 flex items-center justify-center gap-1.5">
        {slots.map((_, i) => (
          <span
            key={i}
            aria-hidden
            className={cn(
              "block h-1.5 rounded-full transition-all",
              i === activeIndex
                ? "w-4 bg-gold"
                : "w-1.5 bg-border/70",
            )}
          />
        ))}
      </div>
      <p className="mt-1 text-center text-[10px] uppercase tracking-widest text-muted-foreground/70">
        Swipe to explore
      </p>

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
              Overwrite{" "}
              {overwriteSlot != null
                ? slots.find((s) => s.slot === overwriteSlot)?.theme?.name
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
              Overwrite
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirm */}
      <AlertDialog
        open={deleteTarget != null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {deleteTarget?.name ?? "this theme"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The slot becomes empty and the snapshot is gone for good.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) {
                  void deleteSlot(deleteTarget.slot);
                  toast.success(`Deleted "${deleteTarget.name}"`);
                  setDeleteTarget(null);
                }
              }}
            >
              Delete
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
