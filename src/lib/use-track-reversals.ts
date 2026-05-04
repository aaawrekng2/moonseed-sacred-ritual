/**
 * ER-7 / ER-8 — lightweight read of the `track_reversals` preference
 * for any component outside the SettingsProvider tree (Insights,
 * Lunation Recap, etc).
 *
 * Returns `loaded: false` until the row has been read so callers can
 * avoid flashing reversal UI before the user's true preference
 * resolves. Listens for `moonseed:track-reversals-changed` so the
 * Settings toggle propagates live without a full refetch.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export const TRACK_REVERSALS_EVENT = "moonseed:track-reversals-changed";

export function emitTrackReversalsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TRACK_REVERSALS_EVENT));
}

export type TrackReversalsState = {
  trackReversals: boolean;
  loaded: boolean;
};

export function useTrackReversals(): TrackReversalsState {
  const { user } = useAuth();
  const [state, setState] = useState<TrackReversalsState>({
    trackReversals: true,
    loaded: false,
  });

  useEffect(() => {
    if (!user) {
      setState({ trackReversals: true, loaded: true });
      return;
    }
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase
        .from("user_preferences")
        .select("track_reversals")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      const row = data as { track_reversals?: boolean | null } | null;
      setState({
        trackReversals:
          typeof row?.track_reversals === "boolean" ? row.track_reversals : true,
        loaded: true,
      });
    };
    void load();
    const onChanged = () => {
      void load();
    };
    if (typeof window !== "undefined") {
      window.addEventListener(TRACK_REVERSALS_EVENT, onChanged);
    }
    return () => {
      cancelled = true;
      if (typeof window !== "undefined") {
        window.removeEventListener(TRACK_REVERSALS_EVENT, onChanged);
      }
    };
  }, [user]);

  return state;
}