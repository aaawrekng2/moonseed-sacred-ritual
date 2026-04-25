/**
 * Oracle/Plain language mode — read once on mount from
 * `user_preferences.oracle_mode`, expose through context, and write
 * back on toggle. UI layer wraps strings in `t(key, isOracle)` from
 * `oracle-language.ts`.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { updateUserPreferences } from "@/lib/user-preferences-write";

type OracleCtx = {
  isOracle: boolean;
  setOracle: (next: boolean) => void;
  toggle: () => void;
};

const Ctx = createContext<OracleCtx | null>(null);

export function useOracleMode(): OracleCtx {
  const v = useContext(Ctx);
  if (v) return v;
  // Safe fallback so components outside the provider still render
  // (always Plain, no-op writes).
  return {
    isOracle: false,
    setOracle: () => {},
    toggle: () => {},
  };
}

export function OracleModeProvider({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const [isOracle, setIsOracle] = useState(false);

  useEffect(() => {
    if (loading || !user) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("user_preferences")
        .select("oracle_mode")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      const row = (data ?? {}) as { oracle_mode?: boolean | null };
      if (typeof row.oracle_mode === "boolean") setIsOracle(row.oracle_mode);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, loading]);

  const setOracle = useCallback(
    (next: boolean) => {
      setIsOracle(next);
      if (!user) return;
      void updateUserPreferences(user.id, {
        oracle_mode: next,
      } as never);
    },
    [user],
  );

  const toggle = useCallback(() => {
    setOracle(!isOracle);
  }, [isOracle, setOracle]);

  return (
    <Ctx.Provider value={{ isOracle, setOracle, toggle }}>
      {children}
    </Ctx.Provider>
  );
}