import { useMemo, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { CalendarIcon, Loader2 } from "lucide-react";
import { updateUserPreferences } from "@/lib/user-preferences-write";
import { getSunSign, type SunSign } from "@/lib/sun-sign";
import { calculateRisingSign, SIGN_EMOJI } from "@/lib/rising-sign";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useSettings, type Prefs } from "./SettingsContext";
import { MoonFeaturesSection } from "./MoonFeaturesSection";
import {
  useAutoRememberQuestion,
  useRememberScope,
  type RememberScope,
} from "@/lib/use-auto-remember-question";
import { AuthScreen } from "@/components/auth/AuthScreen";

/**
 * Settings page section components, ported from the source bundle and
 * adapted to Moonseed's personal-only schema (no dual-mode, no
 * outcome reminders, no business-mode toggles). Each top-level export
 * pulls its data from {@link useSettings} so all panels stay in sync
 * with the same Supabase row.
 */

type SpreadType = "single" | "three_card" | "celtic_cross";

const LIFE_AREAS: Array<{ value: string; label: string }> = [
  { value: "general", label: "General guidance" },
  { value: "love", label: "Love & relationships" },
  { value: "career", label: "Career & purpose" },
  { value: "growth", label: "Personal growth" },
  { value: "creativity", label: "Creativity" },
  { value: "spirituality", label: "Spirituality" },
];

/* ----------------------- Reusable shell ----------------------- */

export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

/**
 * Shared className for primary "save" buttons in the Settings sections.
 * Pair with `variant="ghost"` so the default Button base styles
 * (`bg-primary` / `hover:bg-primary/90`) don't bleed through and tint
 * the gold gradient orange. The ghost base is transparent — we paint the
 * full gold gradient + glow ourselves.
 */
const goldButton =
  "bg-gold-gradient text-gold-foreground shadow-glow hover:opacity-95 hover:bg-gold-gradient";

/* ------------------------- Profile ------------------------- */

export function ProfileSection() {
  const { user, prefs, setPrefs, loaded } = useSettings();
  return (
    <ProfileSectionInner
      key={loaded ? "loaded" : "empty"}
      user={user}
      prefs={prefs}
      setPrefs={setPrefs}
    />
  );
}

function ProfileSectionInner({
  user,
  prefs,
  setPrefs,
}: {
  user: { id: string; email?: string };
  prefs: Prefs;
  setPrefs: (p: Prefs) => void;
}) {
  const [name, setName] = useState(prefs.display_name ?? "");
  const [saving, setSaving] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const isAnonymous = !user.email;

  const save = async () => {
    if (!name.trim()) {
      toast.error("Display name is required.");
      return;
    }
    setSaving(true);
    const { error } = await updateUserPreferences(user.id, {
      display_name: name.trim(),
    });
    setSaving(false);
    if (error) {
      toast.error("Something went wrong. Please try again.");
      return;
    }
    setPrefs({ ...prefs, display_name: name.trim() });
    toast.success("Changes saved", { icon: "✓" });
  };

  return (
    <SettingsSection title="Your Profile">
      {isAnonymous ? (
        <div className="flex flex-col items-center gap-6 px-2 py-6 text-center">
          <div className="flex flex-col gap-3">
            <h2
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: 26,
                fontWeight: 400,
                color: "var(--foreground)",
                opacity: 0.95,
                lineHeight: 1.3,
                margin: 0,
              }}
            >
              Save your sacred work
            </h2>
            <p
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: 14,
                color: "var(--foreground)",
                opacity: 0.55,
                lineHeight: 1.7,
                maxWidth: 320,
                margin: "0 auto",
              }}
            >
              Your readings, guides, and memories live only on this device right now. Without an account, they can be lost forever if you clear your browser or switch devices.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setAuthOpen(true)}
            className="w-full max-w-xs rounded-xl py-4 transition-opacity active:opacity-70"
            style={{
              background: "color-mix(in oklab, var(--gold) 15%, transparent)",
              border: "1px solid color-mix(in oklab, var(--gold) 45%, transparent)",
              color: "var(--gold)",
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: 16,
              letterSpacing: "0.05em",
              cursor: "pointer",
            }}
          >
            Sign in or Create Account
          </button>

          <button
            type="button"
            onClick={() => {
              try {
                localStorage.setItem("auth-nudge-dismissed-date", "permanent");
                toast.success("We won't remind you again.");
              } catch {
                // ignore
              }
            }}
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: 11,
              color: "var(--foreground)",
              opacity: 0.2,
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
            }}
          >
            Don't remind me
          </button>

          {authOpen && (
            <AuthScreen
              onClose={() => setAuthOpen(false)}
              onSuccess={() => setAuthOpen(false)}
            />
          )}
        </div>
      ) : (
        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="display-name">Display name</Label>
            <Input
              id="display-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={80}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email address</Label>
            <Input id="email" value={user.email ?? ""} readOnly disabled />
            <p className="text-xs text-muted-foreground">
              To change your email, please contact support.
            </p>
          </div>

          <IntentionField user={user} prefs={prefs} setPrefs={setPrefs} />

          <div>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: 13,
                color: "var(--gold)",
                opacity: saving ? 0.4 : 0.75,
                background: "none",
                border: "none",
                padding: "4px 0",
                cursor: saving ? "default" : "pointer",
                textAlign: "left",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save changes
            </button>
          </div>
        </div>
      )}
    </SettingsSection>
  );
}

function IntentionField({
  user,
  prefs,
  setPrefs,
}: {
  user: { id: string };
  prefs: Prefs;
  setPrefs: (p: Prefs) => void;
}) {
  const [intention, setIntention] = useState(prefs.initial_intention ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const { error } = await updateUserPreferences(user.id, {
      initial_intention: intention.trim() || null,
    });
    setSaving(false);
    if (error) {
      toast.error("Something went wrong. Please try again.");
      return;
    }
    setPrefs({ ...prefs, initial_intention: intention.trim() || null });
    toast.success("Intention updated", { icon: "✓" });
  };

  return (
    <div className="space-y-2 rounded-lg border border-border/60 bg-card/40 p-4">
      <Label htmlFor="intention" className="text-sm">
        Your Intention
      </Label>
      <p className="text-xs text-muted-foreground">
        The intention you set when you joined. Update it as your journey evolves.
      </p>
      <Textarea
        id="intention"
        rows={3}
        value={intention}
        onChange={(e) => setIntention(e.target.value)}
        placeholder="What are you working through right now?"
        maxLength={1000}
      />
      <div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: 13,
            color: "var(--gold)",
            opacity: saving ? 0.4 : 0.7,
            background: "none",
            border: "none",
            padding: "4px 0",
            cursor: saving ? "default" : "pointer",
            textAlign: "left",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Save intention
        </button>
      </div>
    </div>
  );
}

/* ------------------------- Blueprint ------------------------- */

export function BlueprintSection() {
  const { user, prefs, setPrefs, loaded } = useSettings();
  return (
    <BlueprintSectionInner
      key={loaded ? "loaded" : "empty"}
      user={user}
      prefs={prefs}
      setPrefs={setPrefs}
    />
  );
}

function BlueprintSectionInner({
  user,
  prefs,
  setPrefs,
}: {
  user: { id: string };
  prefs: Prefs;
  setPrefs: (p: Prefs) => void;
}) {
  const [birthDate, setBirthDate] = useState<Date | undefined>(
    prefs.birth_date ? new Date(prefs.birth_date) : undefined,
  );
  const [birthTime, setBirthTime] = useState(prefs.birth_time ?? "");
  const [birthPlace, setBirthPlace] = useState(prefs.birth_place ?? "");
  const [saving, setSaving] = useState(false);

  const sunSign = useMemo<SunSign | null>(
    () => (birthDate ? getSunSign(birthDate) : null),
    [birthDate],
  );
  const risingSign = useMemo(
    () => calculateRisingSign(sunSign, birthTime || null, birthPlace || null),
    [sunSign, birthTime, birthPlace],
  );

  const save = async () => {
    setSaving(true);
    const { error } = await updateUserPreferences(user.id, {
      birth_date: birthDate ? format(birthDate, "yyyy-MM-dd") : null,
      birth_time: birthTime || null,
      birth_place: birthPlace.trim() || null,
      sun_sign: sunSign,
      rising_sign: risingSign,
    });
    setSaving(false);
    if (error) {
      toast.error("Something went wrong. Please try again.");
      return;
    }
    setPrefs({
      ...prefs,
      birth_date: birthDate ? format(birthDate, "yyyy-MM-dd") : null,
      birth_time: birthTime || null,
      birth_place: birthPlace.trim() || null,
      sun_sign: sunSign,
      rising_sign: risingSign,
    });
    toast.success("Changes saved", { icon: "✓" });
  };

  return (
    <SettingsSection
      title="Your Cosmic Blueprint"
      description="Your birth details personalize your AI interpretations with astrological context."
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <Label>Date of birth</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "h-11 w-full justify-start text-left font-normal",
                  !birthDate && "text-muted-foreground",
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {birthDate ? format(birthDate, "PPP") : <span>Pick a date</span>}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              side="bottom"
              align="start"
              sideOffset={4}
              collisionPadding={12}
              avoidCollisions
              className="w-auto p-0"
            >
              <Calendar
                mode="single"
                selected={birthDate}
                onSelect={setBirthDate}
                captionLayout="dropdown"
                defaultMonth={birthDate ?? new Date(1995, 0)}
                disabled={(d) => d > new Date() || d < new Date("1900-01-01")}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
        </div>

        <div className="space-y-2">
          <Label htmlFor="birth-time">Time of birth</Label>
          <Input
            id="birth-time"
            type="time"
            value={birthTime}
            onChange={(e) => setBirthTime(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Your rising sign requires your birth time.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="birth-place">Place of birth</Label>
          <Input
            id="birth-place"
            value={birthPlace}
            onChange={(e) => setBirthPlace(e.target.value)}
            placeholder="e.g. Lisbon, Portugal"
          />
        </div>

        {(sunSign || risingSign) && (
          <div className="flex flex-wrap gap-2">
            {sunSign && (
              <Badge variant="outline" className="border-gold/40 text-gold">
                ☀️ {sunSign}
              </Badge>
            )}
            {risingSign && (
              <Badge variant="outline" className="border-mystic/60 text-foreground">
                ⬆️ {risingSign} Rising {SIGN_EMOJI[risingSign]}
              </Badge>
            )}
          </div>
        )}

        <div>
          <Button variant="ghost" onClick={save} disabled={saving} className={goldButton}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save Blueprint
          </Button>
        </div>
      </div>
    </SettingsSection>
  );
}

/* ------------------------- Preferences (combined) ------------------------- */

export function PreferencesTab() {
  const { user, prefs, setPrefs, loaded } = useSettings();
  return (
    <div className="space-y-12" key={loaded ? "loaded" : "empty"}>
      <ReadingPreferencesSection user={user} prefs={prefs} setPrefs={setPrefs} />
      <MoonFeaturesSection />
      <MemorySection user={user} prefs={prefs} setPrefs={setPrefs} />
    </div>
  );
}

function ReadingPreferencesSection({
  user,
  prefs,
  setPrefs,
}: {
  user: { id: string };
  prefs: Prefs;
  setPrefs: (p: Prefs) => void;
}) {
  const [spread, setSpread] = useState<SpreadType>(prefs.default_spread as SpreadType);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const { error } = await updateUserPreferences(user.id, {
      default_spread: spread,
    });
    setSaving(false);
    if (error) {
      toast.error("Something went wrong. Please try again.");
      return;
    }
    setPrefs({ ...prefs, default_spread: spread });
    toast.success("Changes saved", { icon: "✓" });
  };

  return (
    <SettingsSection title="Reading Preferences">
      <div className="space-y-5">
        <div className="space-y-2">
          <Label>Default spread</Label>
          <Select value={spread} onValueChange={(v) => setSpread(v as SpreadType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="single">Daily Draw</SelectItem>
              <SelectItem value="three_card">Three Card</SelectItem>
              <SelectItem value="celtic_cross">Celtic Cross</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <AutoRememberQuestionRow />

        <Button variant="ghost" onClick={save} disabled={saving} className={goldButton}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Save Preferences
        </Button>
      </div>
    </SettingsSection>
  );
}

function AutoRememberQuestionRow() {
  const [autoRemember, setAutoRemember] = useAutoRememberQuestion();
  const [scope, setScope] = useRememberScope();
  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-card/40 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor="auto-remember-question" className="text-sm">
            Auto-remember my question
          </Label>
          <p className="text-xs text-muted-foreground">
            When on, your question on the home screen is kept across sessions
            as soon as you start typing — no extra tap needed.
          </p>
        </div>
        <Switch
          id="auto-remember-question"
          checked={autoRemember}
          onCheckedChange={(next) => {
            setAutoRemember(next);
            toast.success(
              next ? "Auto-remember on" : "Auto-remember off",
              { icon: "✓" },
            );
          }}
        />
      </div>
      <div className="space-y-2 border-t border-border/40 pt-3">
        <Label htmlFor="remember-scope" className="text-sm">
          Where to remember
        </Label>
        <Select
          value={scope}
          onValueChange={(v) => {
            const next = v as RememberScope;
            setScope(next);
            toast.success(
              next === "cloud"
                ? "Syncing across your browsers"
                : "Kept on this device only",
              { icon: "✓" },
            );
          }}
        >
          <SelectTrigger id="remember-scope">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="device">This device only</SelectItem>
            <SelectItem value="cloud">Across my browsers</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {scope === "cloud"
            ? "Your remembered question follows you wherever you sign in."
            : "Your remembered question stays in this browser only."}
        </p>
      </div>
    </div>
  );
}

/* `LIFE_AREAS` is exported for any future panel that wants the same
 * canonical list (Daily Draw, Today picker, etc.). */
export { LIFE_AREAS };

/* ------------------------- Memory ------------------------- */

function MemorySection({
  user,
  prefs,
  setPrefs,
}: {
  user: { id: string };
  prefs: Prefs;
  setPrefs: (p: Prefs) => void;
}) {
  const [saving, setSaving] = useState(false);

  const toggle = async (next: boolean) => {
    setSaving(true);
    const previous = prefs.memory_ai_permission;
    setPrefs({ ...prefs, memory_ai_permission: next });
    const { error } = await updateUserPreferences(user.id, {
      memory_ai_permission: next,
    });
    setSaving(false);
    if (error) {
      setPrefs({ ...prefs, memory_ai_permission: previous });
      toast.error("Couldn't save your preference.");
      return;
    }
    toast.success(next ? "Memory enabled" : "Memory paused", { icon: "✓" });
  };

  return (
    <SettingsSection
      title="Memory & Threads"
      description="When on, your guide notices recurring symbols across your readings and weaves that memory into future interpretations. Only patterns and tags are remembered — never the raw text of past readings."
    >
      <div className="flex items-start justify-between gap-4 rounded-lg border border-border/60 bg-card/40 p-4">
        <div className="space-y-0.5">
          <Label htmlFor="memory-ai-permission" className="text-sm">
            Allow symbolic memory
          </Label>
          <p className="text-xs text-muted-foreground">
            Pause this anytime. Existing threads stay visible in your Journal but won't influence new readings.
          </p>
        </div>
        <Switch
          id="memory-ai-permission"
          checked={prefs.memory_ai_permission}
          disabled={saving}
          onCheckedChange={toggle}
        />
      </div>
    </SettingsSection>
  );
}