/**
 * Single source of truth for "what timezone should we render moon math in?"
 *
 * Strategy (per UX spec):
 *  - On first ever load, if the seeker has no profile timezone we silently
 *    seed it with the device's IANA zone. No popup.
 *  - On every subsequent load, we compare device tz against profile tz. If
 *    they differ AND the user hasn't permanently dismissed it, we surface a
 *    one-time popup asking how to handle it.
 *  - The seeker can flip mode in Settings: "auto" (always follow device) or
 *    "fixed" (always use the saved profile tz, ignore device).
 *
 * The "effective tz" returned here is what the moon carousel and any other
 * astronomical UI should pass into Intl.DateTimeFormat / date math.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

const DISMISS_KEY = "moonseed:tz-mismatch-dismissed";
const TZ_LOCAL_KEY = "moonseed:timezone";
const TZ_MODE_LOCAL_KEY = "moonseed:tz-mode";

export type TzMode = "auto" | "fixed";

export function getDeviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

type TimezoneState = {
  /** Timezone to actually render astronomical UI in. */
  effectiveTz: string;
  /** Saved timezone on the user's profile. */
  profileTz: string | null;
  /** Current device's IANA timezone (e.g. America/Los_Angeles). */
  deviceTz: string;
  /** "auto" follows device; "fixed" pins to profileTz. */
  mode: TzMode;
  /** True if device differs from profile AND user has not dismissed warning. */
  mismatch: boolean;
  loaded: boolean;
  /** Persist a new profile timezone (and switch to fixed mode). */
  setProfileTimezone: (tz: string, mode?: TzMode) => Promise<void>;
  /** Persist a new mode without changing the saved tz. */
  setMode: (mode: TzMode) => Promise<void>;
  /** Stop showing the mismatch popup until profile/device changes again. */
  dismissMismatch: () => void;
  /** "use device once for this session" — switches mode to auto and saves device. */
  acceptDeviceTimezone: () => Promise<void>;
};

/**
 * Lightweight LS read helper; safe in SSR and in environments where
 * localStorage throws (private mode, etc.).
 */
function readLocal<T extends string>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    return (window.localStorage.getItem(key) as T | null) ?? null;
  } catch {
    return null;
  }
}
function writeLocal(key: string, value: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

export function useTimezone(): TimezoneState {
  const { user } = useAuth();
  const deviceTz = useMemo(() => getDeviceTimezone(), []);
  const [profileTz, setProfileTz] = useState<string | null>(() =>
    readLocal<string>(TZ_LOCAL_KEY),
  );
  const [mode, setModeState] = useState<TzMode>(
    () => (readLocal<TzMode>(TZ_MODE_LOCAL_KEY) as TzMode) || "auto",
  );
  const [loaded, setLoaded] = useState(false);
  const [dismissedFor, setDismissedFor] = useState<string | null>(() =>
    readLocal<string>(DISMISS_KEY),
  );

  // Hydrate from server (and seed silently if absent).
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("user_preferences")
        .select("timezone, tz_mode")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;

      const serverTz = (data?.timezone as string | null) ?? null;
      const serverMode = (data?.tz_mode as TzMode | null) ?? "auto";

      if (!serverTz) {
        // Silent default to device tz.
        await supabase
          .from("user_preferences")
          .upsert(
            {
              user_id: user.id,
              timezone: deviceTz,
              tz_mode: "auto",
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" },
          );
        setProfileTz(deviceTz);
        setModeState("auto");
        writeLocal(TZ_LOCAL_KEY, deviceTz);
        writeLocal(TZ_MODE_LOCAL_KEY, "auto");
      } else {
        setProfileTz(serverTz);
        setModeState(serverMode);
        writeLocal(TZ_LOCAL_KEY, serverTz);
        writeLocal(TZ_MODE_LOCAL_KEY, serverMode);
      }
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, deviceTz]);

  const setProfileTimezone = useCallback(
    async (tz: string, nextMode: TzMode = "fixed") => {
      setProfileTz(tz);
      setModeState(nextMode);
      writeLocal(TZ_LOCAL_KEY, tz);
      writeLocal(TZ_MODE_LOCAL_KEY, nextMode);
      writeLocal(DISMISS_KEY, null);
      setDismissedFor(null);
      if (!user) return;
      await supabase
        .from("user_preferences")
        .upsert(
          {
            user_id: user.id,
            timezone: tz,
            tz_mode: nextMode,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        );
    },
    [user],
  );

  const setMode = useCallback(
    async (nextMode: TzMode) => {
      setModeState(nextMode);
      writeLocal(TZ_MODE_LOCAL_KEY, nextMode);
      writeLocal(DISMISS_KEY, null);
      setDismissedFor(null);
      if (!user) return;
      await supabase
        .from("user_preferences")
        .upsert(
          {
            user_id: user.id,
            tz_mode: nextMode,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        );
    },
    [user],
  );

  const acceptDeviceTimezone = useCallback(async () => {
    await setProfileTimezone(deviceTz, "auto");
  }, [deviceTz, setProfileTimezone]);

  const dismissMismatch = useCallback(() => {
    // Key the dismissal to the current device→profile pair so a NEW mismatch
    // (e.g. user travels somewhere else) re-surfaces the popup.
    const token = `${deviceTz}|${profileTz ?? ""}`;
    writeLocal(DISMISS_KEY, token);
    setDismissedFor(token);
  }, [deviceTz, profileTz]);

  // Effective timezone for math:
  //   - fixed → always profileTz (or device fallback)
  //   - auto  → device tz
  const effectiveTz = useMemo(() => {
    if (mode === "fixed" && profileTz) return profileTz;
    return deviceTz;
  }, [mode, profileTz, deviceTz]);

  const mismatch = useMemo(() => {
    if (!loaded) return false;
    if (!profileTz) return false;
    if (profileTz === deviceTz) return false;
    const token = `${deviceTz}|${profileTz}`;
    return dismissedFor !== token;
  }, [loaded, profileTz, deviceTz, dismissedFor]);

  return {
    effectiveTz,
    profileTz,
    deviceTz,
    mode,
    mismatch,
    loaded,
    setProfileTimezone,
    setMode,
    dismissMismatch,
    acceptDeviceTimezone,
  };
}

/**
 * Compute the calendar date (year/month/day) of a Date as observed in a
 * specific IANA timezone. Returns numeric Y/M/D so callers can construct
 * comparable keys without timezone drift bugs.
 */
export function getDatePartsInTz(
  date: Date,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
  };
}

/** Stable YMD key like "2026-05-31" for a Date in a given timezone. */
export function getYmdInTz(date: Date, timeZone: string): string {
  const { year, month, day } = getDatePartsInTz(date, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Format a Date as a wall-clock time in a given IANA tz (e.g. "4:07 AM"). */
export function formatTimeInTz(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}