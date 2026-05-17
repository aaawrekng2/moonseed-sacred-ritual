/**
 * Settings → Themes (Q81 redesign).
 *
 * One page, everything visible at once, every control updates the page
 * itself in real time. Sections, top to bottom:
 *   - Live mockup strip (card + heading + body + caption + tabs + badge)
 *   - A. Color Theme        (horizontal scroll of community themes)
 *   - B. Accent Color       (5 dots + collapsible hex picker)
 *   - C. Font Pairing       (5 preset cards)
 *   - D. Text Size          (single slider)
 *   - E. Saved Themes       (5 slots)
 *
 * Removed in Q81: Card Back picker, gradient hex pickers, opacity
 * slider, individual heading-font picker, heading size slider, oracle
 * toggle. Defaults: card back forced to ocean, resting opacity to 1.0.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { HexColorPicker } from "react-colorful";
import { Check, ChevronDown, Pencil, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { useConfirm } from "@/hooks/use-confirm";
import { setStoredAccentColor } from "@/lib/use-theme-color-sync";
import {
  COMMUNITY_THEMES,
  getStoredCommunityTheme,
  setStoredCommunityTheme,
} from "@/lib/community-themes";
import { applyCommunityTheme } from "@/lib/theme-apply";
import {
  FONT_PAIRINGS,
  DEFAULT_FONT_PAIRING,
  applyFontPairing,
  preloadAllPairings,
  readStoredPairing,
  readStoredTextScale,
  applyTextScale,
  TEXT_SCALE_MIN,
  TEXT_SCALE_MAX,
  TEXT_SCALE_DEFAULT,
  TEXT_SCALE_STEP,
  isFontPairingKey,
  type FontPairingKey,
} from "@/lib/font-pairings";
import {
  useSavedThemes,
  MAX_SAVED_THEMES,
  type SavedTheme,
} from "@/lib/use-saved-themes";
import { updateUserPreferences } from "@/lib/user-preferences-write";
import { useSettings } from "@/components/settings/SettingsContext";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { dispatchActiveThemeChanged } from "@/lib/theme-events";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Accent presets                                                     */
/* ------------------------------------------------------------------ */

const ACCENT_PRESETS: ReadonlyArray<{
  value: string;
  label: string;
  swatch: string;
}> = [
  { value: "default", label: "Gold", swatch: "oklch(0.82 0.14 82)" },
  { value: "emerald-isle", label: "Emerald", swatch: "oklch(0.74 0.17 158)" },
  { value: "rose-quartz", label: "Rose", swatch: "oklch(0.70 0.20 15)" },
  { value: "celestial-blue", label: "Blue", swatch: "oklch(0.66 0.18 250)" },
  { value: "violet-flame", label: "Violet", swatch: "oklch(0.66 0.20 295)" },
];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function getAccentTheme(): string {
  if (typeof document === "undefined") return "default";
  return document.documentElement.getAttribute("data-theme") || "default";
}
function applyAccentTheme(value: string): void {
  if (typeof document === "undefined") return;
  if (value === "default") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", value);
  }
}
function applyCustomAccent(hex: string): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--accent-color", hex);
  root.style.setProperty("--primary", hex);
  root.style.setProperty("--accent", hex);
  root.style.setProperty("--ring", `${hex}99`);
}

/* ------------------------------------------------------------------ */
/*  Section shell                                                      */
/* ------------------------------------------------------------------ */

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3
          className="text-lg italic"
          style={{
            fontFamily: "var(--font-display, var(--font-serif))",
            color: "var(--color-foreground)",
          }}
        >
          {title}
        </h3>
        {hint && (
          <p
            style={{
              fontSize: "var(--text-body-sm)",
              color: "var(--muted-foreground-weak)",
              marginTop: 2,
            }}
          >
            {hint}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Live mockup strip                                                  */
/* ------------------------------------------------------------------ */

function LiveMockup() {
  // Re-render when accent or font changes so the active state visuals
  // update on tap. We pull a counter from a tiny state and bump it via
  // an event listener.
  const [, bump] = useState(0);
  useEffect(() => {
    const handler = () => bump((n) => n + 1);
    window.addEventListener("tarotseed:theme-changed", handler);
    return () =>
      window.removeEventListener("tarotseed:theme-changed", handler);
  }, []);

  return (
    <div
      className="rounded-2xl p-5 sticky top-0 z-10 backdrop-blur"
      style={{
        background:
          "linear-gradient(135deg, var(--bg-gradient-left), var(--bg-gradient-right))",
        border: "1px solid var(--border-default)",
      }}
    >
      <div className="flex items-start gap-4">
        {/* Sample card — solid surface with accent glow */}
        <div
          aria-hidden
          style={{
            width: 80,
            height: 128,
            borderRadius: 8,
            background:
              "linear-gradient(180deg, var(--surface-elevated), var(--surface-card))",
            border: "1px solid var(--border-default)",
            boxShadow: "0 6px 18px -8px var(--accent-color)",
            flexShrink: 0,
          }}
        />
        <div className="min-w-0 flex-1 space-y-2">
          <div
            style={{
              fontFamily: "var(--font-display, var(--font-serif))",
              fontSize: "var(--text-heading-md)",
              lineHeight: 1.2,
              color: "var(--color-foreground)",
              fontWeight: 600,
            }}
          >
            The Fool
          </div>
          <p
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "var(--text-body)",
              lineHeight: 1.55,
              color: "var(--color-foreground)",
              opacity: 0.92,
              margin: 0,
            }}
          >
            A leap into the unknown. Trust the journey and embrace new
            beginnings.
          </p>
          <div
            style={{
              fontSize: "var(--text-body-sm)",
              color: "var(--muted-foreground-weak)",
            }}
          >
            3 hours ago · Single Card
          </div>
        </div>
      </div>

      {/* Tabs + badge row */}
      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="flex gap-4">
          <div
            style={{
              fontFamily: "var(--font-display, var(--font-serif))",
              fontSize: "var(--text-body-sm)",
              color: "var(--color-foreground)",
              paddingBottom: 6,
              borderBottom: "2px solid var(--accent-color)",
            }}
          >
            Overview
          </div>
          <div
            style={{
              fontFamily: "var(--font-display, var(--font-serif))",
              fontSize: "var(--text-body-sm)",
              color: "var(--muted-foreground-weak)",
              paddingBottom: 6,
            }}
          >
            Stories
          </div>
        </div>
        <span
          aria-hidden
          style={{
            display: "inline-block",
            width: 14,
            height: 14,
            borderRadius: 999,
            background: "var(--accent-color)",
            boxShadow: "0 0 12px -2px var(--accent-color)",
          }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  A. Color Theme                                                     */
/* ------------------------------------------------------------------ */

function ColorThemeSection({
  activeKey,
  onPick,
}: {
  activeKey: string | null;
  onPick: (key: string) => void;
}) {
  return (
    <Section title="Color Theme" hint="Tap a theme to apply it instantly.">
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4">
        {COMMUNITY_THEMES.map((t) => {
          const isActive = t.key === activeKey;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => onPick(t.key)}
              className={cn(
                "flex-shrink-0 rounded-xl overflow-hidden text-left transition-transform active:scale-[0.97]",
                isActive ? "ring-2" : "ring-1",
              )}
              style={{
                width: 132,
                background:
                  "linear-gradient(135deg, var(--surface-elevated), var(--surface-card))",
                borderColor: "var(--border-subtle)",
                // @ts-expect-error CSS custom prop
                "--tw-ring-color": isActive
                  ? "var(--accent-color)"
                  : "var(--border-subtle)",
              }}
            >
              <div
                aria-hidden
                style={{
                  height: 60,
                  background: `linear-gradient(135deg, ${t.bgLeft}, ${t.bgRight})`,
                  position: "relative",
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    right: 8,
                    bottom: 8,
                    width: 14,
                    height: 14,
                    borderRadius: 999,
                    background: t.accent,
                    border: "2px solid rgba(255,255,255,0.4)",
                  }}
                />
              </div>
              <div className="p-2">
                <div
                  style={{
                    fontFamily: "var(--font-display, var(--font-serif))",
                    fontSize: "var(--text-body-sm)",
                    color: "var(--color-foreground)",
                    fontStyle: "italic",
                  }}
                >
                  {t.name}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/*  B. Accent Color                                                    */
/* ------------------------------------------------------------------ */

function AccentSection({
  accent,
  customHex,
  onPreset,
  onCustom,
}: {
  accent: string;
  customHex: string | null;
  onPreset: (value: string) => void;
  onCustom: (hex: string) => void;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [draft, setDraft] = useState<string>(customHex ?? "#cda464");
  return (
    <Section title="Accent Color">
      <div className="flex items-center gap-3 flex-wrap">
        {ACCENT_PRESETS.map((p) => {
          const isActive = accent === p.value;
          return (
            <button
              key={p.value}
              type="button"
              onClick={() => onPreset(p.value)}
              aria-label={p.label}
              className={cn(
                "rounded-full transition-transform active:scale-90",
                isActive && "ring-2 ring-offset-2",
              )}
              style={{
                width: 32,
                height: 32,
                background: p.swatch,
                // @ts-expect-error CSS custom prop
                "--tw-ring-color": "var(--accent-color)",
                "--tw-ring-offset-color": "var(--background)",
              }}
            >
              {isActive ? <Check className="w-4 h-4 mx-auto text-white" /> : null}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => setShowAdvanced((v) => !v)}
        className="inline-flex items-center gap-1 mt-2"
        style={{
          fontSize: "var(--text-body-sm)",
          color: "var(--muted-foreground-weak)",
        }}
      >
        <ChevronDown
          className={cn(
            "w-3.5 h-3.5 transition-transform",
            showAdvanced && "rotate-180",
          )}
        />
        Advanced
      </button>
      {showAdvanced && (
        <div className="space-y-2 pt-2">
          <HexColorPicker
            color={draft}
            onChange={(c) => {
              setDraft(c);
              onCustom(c);
            }}
          />
          <Input
            value={draft}
            onChange={(e) => {
              const v = e.target.value;
              setDraft(v);
              if (HEX_RE.test(v)) onCustom(v);
            }}
            className="w-28"
            style={{ fontSize: "var(--text-body-sm)" }}
          />
        </div>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/*  C. Font Pairing                                                    */
/* ------------------------------------------------------------------ */

function FontPairingSection({
  active,
  onPick,
}: {
  active: FontPairingKey;
  onPick: (key: FontPairingKey) => void;
}) {
  return (
    <Section title="Font Pairing" hint="Heading + body, paired by hand.">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {FONT_PAIRINGS.map((p) => {
          const isActive = active === p.key;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => onPick(p.key)}
              className={cn(
                "rounded-xl p-3 text-left transition-transform active:scale-[0.98]",
                isActive ? "ring-2" : "ring-1",
              )}
              style={{
                background: "var(--surface-card)",
                // @ts-expect-error CSS custom prop
                "--tw-ring-color": isActive
                  ? "var(--accent-color)"
                  : "var(--border-subtle)",
              }}
            >
              <div
                style={{
                  fontFamily: `"${p.display}", ui-serif, Georgia, serif`,
                  fontSize: 22,
                  lineHeight: 1.1,
                  color: "var(--color-foreground)",
                  fontWeight: 600,
                }}
              >
                {p.name}
              </div>
              <div
                style={{
                  fontFamily: `"${p.body}", ui-serif, Georgia, serif`,
                  fontSize: 14,
                  lineHeight: 1.45,
                  color: "var(--color-foreground)",
                  opacity: 0.85,
                  marginTop: 4,
                }}
              >
                Trust the journey ahead.
              </div>
              <div
                style={{
                  fontSize: "var(--text-caption)",
                  color: "var(--muted-foreground-weak)",
                  marginTop: 4,
                }}
              >
                {p.vibe}
              </div>
            </button>
          );
        })}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/*  D. Text Size                                                       */
/* ------------------------------------------------------------------ */

function TextSizeSection({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <Section title="Text Size">
      <div className="space-y-2 px-1">
        <Slider
          value={[value]}
          min={TEXT_SCALE_MIN}
          max={TEXT_SCALE_MAX}
          step={TEXT_SCALE_STEP}
          onValueChange={(arr) => onChange(arr[0] ?? TEXT_SCALE_DEFAULT)}
        />
        <div
          className="flex justify-between"
          style={{
            fontSize: "var(--text-caption)",
            color: "var(--muted-foreground-weak)",
          }}
        >
          <span>Smaller</span>
          <span>Larger</span>
        </div>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/*  E. Saved Themes                                                    */
/* ------------------------------------------------------------------ */

function SavedThemesSection({
  themes,
  activeSlot,
  pairing,
  textScale,
  onSave,
  onLoad,
  onDelete,
  onOverwrite,
  onRename,
}: {
  themes: SavedTheme[];
  activeSlot: number | null;
  pairing: FontPairingKey;
  textScale: number;
  onSave: (slot: number) => void;
  onLoad: (theme: SavedTheme) => void;
  onDelete: (slot: number) => void;
  onOverwrite: (theme: SavedTheme) => void;
  onRename: (slot: number, name: string) => void;
}) {
  const slots = Array.from({ length: MAX_SAVED_THEMES }, (_, i) => i + 1);
  const [editingSlot, setEditingSlot] = useState<number | null>(null);
  const [draftName, setDraftName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editingSlot != null) inputRef.current?.focus();
  }, [editingSlot]);
  const commitRename = () => {
    if (editingSlot == null) return;
    onRename(editingSlot, draftName);
    setEditingSlot(null);
  };
  return (
    <Section title="Saved Themes" hint="Snapshot your current look to a slot.">
      <div className="space-y-2">
        {slots.map((slot) => {
          const t = themes.find((x) => x.slot === slot);
          const isActive = activeSlot === slot;
          const isEditing = editingSlot === slot;
          return (
            <div
              key={slot}
              className={cn(
                "flex items-center gap-3 rounded-xl p-3",
                isActive ? "ring-2" : "ring-1",
              )}
              style={{
                background: "var(--surface-card)",
                // @ts-expect-error CSS custom prop
                "--tw-ring-color": isActive
                  ? "var(--accent-color)"
                  : "var(--border-subtle)",
              }}
            >
              <div
                aria-hidden
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 999,
                  background: t
                    ? `linear-gradient(135deg, ${t.bg_left}, ${t.bg_right})`
                    : "var(--surface-elevated)",
                  border: "1px solid var(--border-subtle)",
                }}
              />
              <div className="flex-1 min-w-0">
                {t && isEditing ? (
                  <Input
                    ref={inputRef}
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitRename();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        setEditingSlot(null);
                      }
                    }}
                    maxLength={20}
                    className="h-7"
                    style={{ fontSize: "var(--text-body)" }}
                  />
                ) : (
                  <div
                    className="flex items-center gap-1.5"
                    style={{
                      fontSize: "var(--text-body)",
                      color: "var(--color-foreground)",
                    }}
                  >
                    <span className="truncate">{t ? t.name : `Slot ${slot}`}</span>
                    {t && (
                      <button
                        type="button"
                        onClick={() => {
                          setDraftName(t.name);
                          setEditingSlot(slot);
                        }}
                        aria-label="Rename saved theme"
                        className="opacity-60 hover:opacity-100 transition-opacity"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}
                {!t && (
                  <div
                    style={{
                      fontSize: "var(--text-caption)",
                      color: "var(--muted-foreground-weak)",
                    }}
                  >
                    Empty
                  </div>
                )}
              </div>
              {t ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onLoad(t)}
                  >
                    Load
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onOverwrite(t)}
                    aria-label="Overwrite saved theme"
                  >
                    <Save className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onDelete(slot)}
                    aria-label="Delete saved theme"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onSave(slot)}
                >
                  <Save className="w-4 h-4 mr-1" />
                  Save
                </Button>
              )}
            </div>
          );
        })}
        <div
          style={{
            fontSize: "var(--text-caption)",
            color: "var(--muted-foreground-weak)",
            paddingLeft: 4,
          }}
        >
          Pairing: {pairing} · Text: {Math.round(textScale * 100)}%
        </div>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

export function ThemesTab() {
  const { user } = useAuth();
  const { prefs } = useSettings();
  const saved = useSavedThemes();
  const confirm = useConfirm();

  const [communityKey, setCommunityKey] = useState<string | null>(null);
  const [accent, setAccent] = useState<string>("default");
  const [customHex, setCustomHex] = useState<string | null>(null);
  const [pairing, setPairing] = useState<FontPairingKey>(DEFAULT_FONT_PAIRING);
  const [textScale, setTextScaleState] = useState<number>(TEXT_SCALE_DEFAULT);

  // Preload all pairing fonts on mount so tapping between presets has
  // no flash.
  useEffect(() => {
    preloadAllPairings();
  }, []);

  // Seed initial state from what's already on the DOM / localStorage.
  useEffect(() => {
    setCommunityKey(getStoredCommunityTheme());
    setAccent(getAccentTheme());
    setPairing(readStoredPairing());
    setTextScaleState(readStoredTextScale());
  }, []);

  // Pull persisted font pairing + text_scale from the server once auth
  // resolves, and apply them.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("user_preferences")
        .select("font_pairing, text_scale")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled || !data) return;
      const row = data as {
        font_pairing?: string | null;
        text_scale?: number | null;
      };
      if (isFontPairingKey(row.font_pairing)) {
        setPairing(row.font_pairing);
        applyFontPairing(row.font_pairing);
      }
      if (typeof row.text_scale === "number") {
        setTextScaleState(row.text_scale);
        applyTextScale(row.text_scale);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Force resting opacity to 1.0 — slider removed, clarity dropped.
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.style.setProperty("--resting-opacity", "1");
    }
  }, []);

  /* -- handlers ------------------------------------------------- */

  const handleColorTheme = useCallback(
    (key: string) => {
      const t = COMMUNITY_THEMES.find((x) => x.key === key);
      if (!t) return;
      applyCommunityTheme(t);
      setStoredCommunityTheme(key);
      setCommunityKey(key);
      // Apply theme's recommended accent? Themes manage their own accent
      // via applyCommunityTheme, so reset our custom-accent override.
      applyAccentTheme("default");
      setAccent("default");
      setCustomHex(null);
      setStoredAccentColor(null);
      if (user) {
        void updateUserPreferences(user.id, {
          community_theme: key,
          accent_color: null,
        } as never);
      }
      dispatchActiveThemeChanged({
        source: "community",
        name: t.name,
        accent: t.accent,
        sanctuarySlot: null,
        communityKey: t.key,
      });
      window.dispatchEvent(new Event("tarotseed:theme-changed"));
    },
    [user],
  );

  const handleAccentPreset = useCallback(
    (value: string) => {
      applyAccentTheme(value);
      setAccent(value);
      setCustomHex(null);
      // Clear any inline accent overrides so the data-theme attribute wins.
      const root = document.documentElement;
      root.style.removeProperty("--accent-color");
      root.style.removeProperty("--primary");
      root.style.removeProperty("--accent");
      root.style.removeProperty("--ring");
      setStoredAccentColor(null);
      if (user) {
        void updateUserPreferences(user.id, { accent_color: null });
      }
      window.dispatchEvent(new Event("tarotseed:theme-changed"));
    },
    [user],
  );

  const handleCustomAccent = useCallback(
    (hex: string) => {
      if (!HEX_RE.test(hex)) return;
      applyAccentTheme("default");
      applyCustomAccent(hex);
      setAccent("default");
      setCustomHex(hex);
      setStoredAccentColor(hex);
      if (user) {
        void updateUserPreferences(user.id, { accent_color: hex });
      }
      window.dispatchEvent(new Event("tarotseed:theme-changed"));
    },
    [user],
  );

  const handlePairing = useCallback(
    (key: FontPairingKey) => {
      setPairing(key);
      applyFontPairing(key);
      if (user) {
        void updateUserPreferences(user.id, {
          font_pairing: key,
        } as unknown as Parameters<typeof updateUserPreferences>[1]);
      }
      window.dispatchEvent(new Event("tarotseed:theme-changed"));
    },
    [user],
  );

  const handleTextScale = useCallback(
    (v: number) => {
      setTextScaleState(v);
      applyTextScale(v);
      if (user) {
        void updateUserPreferences(user.id, {
          text_scale: v,
        } as unknown as Parameters<typeof updateUserPreferences>[1]);
      }
    },
    [user],
  );

  const handleSaveSlot = useCallback(
    async (slot: number) => {
      const t = COMMUNITY_THEMES.find((x) => x.key === communityKey);
      const bgLeft = t?.bgLeft ?? "#0f0c29";
      const bgRight = t?.bgRight ?? "#1e1b4b";
      const accentColor =
        customHex ??
        ACCENT_PRESETS.find((p) => p.value === accent)?.swatch ??
        "#cda464";
      // Saved-theme stores hex; accept oklch swatch by storing a sane
      // default when preset is used (the preset color is reapplied via
      // data-theme on load, not via this hex).
      const safeAccentHex = HEX_RE.test(accentColor) ? accentColor : "#cda464";
      await saved.saveSlot(slot, {
        name: `My Theme ${slot}`,
        bg_left: bgLeft,
        bg_right: bgRight,
        accent: safeAccentHex,
        theme_key: communityKey ?? undefined,
        font_pairing: pairing,
        text_scale: textScale,
      });
      await saved.setActiveSlot(slot);
      toast.success(`Saved to slot ${slot}.`);
    },
    [communityKey, accent, customHex, pairing, textScale, saved],
  );

  const handleLoadSlot = useCallback(
    async (theme: SavedTheme) => {
      // Restore color theme via its community key if we have it.
      if (theme.theme_key) {
        const t = COMMUNITY_THEMES.find((x) => x.key === theme.theme_key);
        if (t) {
          applyCommunityTheme(t);
          setStoredCommunityTheme(t.key);
          setCommunityKey(t.key);
        }
      }
      // Custom accent restore
      if (HEX_RE.test(theme.accent)) {
        applyCustomAccent(theme.accent);
        setCustomHex(theme.accent);
        setAccent("default");
      }
      // Pairing + text_scale restore.
      if (theme.font_pairing && isFontPairingKey(theme.font_pairing)) {
        setPairing(theme.font_pairing);
        applyFontPairing(theme.font_pairing);
      }
      if (typeof theme.text_scale === "number") {
        setTextScaleState(theme.text_scale);
        applyTextScale(theme.text_scale);
      }
      await saved.setActiveSlot(theme.slot);
      dispatchActiveThemeChanged({
        source: "sanctuary",
        name: theme.name,
        accent: theme.accent,
        sanctuarySlot: theme.slot,
        communityKey: theme.theme_key ?? null,
      });
      window.dispatchEvent(new Event("tarotseed:theme-changed"));
      toast.success(`Loaded ${theme.name}.`);
    },
    [saved],
  );

  const handleDeleteSlot = useCallback(
    async (slot: number) => {
      await saved.deleteSlot(slot);
      toast.success(`Slot ${slot} cleared.`);
    },
    [saved],
  );

  const handleOverwriteSlot = useCallback(
    async (existing: SavedTheme) => {
      const ok = await confirm({
        title: `Overwrite ${existing.name}?`,
        description: "This replaces the slot with your current settings.",
        confirmLabel: "Overwrite",
      });
      if (!ok) return;
      const t = COMMUNITY_THEMES.find((x) => x.key === communityKey);
      const bgLeft = t?.bgLeft ?? existing.bg_left;
      const bgRight = t?.bgRight ?? existing.bg_right;
      const accentColor =
        customHex ??
        ACCENT_PRESETS.find((p) => p.value === accent)?.swatch ??
        existing.accent;
      const safeAccentHex = HEX_RE.test(accentColor)
        ? accentColor
        : existing.accent;
      await saved.saveSlot(existing.slot, {
        name: existing.name,
        bg_left: bgLeft,
        bg_right: bgRight,
        accent: safeAccentHex,
        theme_key: communityKey ?? undefined,
        font_pairing: pairing,
        text_scale: textScale,
      });
      await saved.setActiveSlot(existing.slot);
      toast.success(`${existing.name} updated.`);
    },
    [confirm, communityKey, accent, customHex, pairing, textScale, saved],
  );

  const handleRenameSlot = useCallback(
    async (slot: number, name: string) => {
      await saved.renameSlot(slot, name);
    },
    [saved],
  );

  /* -- render --------------------------------------------------- */

  // Suppress unused warning until accent-driven preview wiring lands.
  void prefs;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h2
          className="text-2xl italic"
          style={{
            fontFamily: "var(--font-display, var(--font-serif))",
            color: "var(--color-foreground)",
          }}
        >
          Theme
        </h2>
        <p
          style={{
            fontSize: "var(--text-body-sm)",
            color: "var(--muted-foreground-weak)",
          }}
        >
          Shape the space where your readings live.
        </p>
      </header>

      <LiveMockup />

      <ColorThemeSection
        activeKey={communityKey}
        onPick={handleColorTheme}
      />

      <AccentSection
        accent={accent}
        customHex={customHex}
        onPreset={handleAccentPreset}
        onCustom={handleCustomAccent}
      />

      <FontPairingSection active={pairing} onPick={handlePairing} />

      <TextSizeSection value={textScale} onChange={handleTextScale} />

      <SavedThemesSection
        themes={saved.occupied}
        activeSlot={saved.activeSlot}
        pairing={pairing}
        textScale={textScale}
        onSave={handleSaveSlot}
        onLoad={handleLoadSlot}
        onDelete={handleDeleteSlot}
        onOverwrite={handleOverwriteSlot}
        onRename={handleRenameSlot}
      />
    </div>
  );
}
