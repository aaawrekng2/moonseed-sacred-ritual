import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import {
  CARD_BACKS,
  DEFAULT_CARD_BACK,
  getStoredCardBack,
  setStoredCardBack,
  type CardBackId,
} from "@/lib/card-backs";

const OPACITY_STORAGE_KEY = "moonseed:resting-opacity";
const OPACITY_EVENT = "arcana:resting-opacity-changed";
const SHOW_LABELS_STORAGE_KEY = "moonseed:show-spread-labels";
const CARD_BACK_STORAGE_KEY = "moonseed:card-back";

type PrefsRow = {
  resting_opacity: number;
  show_labels: boolean;
  card_back: string;
  accent: string;
};

function readLocalPrefs(): PrefsRow {
  const opacityRaw =
    typeof window !== "undefined" ? localStorage.getItem(OPACITY_STORAGE_KEY) : null;
  const labelsRaw =
    typeof window !== "undefined"
      ? localStorage.getItem(SHOW_LABELS_STORAGE_KEY)
      : null;
  return {
    resting_opacity: opacityRaw != null ? Number(opacityRaw) : 60,
    show_labels: labelsRaw == null ? true : labelsRaw === "1",
    card_back: getStoredCardBack(),
    accent: "gold",
  };
}

function isCardBackId(v: string): v is CardBackId {
  return CARD_BACKS.some((b) => b.id === v);
}

/**
 * Bidirectional bridge between the local preference stores (localStorage +
 * in-page custom events) and the Cloud `user_preferences` row.
 *
 * Strategy:
 *  - localStorage stays the source of truth for initial render so the UI
 *    never blocks on the network.
 *  - Once auth resolves, we fetch the server row. If it exists, we hydrate
 *    localStorage with the server values and broadcast a change event so
 *    live components pick it up. If no row exists yet, we upsert one from
 *    the current local values.
 *  - Subsequent local changes (storage events + the resting-opacity custom
 *    event) trigger a fire-and-forget upsert. UI is never blocked.
 */
export function usePreferencesSync(): void {
  const { user, loading } = useAuth();
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (loading || !user) return;
    let cancelled = false;

    void (async () => {
      const { data } = await supabase
        .from("user_preferences")
        .select("resting_opacity, show_labels, card_back, accent")
        .eq("user_id", user.id)
        .maybeSingle();

      if (cancelled) return;

      if (data) {
        // Hydrate localStorage from the server row. Only update keys that
        // actually changed so we don't trigger unnecessary writes.
        if (typeof window !== "undefined") {
          const opStr = String(data.resting_opacity);
          if (localStorage.getItem(OPACITY_STORAGE_KEY) !== opStr) {
            localStorage.setItem(OPACITY_STORAGE_KEY, opStr);
            window.dispatchEvent(
              new CustomEvent<number>(OPACITY_EVENT, {
                detail: data.resting_opacity,
              }),
            );
          }
          const labelsStr = data.show_labels ? "1" : "0";
          if (localStorage.getItem(SHOW_LABELS_STORAGE_KEY) !== labelsStr) {
            localStorage.setItem(SHOW_LABELS_STORAGE_KEY, labelsStr);
          }
          if (
            isCardBackId(data.card_back) &&
            localStorage.getItem(CARD_BACK_STORAGE_KEY) !== data.card_back
          ) {
            setStoredCardBack(data.card_back);
          }
        }
      } else {
        // No row yet — seed it from current local values.
        const local = readLocalPrefs();
        await supabase.from("user_preferences").upsert(
          { user_id: user.id, ...local, updated_at: new Date().toISOString() },
          { onConflict: "user_id" },
        );
      }

      hydratedRef.current = true;
    })();

    return () => {
      cancelled = true;
    };
  }, [user, loading]);

  // Push local changes to the server. Fire-and-forget — never block UI.
  useEffect(() => {
    if (loading || !user) return;
    if (typeof window === "undefined") return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const queueUpsert = () => {
      if (!hydratedRef.current) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const local = readLocalPrefs();
        const cardBack = isCardBackId(local.card_back)
          ? local.card_back
          : DEFAULT_CARD_BACK;
        void supabase.from("user_preferences").upsert(
          {
            user_id: user.id,
            resting_opacity: local.resting_opacity,
            show_labels: local.show_labels,
            card_back: cardBack,
            accent: local.accent,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        );
      }, 400);
    };

    const onStorage = (e: StorageEvent) => {
      if (
        e.key === OPACITY_STORAGE_KEY ||
        e.key === SHOW_LABELS_STORAGE_KEY ||
        e.key === CARD_BACK_STORAGE_KEY
      ) {
        queueUpsert();
      }
    };
    const onOpacity = () => queueUpsert();

    window.addEventListener("storage", onStorage);
    window.addEventListener(OPACITY_EVENT, onOpacity);
    window.addEventListener("moonseed:show-labels-changed", onOpacity);
    window.addEventListener("moonseed:card-back-changed", onOpacity);

    // Also poll on visibility change — covers same-tab writes from
    // useShowLabels which only notifies in-process subscribers.
    const onVisibility = () => {
      if (document.visibilityState === "visible") queueUpsert();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(OPACITY_EVENT, onOpacity);
      document.removeEventListener("visibilitychange", onVisibility);
      if (timer) clearTimeout(timer);
    };
  }, [user, loading]);
}