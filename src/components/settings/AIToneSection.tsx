/**
 * EP-2 — AI tone preference settings section.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AI_TONES, DEFAULT_AI_TONE, isAITone, type AITone } from "@/lib/ai-tone";
import { useAuth } from "@/lib/auth";

export function AIToneSection() {
  const { user } = useAuth();
  const [tone, setTone] = useState<AITone>(DEFAULT_AI_TONE);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("user_preferences")
        .select("ai_tone")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      const t = (data as { ai_tone?: string } | null)?.ai_tone;
      if (isAITone(t)) setTone(t);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const choose = async (next: AITone) => {
    if (!user?.id || saving || next === tone) return;
    const prev = tone;
    setTone(next);
    setSaving(true);
    const { error } = await supabase
      .from("user_preferences")
      .upsert({ user_id: user.id, ai_tone: next }, { onConflict: "user_id" });
    setSaving(false);
    if (error) {
      setTone(prev);
      toast.error("Couldn't save preference.");
      return;
    }
    toast.success("AI tone updated.");
  };

  return (
    <section className="space-y-3">
      <header>
        <h2
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-heading-md, 1.4rem)",
          }}
        >
          AI tone
        </h2>
        <p
          style={{
            fontStyle: "italic",
            fontSize: "var(--text-body-sm)",
            opacity: 0.7,
            marginTop: 4,
          }}
        >
          How the AI speaks to you. Applied across stalker reflections,
          question themes, and lunation summaries.
        </p>
      </header>
      <div className="flex flex-col gap-2">
        {AI_TONES.map((t) => {
          const active = t.id === tone;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => void choose(t.id)}
              className="w-full text-left p-4"
              style={{
                background: active
                  ? "color-mix(in oklch, var(--gold) 12%, var(--surface-card))"
                  : "var(--surface-card)",
                borderRadius: 14,
                borderLeft: active ? "3px solid var(--gold)" : "3px solid transparent",
                opacity: saving && !active ? 0.7 : 1,
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: "var(--text-body)",
                  color: active ? "var(--gold)" : "var(--color-foreground)",
                }}
              >
                {t.label}
              </div>
              <div
                style={{
                  fontStyle: "italic",
                  fontSize: "var(--text-body-sm)",
                  opacity: 0.65,
                  marginTop: 4,
                }}
              >
                {t.preview}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}