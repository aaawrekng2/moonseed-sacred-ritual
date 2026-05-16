/**
 * Premium gating for Tarot Seed (CU).
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
/**
 * Q69 — premium tier removed. AI gating is now credits-only.
 *
 * This hook is kept as a transitional no-op so existing callers
 * continue to compile. Every consumer receives `isPremium: true`,
 * which makes every legacy gate a pass-through. New code should not
 * use this hook; check credits via `checkQuota`/`callAI` instead.
 */

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

export function emitPremiumChanged(): void {
  // No-op: premium tier was removed in Q69.
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

const NOOP_REFRESH = async () => {};

const STATIC_PREMIUM_STATE: PremiumState = {
  isPremium: true,
  rawIsPremium: true,
  expiresAt: null,
  premiumSince: null,
  monthsUsed: 0,
  tier: null,
  warningSentAt: null,
  loading: false,
  refresh: NOOP_REFRESH,
};

export function usePremium(_userId?: string | undefined): PremiumState {
  void _userId;
  return STATIC_PREMIUM_STATE;
}