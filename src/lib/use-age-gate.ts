import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

/**
 * v2.72 — Adults-only (18+) gate.
 *
 * Enforces off the OPTIONAL Blueprint birth date (per the chosen model): if a
 * birth date is entered and computes to under 18, the account is locked out of
 * everything except Settings. Users who never enter a birthday are not age-
 * checked (a known limitation of enforcing off the optional field).
 *
 * Re-reads on user change and on the `revalidate` key (route path), so once a
 * seeker corrects their birthday in Settings and navigates, the lock clears.
 */

export function computeAge(birthDate: string, now: Date = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthDate.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || !mo || !d || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  let age = now.getFullYear() - y;
  const curMo = now.getMonth() + 1;
  const hadBirthday = curMo > mo || (curMo === mo && now.getDate() >= d);
  if (!hadBirthday) age -= 1;
  return age;
}

export function useAgeGate(revalidate: string): { underage: boolean; loaded: boolean } {
  const { user } = useAuth();
  const [state, setState] = useState<{ underage: boolean; loaded: boolean }>({
    underage: false,
    loaded: false,
  });

  useEffect(() => {
    let cancelled = false;
    if (!user?.id) {
      setState({ underage: false, loaded: true });
      return;
    }
    void supabase
      .from("user_preferences")
      .select("birth_date")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const bd = (data as { birth_date?: string | null } | null)?.birth_date ?? null;
        const age = bd ? computeAge(bd) : null;
        setState({ underage: age !== null && age < 18, loaded: true });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, revalidate]);

  return state;
}
