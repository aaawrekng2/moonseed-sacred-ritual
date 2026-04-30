/**
 * PhotoCapture — shared camera + crop + WebP save pipeline (Stamp AQ).
 *
 * Mode-based component used wherever the app needs a user-supplied
 * photo: deck card photography, deck card backs, and (eventually)
 * journal reading photos. The output is always WebP for size + quality.
 *
 * Three-step flow:
 *   1. Camera capture (getUserMedia, with shape-aware overlay)
 *   2. Refine (pan / zoom / rotate; aspect locked unless shape='free')
 *   3. Save (apply rounded / circular alpha mask, resize, encode WebP)
 *
 * The component does not upload anything — it just hands the caller a
 * Blob and the final dimensions via `onCapture`. Storage is the
 * caller's responsibility.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, RotateCcw, RotateCw, Undo2, X } from "lucide-react";

export type PhotoCaptureShape = "rectangle" | "square" | "round" | "free";

export type PhotoCaptureProps = {
  shape: PhotoCaptureShape;
  /** Aspect ratio (width / height) for shape='rectangle'. Ignored otherwise. */
  aspectRatio?: number;
  /** Corner radius as % of shorter side, applied for rectangle/square. */
  cornerRadiusPercent?: number;
  /** Output image's longest edge in pixels. */
  outputMaxDimension: number;
  /** WebP quality, 0..1. Default 0.85. */
  outputQuality?: number;
  /** Optional helper text under the camera. */
  guideText?: string;
  onCapture: (
    blob: Blob,
    dimensions: { width: number; height: number },
  ) => void;
  onCancel: () => void;
};

type Step = "camera" | "refine" | "saving";

// ---------- Canvas helpers ----------

function applyRoundedCorners(
  src: HTMLCanvasElement,
  cornerRadiusPercent: number,
): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext("2d");
  if (!ctx) return src;
  const r = Math.min(out.width, out.height) * (cornerRadiusPercent / 100);
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(out.width - r, 0);
  ctx.quadraticCurveTo(out.width, 0, out.width, r);
  ctx.lineTo(out.width, out.height - r);
  ctx.quadraticCurveTo(out.width, out.height, out.width - r, out.height);
  ctx.lineTo(r, out.height);
  ctx.quadraticCurveTo(0, out.height, 0, out.height - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(src, 0, 0);
  return out;
}

function applyCircularMask(src: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement("canvas");
  const size = Math.min(src.width, src.height);
  out.width = size;
  out.height = size;
  const ctx = out.getContext("2d");
  if (!ctx) return src;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  const sx = (src.width - size) / 2;
  const sy = (src.height - size) / 2;
  ctx.drawImage(src, sx, sy, size, size, 0, 0, size, size);
  return out;
}

function canvasToWebP(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("WebP encode failed"))),
      "image/webp",
      quality,
    );
  });
}

function resizeToMaxDimension(
  src: HTMLCanvasElement,
  maxDim: number,
): HTMLCanvasElement {
  const longest = Math.max(src.width, src.height);
  if (longest <= maxDim) return src;
  const scale = maxDim / longest;
  const out = document.createElement("canvas");
  out.width = Math.round(src.width * scale);
  out.height = Math.round(src.height * scale);
  const ctx = out.getContext("2d");
  if (!ctx) return src;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, out.width, out.height);
  return out;
}

/**
 * WYSIWYG crop. Replays the on-screen transform (translate → rotate →
 * scale) onto an output canvas sized to the visible crop frame, so what
 * the user saw inside the overlay is exactly what gets saved.
 *
 * The viewer fits the source so its HEIGHT matches the viewport height
 * (CSS: height: 100%, width: auto). `viewerScale` converts viewport CSS
 * pixels to source pixels. Pan, rotation and zoom are then applied
 * around the viewport centre, mirroring the CSS transform string.
 */
function cropFromViewport(
  source: HTMLImageElement,
  viewport: { w: number; h: number },
  frame: { w: number; h: number },
  zoom: number,
  panX: number,
  panY: number,
  rotation: number,
): HTMLCanvasElement {
  const sw = source.naturalWidth;
  const sh = source.naturalHeight;
  // The displayed image fits the viewport by HEIGHT (see <RefineView>).
  // 1 viewport CSS pixel → (sh / viewport.h) source pixels.
  const cssToSrc = sh / Math.max(1, viewport.h);

  // Output canvas is sized to the frame in source pixels.
  const outW = Math.max(1, Math.round(frame.w * cssToSrc));
  const outH = Math.max(1, Math.round(frame.h * cssToSrc));

  const out = document.createElement("canvas");
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext("2d");
  if (!ctx) return out;

  // Fill with black so any unmapped area (under-zoom) reads as backdrop.
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, outW, outH);

  // Replay the CSS transform around the frame centre.
  ctx.save();
  ctx.translate(outW / 2, outH / 2);
  // Pan (CSS `translate(-pan.x, -pan.y)` in viewport pixels).
  ctx.translate(-panX * cssToSrc, -panY * cssToSrc);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.scale(zoom, zoom);
  // Draw the source so its centre lands on the (post-translate) origin.
  ctx.drawImage(source, -sw / 2, -sh / 2);
  ctx.restore();

  return out;
}

// ---------- Component ----------

export function PhotoCapture({
  shape,
  aspectRatio,
  cornerRadiusPercent = 0,
  outputMaxDimension,
  outputQuality = 0.85,
  guideText,
  onCapture,
  onCancel,
}: PhotoCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [step, setStep] = useState<Step>("camera");
  const [error, setError] = useState<string | null>(null);
  const [captured, setCaptured] = useState<HTMLImageElement | null>(null);

  // Refine state.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  // Multi-touch pinch + rotate state. We track up to two active pointers
  // and derive scale/rotation deltas from their changing distance/angle.
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gestureRef = useRef<{ d: number; a: number; z: number; r: number } | null>(null);
  // Viewport rect for the refine area, captured by <RefineView>.
  const viewportRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const frameRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });

  // Frame aspect for overlays.
  const frameAspect =
    shape === "square" || shape === "round"
      ? 1
      : shape === "rectangle"
        ? (aspectRatio ?? 0.7)
        : (aspectRatio ?? 0.75);

  // ---- Camera lifecycle ----
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1920 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setError(null);
    } catch (e) {
      setError(
        e instanceof Error && e.name === "NotAllowedError"
          ? "Camera access was denied. Enable it in your browser settings."
          : "Couldn't open the camera on this device.",
      );
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (step === "camera") void startCamera();
    return () => {
      if (step !== "camera") stopCamera();
    };
  }, [step, startCamera, stopCamera]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  // ---- Capture a still ----
  const capture = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")?.drawImage(v, 0, 0);
    const img = new Image();
    img.onload = () => {
      setCaptured(img);
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setRotation(0);
      setStep("refine");
    };
    img.src = c.toDataURL("image/png");
    stopCamera();
  }, [stopCamera]);

  // ---- Refine gestures ----
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) {
      const [p1, p2] = Array.from(pointersRef.current.values());
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      gestureRef.current = {
        d: Math.hypot(dx, dy),
        a: (Math.atan2(dy, dx) * 180) / Math.PI,
        z: zoom,
        r: rotation,
      };
      dragRef.current = null;
    } else if (pointersRef.current.size === 1) {
      dragRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size >= 2 && gestureRef.current) {
      const [p1, p2] = Array.from(pointersRef.current.values());
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const d = Math.hypot(dx, dy);
      const a = (Math.atan2(dy, dx) * 180) / Math.PI;
      const g = gestureRef.current;
      const nextZoom = Math.min(5, Math.max(1, g.z * (d / Math.max(1, g.d))));
      let da = a - g.a;
      if (da > 180) da -= 360;
      if (da < -180) da += 360;
      setZoom(nextZoom);
      setRotation(((g.r + da) % 360 + 360) % 360);
      return;
    }
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    setPan({ x: dragRef.current.px - dx / zoom, y: dragRef.current.py - dy / zoom });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) gestureRef.current = null;
    if (pointersRef.current.size === 0) dragRef.current = null;
    else if (pointersRef.current.size === 1) {
      const [p] = Array.from(pointersRef.current.values());
      dragRef.current = { x: p.x, y: p.y, px: pan.x, py: pan.y };
    }
  };
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.min(5, Math.max(1, z * (e.deltaY < 0 ? 1.1 : 1 / 1.1))));
  };

  // ---- Save ----
  const save = useCallback(async () => {
    if (!captured) return;
    setStep("saving");
    try {
      let canvas = cropFromViewport(
        captured,
        viewportRef.current,
        frameRef.current,
        zoom,
        pan.x,
        pan.y,
        rotation,
      );
      // Fix 4 — never upscale. resizeToMaxDimension is a no-op when the
      // longest edge is already <= outputMaxDimension.
      canvas = resizeToMaxDimension(canvas, outputMaxDimension);
      if (shape === "round") {
        canvas = applyCircularMask(canvas);
      } else if ((shape === "rectangle" || shape === "square") && cornerRadiusPercent > 0) {
        canvas = applyRoundedCorners(canvas, cornerRadiusPercent);
      }
      const blob = await canvasToWebP(canvas, outputQuality);
      onCapture(blob, { width: canvas.width, height: canvas.height });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the photo.");
      setStep("refine");
    }
  }, [captured, shape, aspectRatio, zoom, pan, rotation, outputMaxDimension, outputQuality, cornerRadiusPercent, onCapture]);

  // ---- Render ----

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-black text-white"
      style={{ touchAction: "none" }}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between p-4">
        <button
          onClick={() => {
            stopCamera();
            onCancel();
          }}
          className="rounded-full bg-white/10 p-2 hover:bg-white/20"
          aria-label="Cancel"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="text-xs uppercase tracking-[0.3em] opacity-60">
          {step === "camera" ? "Frame" : step === "refine" ? "Adjust" : "Saving"}
        </div>
        <div className="w-9" />
      </div>

      {/* Body */}
      <div className="relative flex-1 overflow-hidden">
        {step === "camera" && (
          <CameraView
            videoRef={videoRef}
            shape={shape}
            frameAspect={frameAspect}
            error={error}
          />
        )}
        {step === "refine" && captured && (
          <RefineView
            image={captured}
            shape={shape}
            frameAspect={frameAspect}
            zoom={zoom}
            pan={pan}
            rotation={rotation}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onWheel={onWheel}
            onMeasure={(viewport, frame) => {
              viewportRef.current = viewport;
              frameRef.current = frame;
            }}
          />
        )}
        {step === "saving" && (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin opacity-70" />
          </div>
        )}

        {guideText && step === "camera" && !error && (
          <div className="pointer-events-none absolute inset-x-0 bottom-32 text-center text-sm opacity-80">
            {guideText}
          </div>
        )}
      </div>

      {/* Bottom controls */}
      <div className="flex items-center justify-center gap-6 p-6">
        {step === "camera" && (
          <button
            onClick={capture}
            disabled={!!error}
            className="h-20 w-20 rounded-full border-4 border-white bg-white/0 transition active:scale-95 disabled:opacity-40"
            aria-label="Capture"
          >
            <span className="block h-full w-full rounded-full bg-white" />
          </button>
        )}
        {step === "refine" && (
          <>
            <button
              onClick={() => {
                setCaptured(null);
                setStep("camera");
              }}
              className="rounded-full bg-white/10 px-4 py-2 text-sm hover:bg-white/20"
            >
              Retake
            </button>
            <button
              onClick={() => setRotation((r) => (r - 90 + 360) % 360)}
              className="rounded-full bg-white/10 p-3 hover:bg-white/20"
              aria-label="Rotate left 90°"
            >
              <RotateCcw className="h-5 w-5" />
            </button>
            <button
              onClick={() => setRotation((r) => (r + 90) % 360)}
              className="rounded-full bg-white/10 p-3 hover:bg-white/20"
              aria-label="Rotate right 90°"
            >
              <RotateCw className="h-5 w-5" />
            </button>
            <button
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
                setRotation(0);
              }}
              className="rounded-full bg-white/10 p-3 hover:bg-white/20"
              aria-label="Reset"
            >
              <Undo2 className="h-5 w-5" />
            </button>
            <button
              onClick={save}
              className="flex items-center gap-2 rounded-full bg-white px-5 py-2 text-sm font-medium text-black hover:bg-white/90"
            >
              <Check className="h-4 w-4" /> Done
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function CameraView({
  videoRef,
  shape,
  frameAspect,
  error,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  shape: PhotoCaptureShape;
  frameAspect: number;
  error: string | null;
}) {
  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm opacity-80">
        {error}
      </div>
    );
  }
  return (
    <div className="relative h-full w-full">
      <video
        ref={videoRef}
        playsInline
        muted
        className="h-full w-full object-cover"
      />
      <ShapeOverlay shape={shape} frameAspect={frameAspect} />
    </div>
  );
}

function ShapeOverlay({
  shape,
  frameAspect,
}: {
  shape: PhotoCaptureShape;
  frameAspect: number;
}) {
  if (shape === "free") return null;
  // Inset frame as percentage of viewport.
  const inset = "12%";
  const radius =
    shape === "round"
      ? "50%"
      : shape === "square"
        ? "8%"
        : "4%";
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div
        data-overlay-frame
        style={{
          width: shape === "round" || shape === "square" ? `calc(100% - 2 * ${inset})` : "76%",
          aspectRatio: frameAspect,
          maxHeight: `calc(100% - 2 * ${inset})`,
          border: shape === "round" ? "2px solid rgba(255,255,255,0.85)" : "1px solid rgba(255,255,255,0.25)",
          borderRadius: radius,
          boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)",
          position: "relative",
        }}
      >
        {shape !== "round" && <CornerBrackets />}
      </div>
    </div>
  );
}

function CornerBrackets() {
  const arm = 22; // px
  const thickness = 2;
  const color = "rgba(255,255,255,0.95)";
  const base: React.CSSProperties = { position: "absolute", width: arm, height: arm };
  return (
    <>
      <span style={{ ...base, top: -1, left: -1, borderTop: `${thickness}px solid ${color}`, borderLeft: `${thickness}px solid ${color}` }} />
      <span style={{ ...base, top: -1, right: -1, borderTop: `${thickness}px solid ${color}`, borderRight: `${thickness}px solid ${color}` }} />
      <span style={{ ...base, bottom: -1, left: -1, borderBottom: `${thickness}px solid ${color}`, borderLeft: `${thickness}px solid ${color}` }} />
      <span style={{ ...base, bottom: -1, right: -1, borderBottom: `${thickness}px solid ${color}`, borderRight: `${thickness}px solid ${color}` }} />
    </>
  );
}

function RefineView({
  image,
  shape,
  frameAspect,
  zoom,
  pan,
  rotation,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onWheel,
  onMeasure,
}: {
  image: HTMLImageElement;
  shape: PhotoCaptureShape;
  frameAspect: number;
  zoom: number;
  pan: { x: number; y: number };
  rotation: number;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onWheel: (e: React.WheelEvent) => void;
  onMeasure: (
    viewport: { w: number; h: number },
    frame: { w: number; h: number },
  ) => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      // Frame is 76% wide for rectangle, otherwise sized to fit with 12% inset.
      // Mirror ShapeOverlay logic by reading the rendered overlay's rect.
      const overlay = el.querySelector("[data-overlay-frame]") as HTMLElement | null;
      const fr = overlay?.getBoundingClientRect();
      onMeasure(
        { w: r.width, h: r.height },
        fr ? { w: fr.width, h: fr.height } : { w: r.width, h: r.height },
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onMeasure, frameAspect, shape]);
  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full select-none overflow-hidden"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      style={{ touchAction: "none" }}
    >
      <img
        src={image.src}
        alt=""
        draggable={false}
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          maxWidth: "none",
          maxHeight: "none",
          width: "auto",
          height: "100%",
          transform: `translate(-50%, -50%) translate(${-pan.x}px, ${-pan.y}px) rotate(${rotation}deg) scale(${zoom})`,
          transformOrigin: "center center",
        }}
      />
      <ShapeOverlay shape={shape === "free" ? "rectangle" : shape} frameAspect={frameAspect} />
    </div>
  );
}