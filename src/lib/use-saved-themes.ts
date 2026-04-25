/**
 * Hook for reading + writing the user's "Saved Themes" — up to 5 named
 * snapshots of (background gradient + accent color + heading font + size +
 * card back + resting opacity) that can be re-applied with one tap.
 *
 * Stored on `user_preferences.saved_themes` as a JSONB array.
 * `active_theme_slot` tracks which slot is currently applied so the
 * Themes tab can highlight it.
 *
 * Adapted from the source bundle for Moonseed's personal-only model:
 * single accent (no per-mode), single heading font, single icon set.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { updateUserPreferences } from "@/lib/user-preferences-write";
import type { CardBackId } from "@/lib/card-backs";

export const MAX_SAVED_THEMES = 5;

/** Whitelisted heading fonts a saved theme may carry. */
export const THEME_FONTS = [
  "Cormorant Garamond",
  "Cinzel",
  "Playfair Display",
  "Raleway",
  "Lora",
] as const;
export type ThemeFont = (typeof THEME_FONTS)[number];

export const DEFAULT_THEME_FONT: ThemeFont = "Cormorant Garamond";
export const MIN_FONT_SIZE = 16;
export const MAX_FONT_SIZE = 32;
export const DEFAULT_FONT_SIZE = 22;

export type SavedTheme = {
  /** 1..5 — slot index. Unique per user. */
  slot: number;
  name: string;
  bg_left: string;
  bg_right: string;
  accent: string;
  font?: ThemeFont;
  font_size?: number;
  card_back?: CardBackId;
  resting_opacity?: number;
};

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
function isHex(v: unknown): v is string {
  return typeof v === "string" && HEX_RE.test(v);
}
function isThemeFont(v: unknown): v is ThemeFont {
  return typeof v === "string" && (THEME_FONTS as readonly string[]).includes(v);
}
function clampOpacity(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  return Math.max(25, Math.min(100, Math.round(v)));
}
export function clampFontSize(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, Math.round(v)));
}

function parseSavedThemes(raw: unknown): SavedTheme[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedTheme[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const slot = typeof r.slot === "number" ? r.slot : NaN;
    if (!Number.isFinite(slot) || slot < 1 || slot > MAX_SAVED_THEMES) continue;
    if (
      typeof r.name !== "string" ||
      !isHex(r.bg_left) ||
      !isHex(r.bg_right) ||
      !isHex(r.accent)
    ) {
      continue;
    }
    out.push({
      slot,
      name: r.name.slice(0, 20),
      bg_left: r.bg_left,
      bg_right: r.bg_right,
      accent: r.accent,
      font: isThemeFont(r.font) ? r.font : undefined,
      font_size: clampFontSize(r.font_size),
      card_back:
        typeof r.card_back === "string"
          ? (r.card_back as CardBackId)
          : undefined,
      resting_opacity: clampOpacity(r.resting_opacity),
    });
  }
  out.sort((a, b) => a.slot - b.slot);
  return out;
}

/* ------------------------------------------------------------------ */
/*  Google Fonts — load on demand                                      */
/* ------------------------------------------------------------------ */

const loadedFonts = new Set<string>(["Cormorant Garamond", "Inter"]);

export function ensureFontLoaded(font: ThemeFont) {
  if (typeof document === "undefined") return;
  if (loadedFonts.has(font)) return;
  loadedFonts.add(font);
  const id = `gf-${font.replace(/\s+/g, "-").toLowerCase()}`;
  if (document.getElementById(id)) return;
  const family = font.replace(/\s+/g, "+");
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${family}:wght@400;500;600;700&display=swap`;
  document.head.appendChild(link);
}

export function applyHeadingFont(font: ThemeFont) {
  if (typeof document === "undefined") return;
  ensureFontLoaded(font);
  document.documentElement.style.setProperty(
    "--font-serif",
    `"${font}", ui-serif, Georgia, serif`,
  );
}

export function applyHeadingFontSize(sizePx: number) {
  if (typeof document === "undefined") return;
  const clamped = Math.max(
    MIN_FONT_SIZE,
    Math.min(MAX_FONT_SIZE, Math.round(sizePx)),
  );
  const scale = clamped / DEFAULT_FONT_SIZE;
  document.documentElement.style.setProperty("--heading-scale", String(scale));
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useSavedThemes() {
  const { user } = useAuth();
  const [themes, setThemes] = useState<SavedTheme[]>([]);
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  const fetchFromServer = useCallback(async () => {
    if (!user) {
      setThemes([]);
      setActiveSlot(null);
      setLoaded(true);
      return;
    }
    const { data } = await supabase
      .from("user_preferences")
      .select("saved_themes, active_theme_slot")
      .eq("user_id", user.id)
      .maybeSingle();
    const row = (data ?? {}) as {
      saved_themes?: unknown;
      active_theme_slot?: number | null;
    };
    setThemes(parseSavedThemes(row.saved_themes));
    setActiveSlot(
      typeof row.active_theme_slot === "number" ? row.active_theme_slot : null,
    );
    setLoaded(true);
  }, [user]);

  useEffect(() => {
    void fetchFromServer();
  }, [fetchFromServer]);

  // Cross-instance sync: when one component updates the active sanctuary
  // (e.g. the wand in TopRightControls), every other mounted hook
  // refreshes from the server so its local activeSlot stays in step.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const refresh = () => void fetchFromServer();
    window.addEventListener("moonseed:sanctuary-changed", refresh);
    return () => {
      window.removeEventListener("moonseed:sanctuary-changed", refresh);
    };
  }, [fetchFromServer]);

  const persist = useCallback(
    async (next: SavedTheme[]) => {
      setThemes(next);
      if (!user) return;
      await supabase.from("user_preferences").upsert(
        { user_id: user.id, saved_themes: next as unknown as never },
        { onConflict: "user_id" },
      );
    },
    [user],
  );

  const saveSlot = useCallback(
    async (slot: number, theme: Omit<SavedTheme, "slot">) => {
      if (slot < 1 || slot > MAX_SAVED_THEMES) return;
      const filtered = themes.filter((t) => t.slot !== slot);
      const next = [...filtered, { ...theme, slot }].sort(
        (a, b) => a.slot - b.slot,
      );
      await persist(next);
    },
    [themes, persist],
  );

  const deleteSlot = useCallback(
    async (slot: number) => {
      const next = themes.filter((t) => t.slot !== slot);
      await persist(next);
      if (activeSlot === slot && user) {
        setActiveSlot(null);
        await updateUserPreferences(user.id, { active_theme_slot: null });
      }
    },
    [themes, persist, activeSlot, user],
  );

  const setActiveSlotPersisted = useCallback(
    async (slot: number | null) => {
      setActiveSlot(slot);
      if (!user) return;
      await updateUserPreferences(user.id, { active_theme_slot: slot });
    },
    [user],
  );

  const occupied = useMemo(
    () => themes.slice().sort((a, b) => a.slot - b.slot),
    [themes],
  );

  return {
    themes,
    occupied,
    activeSlot,
    loaded,
    saveSlot,
    deleteSlot,
    setActiveSlot: setActiveSlotPersisted,
    refresh: fetchFromServer,
  };
}