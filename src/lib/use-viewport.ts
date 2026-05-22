import { useState, useEffect } from "react";

/**
 * Viewport state. `mounted` is false until the first client-side
 * useEffect has fired, at which point width/isLandscape have been
 * measured from the real window. Server-render and pre-mount client
 * render both see mounted=false with placeholder dimensions; this
 * lets callers avoid SSR hydration mismatches that would otherwise
 * trigger React error #418 when they branch on viewport.
 *
 * ED-fix — previously the initializer read window.innerWidth and
 * matchMedia synchronously, which returns different values on server
 * (window undefined → 1280/landscape=true) vs client (real window),
 * causing /draw to render ConstellationPage on the server then swap
 * to a different component on hydrate. The mismatch cascaded into
 * the "onCardDragStart is not defined" error inside ConstellationPage.
 */
export function useViewport() {
  const [state, setState] = useState({
    width: 0,
    isLandscape: true,
    mounted: false,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => {
      setState({
        width: window.innerWidth,
        isLandscape: window.matchMedia("(orientation: landscape)").matches,
        mounted: true,
      });
    };
    update();
    window.addEventListener("resize", update);
    const mq = window.matchMedia("(orientation: landscape)");
    mq.addEventListener("change", update);
    return () => {
      window.removeEventListener("resize", update);
      mq.removeEventListener("change", update);
    };
  }, []);

  return state;
}
