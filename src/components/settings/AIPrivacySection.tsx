import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { updateUserPreferences } from "@/lib/user-preferences-write";
import { useSettings, type Prefs } from "./SettingsContext";

/**
 * v2.71 — AI & Privacy controls, at the top of Settings → Preferences.
 *
 * Two layered controls:
 *  1. "Use AI features" (master) — a seeker-facing on/off. When off, AI is
 *     never involved and nothing of theirs is sent to the AI provider. It is an
 *     opt-OUT stored in user_preferences.ai_opted_out; it never grants access
 *     the admin didn't (that lives in ai_features_enabled), so the toggle only
 *     appears for accounts that have AI available.
 *  2. "Never send my personal data to AI" — shown when AI is on. Keeps AI
 *     features working but blocks identifiable data (name, birth date/time/
 *     place) from AI requests, while non-identifiable reading content still
 *     flows. Stored in user_preferences.never_send_personal_to_ai and enforced
 *     server-side (deep readings) plus the callAI never-share guard.
 *
 * Numerology/Blueprint is local math (no AI) and works regardless of these.
 */
export function AIPrivacySection() {
  const { user, prefs, setPrefs } = useSettings();
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
    }
  };

  const adminGranted = prefs.ai_features_enabled === true;
  const optedOut = prefs.ai_opted_out === true;
  const aiOn = adminGranted && !optedOut;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">AI &amp; Privacy</h2>
        <p className="text-sm text-muted-foreground">
          Control whether AI is involved in your experience, and what it can see.
        </p>
      </div>

      {adminGranted ? (
        <>
          <Row
            label="Use AI features"
            description="When off, AI is never involved in your experience and none of your content is sent to the AI. Your numerology and blueprint still work — they don't use AI."
            checked={!optedOut}
            disabled={savingKey === "ai_opted_out"}
            onChange={(v) => void update({ ai_opted_out: !v })}
          />
          {aiOn && (
            <Row
              label="Never send my personal data to AI"
              description="Keeps AI features on, but never sends identifiable details — your name and birth date, time, and place — to the AI. Non-identifiable reading content (cards, spread, moon phase) still goes so readings work."
              checked={prefs.never_send_personal_to_ai === true}
              disabled={savingKey === "never_send_personal_to_ai"}
              onChange={(v) => void update({ never_send_personal_to_ai: v })}
            />
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          AI features aren&rsquo;t enabled for your account, so nothing of yours is sent to the AI.
          Your numerology and blueprint still work without AI.
        </p>
      )}
    </section>
  );
}

function Row({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      className="flex items-start justify-between gap-4 rounded-lg p-4"
      style={{ border: "1px solid var(--border-subtle)" }}
    >
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{label}</div>
        <div className="text-sm text-muted-foreground">{description}</div>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}
