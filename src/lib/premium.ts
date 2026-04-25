/**
 * Premium gating stub for Moonseed.
 *
 * Source-bundle parity: exposes the same `usePremium`, `emitPremiumChanged`,
 * `tierLabel`, `daysUntil` shapes the ported components depend on. In
 * Moonseed every feature is unlocked, so `isPremium` is always `true` and
 * loading resolves synchronously.
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
  /* no-op — premium is always unlocked in Moonseed */
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

export function usePremium(_userId: string | undefined): PremiumState {
  return {
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
}