import { useNavigate } from "@tanstack/react-router";
import { Wand2 } from "lucide-react";
import { useRestingOpacity } from "@/lib/use-resting-opacity";
import { BG_PRESETS, useBgGradient, type BgPresetName } from "@/lib/use-bg-gradient";
import { useAuth } from "@/lib/auth";

const ORDER: BgPresetName[] = [
  "midnight",
  "obsidian",
  "deep-ocean",
  "twilight",
  "ember",
  "forest",
];

interface Props {
  initial?: string;
}

export function TopRightControls({ initial }: Props) {
  const { preset, setPreset } = useBgGradient();
  const { opacity } = useRestingOpacity();
  const restingAlpha = opacity / 100;
  const navigate = useNavigate();
  const { user } = useAuth();

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

  const cycleTheme = () => {
    const idx = ORDER.indexOf(preset);
    const next = ORDER[(idx + 1) % ORDER.length];
    setPreset(next);
  };

  const currentLabel =
    BG_PRESETS.find((p) => p.value === preset)?.label ?? "Theme";

  return (
    <div
      className="fixed right-4 z-50 flex items-center gap-2"
      style={{ top: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
    >
      <button
        type="button"
        aria-label={`Cycle background theme (current: ${currentLabel})`}
        title={`Theme: ${currentLabel}`}
        onClick={cycleTheme}
        style={{ opacity: restingAlpha }}
        className="flex h-7 w-7 items-center justify-center text-gold transition-opacity hover:!opacity-100 focus:!opacity-100 focus:outline-none"
      >
        <Wand2 size={18} strokeWidth={1.5} />
      </button>

      <button
        type="button"
        aria-label="Open settings"
        onClick={() => navigate({ to: "/settings" })}
        style={{ opacity: restingAlpha }}
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