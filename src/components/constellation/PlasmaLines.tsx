/**
 * PlasmaLines (v2.54)
 *
 * Canvas layer that renders the constellation's connecting lines as directional
 * COMET STREAMS — small points of light with short tails, flowing tight along
 * each edge so you can read what flows where (v2.53's big smoky particles
 * bloomed into one cloud; this is the tightened version). No core line under
 * them; the comets themselves trace the connection.
 *
 * Intensity per edge = the SAME weight the SVG lines use (pair.count / maxPair).
 * Stronger pairs get more/brighter comets; the strongest pair's comet heads run
 * white-hot. Weak edges get a small density floor so every real connection
 * still reads. Flow runs OUT AND DOWN (top endpoint -> bottom).
 *
 * Additive blending, cleared each frame (crisp, no smear). Mapped 1:1 into the
 * web's SVG viewBox and sits UNDER the cards. pointer-events: none. Only the
 * full-size constellation surfaces mount it (ConstellationPage passes
 * showPlasma); the card popovers and Card Trace mini-web never do.
 * prefers-reduced-motion -> a single soft static frame.
 */
import { useEffect, useRef } from "react";

export type PlasmaEdge = {
  fx: number; // "from" = top endpoint (SVG units)
  fy: number;
  tx: number; // "to" = bottom endpoint
  ty: number;
  weight: number; // 0..1, pair.count / maxPair
  hero: boolean; // the single strongest pair
};

type Particle = { t: number; sp: number; amp: number; ph: number; r: number };

type Built = {
  fx: number; fy: number; tx: number; ty: number;
  weight: number; hero: boolean;
  body: [number, number, number];
  phase: number; // breathing offset for the base line
  parts: Particle[];
};

// Total comet budget across the whole web (each comet draws a short tail).
const COMET_BUDGET = 90;
const TAIL = 6; // samples per comet
const TAIL_GAP = 0.018; // t-spacing between tail samples

export function PlasmaLines({
  edges,
  vbX0,
  vbY0,
  vbW,
  vbH,
}: {
  edges: PlasmaEdge[];
  vbX0: number;
  vbY0: number;
  vbW: number;
  vbH: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let cssW = 0;
    let cssH = 0;
    let dpr = 1;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      cssW = Math.max(1, rect.width);
      cssH = Math.max(1, rect.height);
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const sc = () => cssW / vbW; // px per unit (aspect preserved)
    const mapX = (x: number) => ((x - vbX0) / vbW) * cssW;
    const mapY = (y: number) => ((y - vbY0) / vbH) * cssH;

    const dist = (e: { fx: number; fy: number; tx: number; ty: number }) =>
      Math.hypot(e.tx - e.fx, e.ty - e.fy);

    // comet counts — weak-edge floor so faint pairs still read
    const rawCounts = edges.map(
      (e) => Math.max(3, Math.round((dist(e) / 55) * (0.75 + e.weight * 1.25))) + (e.hero ? 3 : 0),
    );
    const rawSum = rawCounts.reduce((a, b) => a + b, 0) || 1;
    const scaleCounts = rawSum > COMET_BUDGET ? COMET_BUDGET / rawSum : 1;

    const built: Built[] = edges.map((e, idx) => {
      const count = Math.max(2, Math.round(rawCounts[idx] * scaleCounts));
      const parts: Particle[] = [];
      for (let k = 0; k < count; k++) {
        parts.push({
          t: Math.random(),
          sp: (0.004 + Math.random() * 0.003) * (0.35 + e.weight * 1.15),
          amp: 2.5 + e.weight * 2,
          ph: Math.random() * 6.28,
          r: 1.3 + e.weight * 1.6,
        });
      }
      const body: [number, number, number] =
        e.weight > 0.6 ? [210, 170, 255] : [170, 130, 255];
      return {
        fx: e.fx, fy: e.fy, tx: e.tx, ty: e.ty,
        weight: e.weight, hero: e.hero, body,
        phase: Math.random() * 6.28,
        parts,
      };
    });

    let time = 0;
    let raf = 0;

    const renderFrame = (animate: boolean) => {
      const s = sc();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.globalCompositeOperation = "lighter";

      for (const e of built) {
        const dx = e.tx - e.fx;
        const dy = e.ty - e.fy;
        const L = Math.hypot(dx, dy) || 1;
        const nx = -dy / L;
        const ny = dx / L;

        // v2.59 — the connecting line is ONE soft-edged band. FIX for weak
        // lines vanishing on busy webs: a once-drawn pair on a web whose
        // busiest pair is 5+ used to floor to a 1px, 20%-opacity, feathered
        // band = sub-pixel and invisible while its orbs still showed. Now:
        //   - rendered width floors at 2px (always has body, any maxPair),
        //   - opacity floors higher (0.35..0.8), and
        //   - lines under ~3px draw CRISP (no feathered gradient — there
        //     aren't enough pixels across the width for the plateau to
        //     survive). Feathering only applies once the band is thick enough
        //     to show it (the stronger pairs). Thickness/opacity still scale
        //     with co-occurrence, so the hierarchy is preserved.
        {
          const breathe = animate ? 0.85 + 0.15 * Math.sin(time * 0.9 + e.phase) : 1;
          const op = (0.35 + e.weight * 0.45) * breathe; // 0.35..0.8
          const [cr, cg, cb] = e.hero ? [220, 180, 255] : e.body;
          const wUnits = Math.min(5, e.weight * 5);
          const w = Math.max(2, wUnits * s); // rendered thickness (px), floor 2
          const hw = w / 2;
          const x1 = mapX(e.fx);
          const y1 = mapY(e.fy);
          const x2 = mapX(e.tx);
          const y2 = mapY(e.ty);
          const dlen = Math.hypot(x2 - x1, y2 - y1) || 1;
          const pnx = -(y2 - y1) / dlen;
          const pny = (x2 - x1) / dlen;
          const solid = `rgba(${cr},${cg},${cb},${op})`;
          if (w < 3) {
            // thin: crisp solid band, no feather
            ctx.fillStyle = solid;
          } else {
            // thick: feathered plateau (solid middle ~40%, fade at edges)
            const mx = (x1 + x2) / 2;
            const my = (y1 + y2) / 2;
            const clear = `rgba(${cr},${cg},${cb},0)`;
            const grad = ctx.createLinearGradient(
              mx - pnx * hw,
              my - pny * hw,
              mx + pnx * hw,
              my + pny * hw,
            );
            grad.addColorStop(0, clear);
            grad.addColorStop(0.3, solid);
            grad.addColorStop(0.7, solid);
            grad.addColorStop(1, clear);
            ctx.fillStyle = grad;
          }
          ctx.beginPath();
          ctx.moveTo(x1 - pnx * hw, y1 - pny * hw);
          ctx.lineTo(x2 - pnx * hw, y2 - pny * hw);
          ctx.lineTo(x2 + pnx * hw, y2 + pny * hw);
          ctx.lineTo(x1 + pnx * hw, y1 + pny * hw);
          ctx.closePath();
          ctx.fill();
        }

        for (const pt of e.parts) {
          if (animate) {
            pt.t += pt.sp;
            if (pt.t > 1) pt.t -= 1;
          }
          for (let sIdx = 0; sIdx < TAIL; sIdx++) {
            const tt = pt.t - sIdx * TAIL_GAP;
            if (tt < 0) continue;
            const off = pt.amp * Math.sin(tt * 9 + pt.ph + time * 1.2);
            const ux = e.fx + dx * tt + nx * off;
            const uy = e.fy + dy * tt + ny * off;
            const x = mapX(ux);
            const y = mapY(uy);
            const fall = 1 - sIdx / TAIL;
            const rr = Math.max(0.5, pt.r * fall * 2.4 * s);
            const al = (0.35 + e.weight * 0.65) * fall * fall;
            const c =
              e.hero && sIdx === 0 ? [255, 250, 255] : e.body;
            const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
            g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${al})`);
            g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(x, y, rr, 0, 7);
            ctx.fill();
          }
        }
      }
      ctx.globalCompositeOperation = "source-over";
    };

    if (reduce) {
      renderFrame(false);
      return () => {
        ro.disconnect();
      };
    }

    const loop = () => {
      time += 0.03;
      renderFrame(true);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [edges, vbX0, vbY0, vbW, vbH]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 0,
      }}
    />
  );
}
