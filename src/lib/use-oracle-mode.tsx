/**
 * Oracle/Plain language mode — read once on mount from
 * `user_preferences.oracle_mode`, expose through context, and write
 * back on toggle. UI layer wraps strings in `t(key, isOracle)` from
 * `oracle-language.ts`.
 */
/**
 * Oracle/Plain language mode — REMOVED.
 *
 * The oracle voice toggle has been retired. All copy now uses the
 * plain (slightly tarot-flavored) variants. This module remains as a
 * compatibility shim so existing call sites (`isOracle ? oracle : plain`
 * ternaries scattered through reading/journal/guides) keep compiling
 * and resolve to the plain branch without a sweeping rewrite.
 */
import type { ReactNode } from "react";

type OracleCtx = {
  isOracle: false;
  setOracle: (next: boolean) => void;
  toggle: () => void;
};

const FROZEN: OracleCtx = {
  isOracle: false,
  setOracle: () => {},
  toggle: () => {},
};

export function useOracleMode(): OracleCtx {
  return FROZEN;
}

export function OracleModeProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}