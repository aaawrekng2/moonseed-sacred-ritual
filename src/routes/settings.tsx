import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Download, Moon, RotateCcw, Trash2, Upload } from "lucide-react";
import { CardBack } from "@/components/cards/CardBack";
import { Button } from "@/components/ui/button";
import { CARD_BACKS, getStoredCardBack, setStoredCardBack, type CardBackId } from "@/lib/card-backs";
import { useAuth } from "@/lib/auth";
import { BG_PRESETS, useBgGradient } from "@/lib/use-bg-gradient";
import { MAX_RESTING_OPACITY, MIN_RESTING_OPACITY, useRestingOpacity } from "@/lib/use-resting-opacity";
import { useShowLabels } from "@/lib/use-show-labels";
import { SPREAD_META, type SpreadMode } from "@/lib/spreads";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

const TABS = ["Profile", "Blueprint", "Preferences", "Themes", "Data"] as const;
type SettingsTab = (typeof TABS)[number];

const textInput =
  "w-full rounded-xl border border-border/70 bg-background/50 px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-gold/70 focus:ring-2 focus:ring-gold/20";

function useLocalString(key: string, fallback = "") {
  const [value, setValue] = useState(fallback);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setValue(localStorage.getItem(key) ?? fallback);
  }, [key, fallback]);
  const update = (next: string) => {
    setValue(next);
    if (typeof window !== "undefined") localStorage.setItem(key, next);
  };
  return [value, update] as const;
}

function useLocalBoolean(key: string, fallback = false) {
  const [value, setValue] = useState(fallback);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem(key);
    setValue(stored == null ? fallback : stored === "1");
  }, [key, fallback]);
  const update = (next: boolean) => {
    setValue(next);
    if (typeof window !== "undefined") localStorage.setItem(key, next ? "1" : "0");
  };
  return [value, update] as const;
}

function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("Profile");

  return (
    <main className="min-h-screen overflow-y-auto bg-cosmos px-4 pb-28 pt-[calc(env(safe-area-inset-top)+24px)] text-foreground">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <h1 className="font-display text-4xl italic text-gold md:text-5xl">🌙 Settings</h1>

        <div className="settings-tabbar sticky top-0 z-20 -mx-4 overflow-x-auto border-y border-border/40 px-4 py-3 backdrop-blur-xl scrollbar-none">
          <div className="flex min-w-max gap-2">
            {TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                data-active={activeTab === tab}
                onClick={() => setActiveTab(tab)}
                className="settings-tab rounded-full px-4 py-2 font-display text-sm italic"
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {activeTab === "Profile" && <ProfilePanel />}
        {activeTab === "Blueprint" && <BlueprintPanel />}
        {activeTab === "Preferences" && <PreferencesPanel />}
        {activeTab === "Themes" && <ThemesPanel />}
        {activeTab === "Data" && <DataPanel />}
      </div>
    </main>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="font-display text-2xl italic text-gold">{children}</h2>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-2">
      <span className="font-display text-sm italic text-muted-foreground-strong">{label}</span>
      {children}
    </label>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 rounded-xl border border-border/50 bg-background/25 px-4 py-3 text-left transition hover:border-gold/40"
      aria-pressed={checked}
    >
      <span className="font-display text-base italic text-foreground">{label}</span>
      <span className={cn("relative h-6 w-11 rounded-full border transition", checked ? "border-gold/60 bg-gold/25" : "border-border bg-muted/40")}>
        <span className={cn("absolute top-1 h-4 w-4 rounded-full bg-gold transition", checked ? "left-5" : "left-1 opacity-60")} />
      </span>
    </button>
  );
}

function ProfilePanel() {
  const { user } = useAuth();
  const [displayName, setDisplayName] = useLocalString("moonseed:display-name");
  const [intention, setIntention] = useLocalString("moonseed:intention");
  const email = user?.email ?? "Anonymous Moonseed session";

  return (
    <section className="panel grid gap-5">
      <SectionTitle>Profile</SectionTitle>
      <Field label="Display name">
        <input className={textInput} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" />
      </Field>
      <Field label="Email">
        <input className={cn(textInput, "text-muted-foreground")} value={email} readOnly />
      </Field>
      <Field label="Intention">
        <textarea className={cn(textInput, "min-h-28 resize-none")} value={intention} onChange={(e) => setIntention(e.target.value)} placeholder="What are you tending in this season?" />
      </Field>
    </section>
  );
}

function BlueprintPanel() {
  const [birthDate, setBirthDate] = useLocalString("moonseed:birth-date");
  const [birthTime, setBirthTime] = useLocalString("moonseed:birth-time");
  const [birthPlace, setBirthPlace] = useLocalString("moonseed:birth-place");
  const [sunSign, setSunSign] = useLocalString("moonseed:sun-sign");
  const [risingSign, setRisingSign] = useLocalString("moonseed:rising-sign");

  return (
    <section className="panel grid gap-5">
      <SectionTitle>Blueprint</SectionTitle>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Birth date"><input className={textInput} type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} /></Field>
        <Field label="Birth time"><input className={textInput} type="time" value={birthTime} onChange={(e) => setBirthTime(e.target.value)} /></Field>
      </div>
      <Field label="Birth place"><input className={textInput} value={birthPlace} onChange={(e) => setBirthPlace(e.target.value)} placeholder="City, region" /></Field>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Sun sign"><input className={textInput} value={sunSign} onChange={(e) => setSunSign(e.target.value)} placeholder="Pisces" /></Field>
        <Field label="Rising sign"><input className={textInput} value={risingSign} onChange={(e) => setRisingSign(e.target.value)} placeholder="Cancer" /></Field>
      </div>
    </section>
  );
}

function PreferencesPanel() {
  const [defaultSpread, setDefaultSpread] = useLocalString("moonseed:default-spread", "daily");
  const [showReversed, setShowReversed] = useLocalBoolean("moonseed:show-reversed", false);
  const [moonPhase, setMoonPhase] = useLocalBoolean("moonseed:moon-phase", true);
  const [newMoon, setNewMoon] = useLocalBoolean("moonseed:new-moon-rituals", true);
  const { showLabels, setShowLabels } = useShowLabels();
  const { opacity, setOpacity } = useRestingOpacity();
  const spreadOptions = useMemo(() => Object.keys(SPREAD_META) as SpreadMode[], []);

  return (
    <div className="grid gap-4">
      <section className="panel grid gap-5">
        <SectionTitle>Preferences</SectionTitle>
        <Field label="Default spread">
          <select className={textInput} value={defaultSpread} onChange={(e) => setDefaultSpread(e.target.value)}>
            {spreadOptions.map((spread) => <option key={spread} value={spread}>{SPREAD_META[spread].label}</option>)}
          </select>
        </Field>
        <ToggleRow label="Show reversed cards" checked={showReversed} onChange={setShowReversed} />
        <ToggleRow label="Show spread labels" checked={showLabels} onChange={setShowLabels} />
      </section>
      <section className="panel grid gap-4">
        <SectionTitle>Moon features</SectionTitle>
        <ToggleRow label="Moon phase display" checked={moonPhase} onChange={setMoonPhase} />
        <ToggleRow label="New moon rituals" checked={newMoon} onChange={setNewMoon} />
      </section>
      <section className="panel grid gap-4">
        <SectionTitle>Interface fade</SectionTitle>
        <input className="w-full accent-gold" type="range" min={MIN_RESTING_OPACITY} max={MAX_RESTING_OPACITY} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} />
      </section>
    </div>
  );
}

function ThemesPanel() {
  const [cardBack, setCardBack] = useState<CardBackId>("celestial");
  const { preset, setPreset } = useBgGradient();
  const [theme, setTheme] = useLocalString("moonseed:accent-theme", "default");

  useEffect(() => setCardBack(getStoredCardBack()), []);
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (theme === "default") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const chooseBack = (id: CardBackId) => {
    setCardBack(id);
    setStoredCardBack(id);
  };

  return (
    <div className="grid gap-4">
      <section className="panel grid gap-4">
        <SectionTitle>Card Back</SectionTitle>
        <div className="grid grid-cols-5 gap-3">
          {CARD_BACKS.map((back) => (
            <button key={back.id} type="button" onClick={() => chooseBack(back.id)} className={cn("flex flex-col items-center gap-2 rounded-2xl border p-2 transition", cardBack === back.id ? "border-gold shadow-glow" : "border-border/60")} aria-label={`Use ${back.label} card back`}>
              <CardBack id={back.id} width={42} />
              <span className="font-display text-[11px] italic text-muted-foreground-strong">{back.label}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="panel grid gap-4">
        <SectionTitle>Accent Color</SectionTitle>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {[
            ["default", "Gold"],
            ["emerald-isle", "Emerald"],
            ["rose-quartz", "Rose"],
            ["celestial-blue", "Blue"],
            ["violet-flame", "Violet"],
          ].map(([value, label]) => (
            <button key={value} type="button" onClick={() => setTheme(value)} className={cn("rounded-full border px-3 py-2 font-display text-sm italic transition", theme === value ? "border-gold bg-gold/15 text-gold" : "border-border/60 text-muted-foreground")}>{label}</button>
          ))}
        </div>
        <Field label="Custom color · Premium"><input className={textInput} type="color" disabled /></Field>
      </section>
      <section className="panel grid gap-4">
        <SectionTitle>Background Gradient</SectionTitle>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {BG_PRESETS.map((bg) => (
            <button key={bg.value} type="button" onClick={() => setPreset(bg.value)} className={cn("rounded-xl border px-3 py-3 font-display text-sm italic transition", preset === bg.value ? "border-gold text-gold" : "border-border/60 text-muted-foreground")} style={{ background: `linear-gradient(135deg, ${bg.left}, ${bg.right})` }}>{bg.label}</button>
          ))}
        </div>
      </section>
      <section className="panel grid gap-3">
        <SectionTitle>Heading Font · Premium</SectionTitle>
        <button className="rounded-xl border border-border/60 px-4 py-3 text-left font-display italic text-muted-foreground" disabled>Cormorant Garamond</button>
      </section>
      <section className="panel grid gap-3">
        <SectionTitle>Saved Themes · Premium</SectionTitle>
        <button className="rounded-xl border border-border/60 px-4 py-3 text-left font-display italic text-muted-foreground" disabled>No saved themes yet</button>
      </section>
    </div>
  );
}

function DataPanel() {
  const exportData = () => {
    if (typeof window === "undefined") return;
    const data = Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith("moonseed:")));
    const blob = new Blob([JSON.stringify({ app: "Moonseed", data }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "moonseed-data.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const clearData = () => {
    if (typeof window === "undefined") return;
    const ok = window.confirm("Delete Moonseed settings stored on this device?");
    if (!ok) return;
    Object.keys(localStorage).filter((key) => key.startsWith("moonseed:")).forEach((key) => localStorage.removeItem(key));
    window.location.reload();
  };

  return (
    <section className="panel grid gap-5">
      <SectionTitle>Data</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-3">
        <Button type="button" onClick={exportData} className="gap-2 rounded-full"><Download className="h-4 w-4" /> Export</Button>
        <Button type="button" variant="secondary" className="gap-2 rounded-full"><Upload className="h-4 w-4" /> Import</Button>
        <Button type="button" variant="outline" onClick={clearData} className="gap-2 rounded-full"><Trash2 className="h-4 w-4" /> Delete</Button>
      </div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground"><Moon className="h-4 w-4 text-gold" /> Moonseed keeps your ritual preferences close.</div>
      <button type="button" onClick={() => window.location.reload()} className="inline-flex items-center gap-2 font-display text-sm italic text-gold"><RotateCcw className="h-4 w-4" /> Refresh settings</button>
    </section>
  );
}