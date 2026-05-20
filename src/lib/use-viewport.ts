import { useState, useEffect } from "react";

export function useViewport() {
  const [state, setState] = useState({
    width: typeof window !== "undefined" ? window.innerWidth : 1280,
    isLandscape:
      typeof window !== "undefined"
        ? window.matchMedia("(orientation: landscape)").matches
        : true,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => {
      setState({
        width: window.innerWidth,
        isLandscape: window.matchMedia("(orientation: landscape)").matches,
      });
    };
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