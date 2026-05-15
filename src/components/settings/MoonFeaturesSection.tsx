import { useState } from "react";
import { Lock } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { updateUserPreferences } from "@/lib/user-preferences-write";
import { usePremium } from "@/lib/premium";
import { PremiumModal } from "@/components/premium/PremiumModal";
import { useSettings, type Prefs } from "./SettingsContext";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { emitMoonPrefsChanged } from "@/lib/use-moon-prefs";

/**
 * Moon & Lunar Features section in Settings → Preferences.
 *
 * In Tarot Seed every feature is unlocked (`usePremium` returns
 * `isPremium: true`) so the locked-state branches are present for
 * source-bundle parity but never render in practice.
 */
export function MoonFeaturesSection() {
  const { user, prefs, setPrefs } = useSettings();
  const { isPremium } = usePremium(user.id);
  const [premiumOpen, setPremiumOpen] = useState(false);
  const [premiumFeature, setPremiumFeature] = useState("Moon Features");
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const update = async (patch: Partial<Prefs>) => {
    const key = Object.keys(patch)[0];
    setSavingKey(key);
    const next = { ...prefs, ...patch };
    setPrefs(next);
    const { error } = await updateUserPreferences(user.id, patch);
    setSavingKey(null);
    if (error) {
      toast.error("Couldn't save your preference.");
      setPrefs(prefs);
      return;
    }
    // CV — broadcast home-page-relevant moon prefs so the home page
    // updates without a refresh.
    if (
      "moon_features_enabled" in patch ||
      "moon_show_carousel" in patch ||
      "moon_carousel_size" in patch
    ) {
      emitMoonPrefsChanged({
        ...(typeof patch.moon_features_enabled === "boolean"
          ? { moon_features_enabled: patch.moon_features_enabled }
          : {}),
        ...(typeof patch.moon_show_carousel === "boolean"
          ? { moon_show_carousel: patch.moon_show_carousel }
          : {}),
        ...(patch.moon_carousel_size === "small" ||
        patch.moon_carousel_size === "medium" ||
        patch.moon_carousel_size === "large"
          ? { moon_carousel_size: patch.moon_carousel_size }
          : {}),
      });
    }
  };

  const tryPremium = (feature: string): boolean => {
    if (isPremium) return true;
    setPremiumFeature(feature);
    setPremiumOpen(true);
    return false;
  };

  const masterOn = prefs.moon_features_enabled;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <span aria-hidden>🌙</span>
          <span>Moon &amp; Lunar Features</span>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Bring lunar awareness into your daily practice.
        </p>
      </div>

      <ToggleRow
        id="moon-features-enabled"
        label="Moon & Lunar Features"
        sublabel="Master switch — when off, hides the entire moon system"
        checked={masterOn}
        disabled={savingKey === "moon_features_enabled"}
        onChange={(v) => update({ moon_features_enabled: v })}
      />

      {masterOn && (
        <div className="space-y-3 rounded-lg border border-border/40 bg-card/30 p-4">
          <ToggleRow
            id="moon-show-carousel"
            label="Show moon phase carousel"
            sublabel="See the lunar cycle on your Today page"
            checked={prefs.moon_show_carousel}
            disabled={savingKey === "moon_show_carousel"}
            onChange={(v) => update({ moon_show_carousel: v })}
          />

          {prefs.moon_show_carousel && (
            <div className="ml-6 flex flex-col gap-2">
              <Label className="text-sm text-foreground/70">Carousel size</Label>
              <div className="flex gap-2">
                {(["small", "medium", "large"] as const).map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => update({ moon_carousel_size: size })}
                    disabled={savingKey === "moon_carousel_size"}
                    className={cn(
                      "flex-1 rounded-md border px-3 py-2 text-sm capitalize transition-colors disabled:opacity-60",
                      prefs.moon_carousel_size === size
                        ? "border-gold/40 bg-gold/15 text-gold"
                        : "border-foreground/20 bg-transparent text-foreground/60 hover:border-gold/30 hover:text-gold",
                    )}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-4 rounded-xl border border-gold/40 bg-gold/[0.05] p-4 shadow-[0_0_24px_-12px_var(--gold)]">
            <div className="space-y-1">
              <h3 className="flex items-center gap-2 text-sm font-normal text-foreground">
                <span aria-hidden className="text-base leading-none">✨</span>
                <span>Lunar AI &amp; Warnings</span>
              </h3>
              <p className="text-xs text-muted-foreground">
                Add cosmic depth to your readings.
              </p>
            </div>

            <PremiumToggleRow
              id="moon-ai-phase"
              label="AI considers moon phase in readings"
              sublabel="The moon phase at the time of your reading influences the AI interpretation"
              isPremium={isPremium}
              checked={isPremium ? prefs.moon_ai_phase : false}
              disabled={savingKey === "moon_ai_phase"}
              onChange={(v) => {
                if (!tryPremium("Lunar AI Context")) return;
                void update({ moon_ai_phase: v });
              }}
              onLockedClick={() => tryPremium("Lunar AI Context")}
            />

            <PremiumToggleRow
              id="moon-ai-sign"
              label="AI considers moon sign in readings"
              sublabel="The current moon sign adds astrological depth to your readings"
              isPremium={isPremium}
              checked={isPremium ? prefs.moon_ai_sign : false}
              disabled={savingKey === "moon_ai_sign"}
              onChange={(v) => {
                if (!tryPremium("Lunar AI Context")) return;
                void update({ moon_ai_sign: v });
              }}
              onLockedClick={() => tryPremium("Lunar AI Context")}
            />

            <PremiumToggleRow
              id="moon-void-warning"
              label="Show void of course warning"
              sublabel="Get notified when the moon is void of course — a time for reflection not action"
              isPremium={isPremium}
              checked={isPremium ? prefs.moon_void_warning : false}
              disabled={savingKey === "moon_void_warning"}
              onChange={(v) => {
                if (!tryPremium("Void of Course Warning")) return;
                void update({ moon_void_warning: v });
              }}
              onLockedClick={() => tryPremium("Void of Course Warning")}
            />
          </div>
        </div>
      )}

      <PremiumModal
        open={premiumOpen}
        onOpenChange={setPremiumOpen}
        featureName={premiumFeature}
      />
    </section>
  );
}

function ToggleRow({
  id,
  label,
  sublabel,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  sublabel: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border/60 bg-card/40 p-4">
      <div className="space-y-0.5">
        <Label htmlFor={id} className="text-sm">
          {label}
        </Label>
        <p className="text-xs text-muted-foreground">{sublabel}</p>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </div>
  );
}

function PremiumToggleRow({
  id,
  label,
  sublabel,
  isPremium,
  checked,
  disabled,
  onChange,
  onLockedClick,
}: {
  id: string;
  label: string;
  sublabel: string;
  isPremium: boolean;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  onLockedClick: () => void;
}) {
  if (!isPremium) {
    return (
      <button
        type="button"
        onClick={onLockedClick}
        className={cn(
          "flex w-full items-start justify-between gap-4 rounded-lg border border-border/60 bg-card/40 p-4 text-left",
          "transition-colors hover:bg-gold/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        )}
        aria-label={`${label} — locked, unlock with Premium`}
      >
        <div className="space-y-0.5 opacity-80">
          <span className="block text-sm">{label}</span>
          <span className="block text-xs text-muted-foreground">{sublabel}</span>
        </div>
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold">
          <Lock className="h-3 w-3" />
        </span>
      </button>
    );
  }

  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border/60 bg-card/40 p-4">
      <div className="space-y-0.5">
        <Label htmlFor={id} className="text-sm">
          {label}
        </Label>
        <p className="text-xs text-muted-foreground">{sublabel}</p>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </div>
  );
}