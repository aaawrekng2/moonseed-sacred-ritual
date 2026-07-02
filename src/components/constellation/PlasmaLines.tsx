/**
 * PlasmaLines (v2.53)
 *
 * A canvas layer that renders the constellation's connecting lines as flowing
 * plasma instead of flat strokes. Intensity per edge = the SAME weight the SVG
 * lines use (pair.count / maxPair — how many spreads the two cards co-occurred
 * in). The strongest pair becomes the "hero" edge: a dense stream around a
 * solid, pulsing, wavy ribbon core. Weaker pairs taper down in density,
 * brightness, and speed. Flow runs OUT AND DOWN — from each edge's higher
 * (top) endpoint toward its lower one.
 *
 * The canvas sits UNDER the cards, mapped 1:1 into the web's SVG viewBox
 * coordinate space. Additive blending gives the glow. prefers-reduced-motion
 * falls to a soft static glow (no animation loop).
 *
 * Purely presentational — pointer-events: none. Only mounted on the full-size
 * constellation surfaces (ConstellationPage passes showPlasma); the card-hover
 * popovers and Card Trace mini-web never mount it.
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

type Particle = {
  t: number;
  sp: number;
  ph: number;
  amp: number;
  fr: number;
  r: number;
  c: [number, number, number];
  a: number;
};

type SpineDot = { t: number; sp: number; ph: number; r: number };

type Built = {
  fx: number; fy: number; tx: number; ty: number;
  weight: number; hero: boolean;
  parts: Particle[];
  spine: SpineDot[] | null;
};

const PUR: Array<[number, number, number]> = [
  [150, 110, 255],
  [190, 120, 255],
];
const HOT: Array<[number, number, number]> = [
  [210, 90, 240],
  [130, 180, 255],
  [255, 246, 255],
];

function pickColor(i: number): [number, number, number] {
  const pool = i > 0.5 ? PUR.concat(HOT) : PUR;
  return pool[(Math.random() * pool.length) | 0];
}

function speedFactor(i: number): number {
  return 0.35 + i * 1.05;
}

// Total particle budget across the whole web (mobile-friendly). Counts scale
// down proportionally if the raw sum would exceed this.
const PARTICLE_BUDGET = 240;

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

    // px-per-unit (aspect is preserved, so x and y scales match).
    const sc = () => cssW / vbW;
    const mapX = (x: number) => ((x - vbX0) / vbW) * cssW;
    const mapY = (y: number) => ((y - vbY0) / vbH) * cssH;

    // ---- build per-edge particle state (units are along-edge t + lateral units)
    const rawCounts = edges.map((e) =>
      Math.round(Math.max(6, dist(e) / 16) * (0.4 + e.weight * 1.4) * (e.hero ? 1.53 : 1)),
    );
    const rawSum = rawCounts.reduce((a, b) => a + b, 0) || 1;
    const scaleCounts = rawSum > PARTICLE_BUDGET ? PARTICLE_BUDGET / rawSum : 1;

    const built: Built[] = edges.map((e, i) => {
      const count = Math.max(2, Math.round(rawCounts[i] * scaleCounts));
      const parts: Particle[] = [];
      for (let k = 0; k < count; k++) {
        parts.push({
          t: Math.random(),
          sp: (0.003 + Math.random() * 0.004) * speedFactor(e.weight),
          ph: Math.random() * 6.28,
          amp: (5 + Math.random() * 13) * (0.5 + e.weight),
          fr: 0.6 + Math.random() * 1.2,
          r: (3.5 + Math.random() * 4.5) * (0.8 + e.weight * 0.5),
          c: pickColor(e.weight),
          a: (0.12 + e.weight * 0.2) * (0.7 + Math.random() * 0.6),
        });
      }
      let spine: SpineDot[] | null = null;
      if (e.hero) {
        spine = [];
        const sc2 = Math.round(dist(e) / 10);
        for (let k = 0; k < sc2; k++) {
          spine.push({
            t: Math.random(),
            sp: (0.007 + Math.random() * 0.004) * speedFactor(e.weight),
            ph: Math.random() * 6.28,
            r: 1.6 + Math.random() * 1.4,
          });
        }
      }
      return { fx: e.fx, fy: e.fy, tx: e.tx, ty: e.ty, weight: e.weight, hero: e.hero, parts, spine };
    });

    function dist(e: { fx: number; fy: number; tx: number; ty: number }) {
      return Math.hypot(e.tx - e.fx, e.ty - e.fy);
    }

    let time = 0;
    let raf = 0;

    const drawParticleGlow = (x: number, y: number, r: number, c: [number, number, number], a: number) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${a})`);
      g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 7);
      ctx.fill();
    };

    const renderFrame = (animate: boolean) => {
      const s = sc();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (animate) {
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = "rgba(0,0,0,0.20)";
        // fade toward transparent (canvas is over a transparent bg); use a
        // clear-with-alpha via destination-out so trails fade without tinting.
        ctx.globalCompositeOperation = "destination-out";
        ctx.fillStyle = "rgba(0,0,0,0.20)";
        ctx.fillRect(0, 0, cssW, cssH);
      } else {
        ctx.clearRect(0, 0, cssW, cssH);
      }
      ctx.globalCompositeOperation = "lighter";

      for (const e of built) {
        const dx = e.tx - e.fx;
        const dy = e.ty - e.fy;
        const L = Math.hypot(dx, dy) || 1;
        const nx = -dy / L;
        const ny = dx / L;

        for (const pt of e.parts) {
          if (animate) {
            pt.t += pt.sp;
            if (pt.t > 1) pt.t -= 1;
          }
          const env = Math.sin(pt.t * Math.PI);
          const off =
            pt.amp *
            env *
            (Math.sin(pt.t * 6.28 * pt.fr + pt.ph + time) +
              0.5 * Math.sin(pt.t * 18.8 * pt.fr + pt.ph * 1.7 + time * 1.4));
          const ux = e.fx + dx * pt.t + nx * off;
          const uy = e.fy + dy * pt.t + ny * off;
          drawParticleGlow(mapX(ux), mapY(uy), pt.r * 2.6 * s, pt.c, pt.a);
        }

        if (e.hero && e.spine) {
          const pulse = 0.62 + 0.38 * Math.sin(time * 1.5);
          // width factor: mostly full, thins out sometimes
          const wf = 0.42 + 0.58 * (0.5 + 0.5 * Math.sin(time * 0.5));
          const N = 44;
          const pts: Array<[number, number]> = [];
          for (let k = 0; k <= N; k++) {
            const t = k / N;
            const env = Math.sin(t * Math.PI);
            const off =
              18 *
              env *
              (Math.sin(t * 6.28 * 1.4 + time * 1.25) + 0.4 * Math.sin(t * 17 + time * 1.9));
            pts.push([mapX(e.fx + dx * t + nx * off), mapY(e.fy + dy * t + ny * off)]);
          }
          const stroke = (wid: number, col: string) => {
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.lineWidth = wid * wf * s;
            ctx.strokeStyle = col;
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
            ctx.stroke();
          };
          stroke(16, `rgba(170,110,255,${0.28 * pulse})`);
          stroke(9, `rgba(210,140,255,${0.45 * pulse})`);
          stroke(4.5, `rgba(240,200,255,${0.7 * pulse})`);
          stroke(2, `rgba(255,252,255,${0.95 * pulse})`);

          for (const sd of e.spine) {
            if (animate) {
              sd.t += sd.sp;
              if (sd.t > 1) sd.t -= 1;
            }
            const env = Math.sin(sd.t * Math.PI);
            const off = 6 * env * Math.sin(sd.t * 12.6 + sd.ph + time * 1.2);
            const ux = e.fx + dx * sd.t + nx * off;
            const uy = e.fy + dy * sd.t + ny * off;
            const x = mapX(ux);
            const y = mapY(uy);
            const gr = sd.r * 3 * s;
            const g = ctx.createRadialGradient(x, y, 0, x, y, gr);
            g.addColorStop(0, `rgba(255,250,255,${0.9 * pulse})`);
            g.addColorStop(0.4, `rgba(220,150,255,${0.5 * pulse})`);
            g.addColorStop(1, "rgba(150,90,255,0)");
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(x, y, gr, 0, 7);
            ctx.fill();
          }
        }
      }
      ctx.globalCompositeOperation = "source-over";
    };

    if (reduce) {
      // static soft glow: one still frame
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
