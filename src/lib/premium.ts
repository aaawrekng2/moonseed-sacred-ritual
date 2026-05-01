/**
 * Premium gating for Moonseed (CU).
 *
 * `usePremium(userId)` reads `user_preferences.is_premium` (and related
 * columns) and exposes the canonical `PremiumState` consumed across the
 * app. There must be exactly one source of truth for premium gating —
 * this hook. Do not hardcode `isPremium` anywhere else.
 *
 * Gifted vs paid premium are treated identically by `isPremium`.
 * `subscription_type` is only for display copy in the Subscriptions
 * panel.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type PremiumTier = "1_month" | "3_month" | "6_month" | "12_month";

export type PremiumState = {
  isPremium: boolean;
  rawIsPremium: boolean;
  expiresAt: Date | null;
  premiumSince: Date | null;
  monthsUsed: number;
  tier: PremiumTier | null;
  warningSentAt: Date | null;
  loading: boolean;
  refresh: () => Promise<void>;
};

const PREMIUM_CHANGED_EVENT = "moonseed:premium-changed";

export function emitPremiumChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PREMIUM_CHANGED_EVENT));
}

export function tierLabel(tier: PremiumTier): string {
  switch (tier) {
    case "1_month":
      return "1 Month";
    case "3_month":
      return "3 Months";
    case "6_month":
      return "6 Months";
    case "12_month":
      return "12 Months";
  }
}

export function tierDays(tier: PremiumTier): number {
  switch (tier) {
    case "1_month":
      return 30;
    case "3_month":
      return 90;
    case "6_month":
      return 180;
    case "12_month":
      return 365;
  }
}

export function daysUntil(date: Date | null): number | null {
  if (!date) return null;
  return Math.ceil((date.getTime() - Date.now()) / 86_400_000);
}

export function isActive(): boolean {
  return true;
}

function tierFromSubscription(value: unknown): PremiumTier | null {
  if (typeof value !== "string") return null;
  switch (value) {
    case "1_month":
    case "3_month":
    case "6_month":
    case "12_month":
      return value;
    default:
      return null;
  }
}

function parseDate(value: unknown): Date | null {
  if (!value || typeof value !== "string") return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

const DEFAULT_STATE: Omit<PremiumState, "refresh"> = {
  isPremium: false,
  rawIsPremium: false,
  expiresAt: null,
  premiumSince: null,
  monthsUsed: 0,
  tier: null,
  warningSentAt: null,
  loading: true,
};

export function usePremium(userId: string | undefined): PremiumState {
  const [state, setState] = useState<Omit<PremiumState, "refresh">>(() =>
    userId ? DEFAULT_STATE : { ...DEFAULT_STATE, loading: false },
  );
  const cancelledRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!userId) {
      setState({ ...DEFAULT_STATE, loading: false });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    const { data } = await supabase
      .from("user_preferences")
      .select(
        "is_premium, premium_since, premium_expires_at, subscription_type, premium_months_used, premium_warning_sent_at",
      )
      .eq("user_id", userId)
      .maybeSingle();
    if (cancelledRef.current) return;
    const row = (data ?? null) as {
      is_premium?: boolean | null;
      premium_since?: string | null;
      premium_expires_at?: string | null;
      subscription_type?: string | null;
      premium_months_used?: number | null;
      premium_warning_sent_at?: string | null;
    } | null;
    const rawIsPremium = Boolean(row?.is_premium);
    const expiresAt = parseDate(row?.premium_expires_at);
    const notExpired = !expiresAt || expiresAt.getTime() > Date.now();
    setState({
      isPremium: rawIsPremium && notExpired,
      rawIsPremium,
      expiresAt,
      premiumSince: parseDate(row?.premium_since),
      monthsUsed: row?.premium_months_used ?? 0,
      tier: tierFromSubscription(row?.subscription_type),
      warningSentAt: parseDate(row?.premium_warning_sent_at),
      loading: false,
    });
  }, [userId]);

  useEffect(() => {
    cancelledRef.current = false;
    void refresh();
    const onChanged = () => {
      void refresh();
    };
    if (typeof window !== "undefined") {
      window.addEventListener(PREMIUM_CHANGED_EVENT, onChanged);
    }
    return () => {
      cancelledRef.current = true;
      if (typeof window !== "undefined") {
        window.removeEventListener(PREMIUM_CHANGED_EVENT, onChanged);
      }
    };
  }, [refresh]);

  return { ...state, refresh };
}