/**
 * Q67 — Lock the device to its CURRENT orientation while a component is
 * mounted. Does NOT force portrait — if the seeker opens the draw table
 * in landscape, it stays landscape until unmount. Fails silently on
 * browsers without Screen Orientation API support (Safari iOS).
 */
import { useEffect } from "react";

export function useLockOrientation(): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const orientation = (window.screen as Screen & {
      orientation?: ScreenOrientation & {
        lock?: (o: OrientationLockType) => Promise<void>;
        unlock?: () => void;
      };
    }).orientation;
    if (!orientation || typeof orientation.lock !== "function") return;
    const current = orientation.type as OrientationLockType;
    let locked = false;
    try {
      const p = orientation.lock(current);
      if (p && typeof p.then === "function") {
        p.then(() => {
          locked = true;
        }).catch(() => {
          /* unsupported — silent */
        });
      } else {
        locked = true;
      }
    } catch {
      /* unsupported — silent */
    }
    return () => {
      if (!locked) return;
      try {
        orientation.unlock?.();
      } catch {
        /* silent */
      }
    };
  }, []);
}