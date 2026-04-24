import { useEffect, useState, useCallback } from "react";

export const DEFAULT_BG_LEFT = "#1e1b4b";
export const DEFAULT_BG_RIGHT = "#0f172a";

export type BgPresetName =
  | "midnight"
  | "obsidian"
  | "deep-ocean"
  | "twilight"
  | "ember"
  | "forest";

export const BG_PRESETS = [
  { value: "midnight", label: "Midnight", left: "#1e1b4b", right: "#0f172a" },
  { value: "obsidian", label: "Obsidian", left: "#1a1a1a", right: "#2d2d2d" },
  { value: "deep-ocean", label: "Deep Ocean", left: "#0c1445", right: "#0d3b3b" },
  { value: "twilight", label: "Twilight", left: "#2d1b69", right: "#0f1a3d" },
  { value: "ember", label: "Ember", left: "#2d1a0e", right: "#3d0a1a" },
  { value: "forest", label: "Forest", left: "#0a2e1a", right: "#0a0a0a" },
] as const;

const STORAGE_KEY = "moonseed:bg-preset";
const EVENT = "arcana:bg-gradient-changed";

function applyPreset(name: BgPresetName) {
  const preset = BG_PRESETS.find((p) => p.value === name) ?? BG_PRESETS[0];
  if (typeof document !== "undefined") {
    document.documentElement.style.setProperty("--bg-gradient-left", preset.left);
    document.documentElement.style.setProperty("--bg-gradient-right", preset.right);
  }
}

export function useBgGradient() {
  const [preset, setPresetState] = useState<BgPresetName>("midnight");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = (localStorage.getItem(STORAGE_KEY) as BgPresetName | null) ?? "midnight";
    setPresetState(saved);
    applyPreset(saved);
    setLoaded(true);

    const handler = (e: Event) => {
      const detail = (e as CustomEvent<BgPresetName>).detail;
      if (detail) {
        setPresetState(detail);
        applyPreset(detail);
      }
    };
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, []);

  const setPreset = useCallback((name: BgPresetName) => {
    setPresetState(name);
    applyPreset(name);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, name);
      window.dispatchEvent(new CustomEvent(EVENT, { detail: name }));
    }
  }, []);

  return { preset, setPreset, loaded };
}