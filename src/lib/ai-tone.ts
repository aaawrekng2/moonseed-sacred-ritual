/**
 * EP-1/3 — AI tone preference.
 *
 * One source of truth for which voice the AI uses across stalker
 * reflections, question themes, and lunation summaries.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type AITone = "oracular" | "reflective" | "direct" | "poetic";

export const AI_TONES: { id: AITone; label: string; preview: string }[] = [
  {
    id: "oracular",
    label: "Oracular",
    preview:
      "The Moon has crossed your path — she keeps asking what truths you'd rather not see by daylight.",
  },
  {
    id: "reflective",
    label: "Reflective",
    preview:
      "You've drawn The Moon repeatedly when asking about rest. What might keep bringing it back?",
  },
  {
    id: "direct",
    label: "Direct",
    preview:
      "The Moon is showing up a lot for you. It usually means intuition or something you're not letting yourself see.",
  },
  {
    id: "poetic",
    label: "Poetic",
    preview:
      "Seven moons, one card, a steady tide — she returns the way unanswered questions do.",
  },
];

export const DEFAULT_AI_TONE: AITone = "reflective";

export const TONE_FRAGMENTS: Record<AITone, string> = {
  oracular:
    "Speak in the voice of a sacred oracle. Use moon imagery, metaphor, and mystical language. " +
    "Address the seeker as if you are reading the deeper currents of their soul.",
  reflective:
    "Speak as a thoughtful, grounded counselor. Use clear language with gentle warmth. " +
    "Invite curiosity and self-inquiry without mystical flourish.",
  direct:
    "Speak plainly and concisely. No poetry, no metaphor. Tell the seeker what the pattern shows them " +
    "in the most useful, straightforward language. Like a trusted friend who reads tarot.",
  poetic:
    "Speak with literary precision and restrained imagery. Short sentences. " +
    "Use metaphor sparingly but with weight. Avoid mysticism; favor lyrical clarity.",
};

export function isAITone(v: unknown): v is AITone {
  return v === "oracular" || v === "reflective" || v === "direct" || v === "poetic";
}

export function useAITone(userId: string | undefined): {
  tone: AITone;
  loading: boolean;
  setTone: (next: AITone) => void;
} {
  const [tone, setToneState] = useState<AITone>(DEFAULT_AI_TONE);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("user_preferences")
        .select("ai_tone")
        .eq("user_id", userId)
        .maybeSingle();
      if (cancelled) return;
      const t = isAITone((data as { ai_tone?: string } | null)?.ai_tone)
        ? ((data as { ai_tone: AITone }).ai_tone)
        : DEFAULT_AI_TONE;
      setToneState(t);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);
  return { tone, loading, setTone: setToneState };
}

/** Server-side reader (used by AI server fns). */
export async function getAIToneServerSide(
  supabaseClient: { from: (t: string) => any },
  userId: string,
): Promise<AITone> {
  try {
    const { data } = await supabaseClient
      .from("user_preferences")
      .select("ai_tone")
      .eq("user_id", userId)
      .maybeSingle();
    const t = (data as { ai_tone?: string } | null)?.ai_tone;
    return isAITone(t) ? t : DEFAULT_AI_TONE;
  } catch {
    return DEFAULT_AI_TONE;
  }
}