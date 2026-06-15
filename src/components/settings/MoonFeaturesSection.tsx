import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { updateUserPreferences } from "@/lib/user-preferences-write";
import { useSettings, type Prefs } from "./SettingsContext";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { emitMoonPrefsChanged } from "@/lib/use-moon-prefs";
import { useMoonLocation, setMoonLocation } from "@/lib/moon-location";
import { geocodeBirthPlace } from "@/lib/geocode-cities";
import { useAIEnabled } from "@/lib/use-ai-enabled";
import { FeatureGate } from "@/components/feature-gate/FeatureGate";

/**
 * Moon & Lunar Features section in Settings → Preferences.
 *
 * Q72 — premium tier removed; every feature is unlocked.
 */
export function MoonFeaturesSection() {
  const { user, prefs, setPrefs } = useSettings();
  const [savingKey, setSavingKey] = useState<string | null>(null);
  // EK69 — hide the Lunar AI & Warnings box unless the seeker has AI access.
  const aiEnabled = useAIEnabled();

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

  const masterOn = prefs.moon_features_enabled;

  // EK138 — observer location for moonrise/moonset on the today card.
  const moonLoc = useMoonLocation();
  const [cityInput, setCityInput] = useState("");
  const [cityError, setCityError] = useState(false);
  const useDeviceLocation = () => {
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          setMoonLocation({
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            label: "Current location",
          }),
        () => toast.error("Couldn't get your location. Type a city instead."),
        { timeout: 10000, maximumAge: 60 * 60 * 1000 },
      );
    } else {
      toast.error("Location isn't available here. Type a city instead.");
    }
  };
  const applyCity = () => {
    const hit = geocodeBirthPlace(cityInput);
    if (!hit) {
      setCityError(true);
      return;
    }
    setMoonLocation({
      lat: hit.latitude,
      lon: hit.longitude,
      label: cityInput.trim(),
    });
    setCityInput("");
    setCityError(false);
  };

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

          {prefs.moon_show_carousel && (
            <div className="ml-6 flex flex-col gap-2">
              <Label className="text-sm text-foreground/70">
                Moon times location
              </Label>
              <p className="text-xs text-muted-foreground">
                Sets the moonrise &amp; moonset shown on today&apos;s card. Rise
                and set times depend on where you are.
              </p>
              {moonLoc ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-foreground/80">
                    {moonLoc.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => setMoonLocation(null)}
                    className="rounded-md border border-foreground/20 px-3 py-1.5 text-xs text-foreground/60 transition-colors hover:border-gold/30 hover:text-gold"
                  >
                    Clear
                  </button>
                </div>
              ) : (
                <span className="text-sm text-foreground/50">Not set</span>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={useDeviceLocation}
                  className="rounded-md border border-gold/40 bg-gold/15 px-3 py-2 text-sm text-gold transition-colors hover:bg-gold/20"
                >
                  Use my location
                </button>
              </div>
              <div className="flex flex-col gap-1">
                <input
                  type="text"
                  value={cityInput}
                  onChange={(e) => {
                    setCityInput(e.target.value);
                    setCityError(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      applyCity();
                    }
                  }}
                  placeholder="Or type a city (e.g. Seattle)"
                  className="rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-foreground/40 focus:border-gold/40 focus:outline-none"
                />
                {cityError && (
                  <span className="text-xs text-destructive">
                    City not found — try a major city nearby.
                  </span>
                )}
              </div>
            </div>
          )}

          <FeatureGate enabled={aiEnabled === true}>
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

            <ToggleRow
              id="moon-ai-phase"
              label="AI considers moon phase in readings"
              sublabel="The moon phase at the time of your reading influences the AI interpretation"
              checked={prefs.moon_ai_phase}
              disabled={savingKey === "moon_ai_phase"}
              onChange={(v) => update({ moon_ai_phase: v })}
            />

            <ToggleRow
              id="moon-ai-sign"
              label="AI considers moon sign in readings"
              sublabel="The current moon sign adds astrological depth to your readings"
              checked={prefs.moon_ai_sign}
              disabled={savingKey === "moon_ai_sign"}
              onChange={(v) => update({ moon_ai_sign: v })}
            />

            <ToggleRow
              id="moon-void-warning"
              label="Show void of course warning"
              sublabel="Get notified when the moon is void of course — a time for reflection not action"
              checked={prefs.moon_void_warning}
              disabled={savingKey === "moon_void_warning"}
              onChange={(v) => update({ moon_void_warning: v })}
            />
          </div>
          </FeatureGate>
        </div>
      )}
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
