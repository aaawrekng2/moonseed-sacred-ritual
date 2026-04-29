/**
 * Hook that captures a rendered share card to a PNG and either invokes
 * the native Web Share API or downloads the image directly.
 *
 * Levels render off-screen at 1080x1920 (Instagram Story standard) so
 * the captured PNG is sized correctly regardless of the on-screen
 * preview scale. The preview itself is a CSS-scaled clone of the same
 * markup so what the user sees IS what gets shared.
 */
import { useCallback, useState } from "react";
import { toPng } from "html-to-image";
import { toast as sonner } from "sonner";
import { SHARE_CARD_H, SHARE_CARD_W } from "./levels/share-card-shared";

export type ShareBusyState = null | "share" | "save";
export type ShareIntent = "share" | "save";

/**
 * The last failure the share flow saw, kept around so the UI can
 * render an inline Retry affordance in addition to the toast.
 * `step` tells the builder *where* to surface the banner:
 *   - "prepare" → before the preview exists (next to Share/Download)
 *   - "confirm" → after preview, inside the preview modal
 */
export type ShareError = {
  step: "prepare" | "confirm";
  intent: ShareIntent;
  title: string;
  description: string;
  /**
   * Short, single-sentence next step hint (e.g. "Switch to Download PNG").
   * Surfaced beneath the description in the inline banner so the seeker
   * always sees a clear way forward, even before tapping Retry.
   */
  nextAction: string;
  retry: () => void;
  /**
   * Present when an already-rendered PNG is available (i.e. the share
   * step failed *after* a successful capture). Calling it triggers the
   * download path with the existing PNG — no re-render, no Web Share.
   */
  downloadNow?: () => void;
};

/**
 * Optional analytics callbacks. The hook stays presentation-only and
 * delegates "what happened" reporting upward so each call site can tag
 * the event with its own `context` / `level`.
 */
export type ShareCardCallbacks = {
  onPrepared?: (intent: ShareIntent) => void;
  onPrepareError?: (intent: ShareIntent, error: unknown) => void;
  onShareSuccess?: () => void;
  onShareDownload?: (reason: "user" | "share_unsupported") => void;
  onShareError?: (intent: ShareIntent, error: unknown) => void;
};

/**
 * The currently rendered preview waiting for user confirmation.
 * The preview modal in ShareBuilder consumes `dataUrl`; `intent`
 * tells `confirm()` whether to invoke Web Share or download.
 */
export type SharePreview = {
  intent: ShareIntent;
  dataUrl: string;
  filename: string;
};

export function useShareCard(callbacks: ShareCardCallbacks = {}) {
  const [busy, setBusy] = useState<ShareBusyState>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [preview, setPreview] = useState<SharePreview | null>(null);
  const [lastError, setLastError] = useState<ShareError | null>(null);

  const flash = (msg: string, ms = 1800) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), ms);
  };

  /**
   * Friendly, actionable, *step-aware* error message.
   *
   * `step` distinguishes:
   *  - "prepare" → image capture (html-to-image rendering the off-screen
   *    1080x1920 card to a PNG). Failures here are almost always
   *    rendering / cross-origin issues; sharing was never attempted.
   *  - "confirm" → Web Share or download. Failures here mean the PNG was
   *    rendered fine but the OS share sheet (or download) refused.
   *
   * `intent` distinguishes whether the seeker chose Share or Download
   * PNG, so the hint can point at the *other* path as a fallback.
   */
  const describeError = (
    e: unknown,
    step: "prepare" | "confirm",
    intent: ShareIntent,
  ): { title: string; description: string; nextAction: string } => {
    const err = e as { name?: string; message?: string } | null | undefined;
    const name = err?.name ?? "";
    const msg = (err?.message ?? "").toLowerCase();

    const fallbackHint =
      intent === "share"
        ? "Switch to Download PNG to save the card to your device."
        : "Try again, or switch to Share to send via your apps.";

    // ---- Capture (prepare) phase ---------------------------------------
    if (step === "prepare") {
      if (msg.includes("tainted") || msg.includes("cors") || msg.includes("security")) {
        return {
          title: "Couldn't capture the card",
          description:
            "An image on the card was blocked by cross-origin rules, so the screenshot couldn't be made. Nothing was shared.",
          nextAction:
            "Tap Retry — if it keeps failing, try a different share style.",
        };
      }
      if (msg.includes("network") || msg.includes("fetch")) {
        return {
          title: "Couldn't capture the card",
          description:
            "A network hiccup interrupted the screenshot before sharing started.",
          nextAction: "Check your connection, then tap Retry.",
        };
      }
      return {
        title: "Couldn't capture the card",
        description:
          "Something went wrong rendering the card to an image. Sharing was not attempted.",
        nextAction: "Tap Retry to re-render the card.",
      };
    }

    // ---- Confirm phase: Web Share / download ---------------------------
    if (intent === "save") {
      return {
        title: "Download didn't start",
        description:
          "The image was captured fine, but your browser blocked the download.",
        nextAction:
          "Tap Retry — if it keeps failing, allow downloads in browser settings.",
      };
    }

    // intent === "share" (Web Share API failure)
    if (name === "NotAllowedError" || msg.includes("permission")) {
      return {
        title: "Share was blocked",
        description:
          "Your browser denied permission to open the share sheet. The card image is still ready.",
        nextAction:
          "Switch to Download PNG, or allow sharing in browser settings and Retry.",
      };
    }
    if (msg.includes("network") || msg.includes("fetch")) {
      return {
        title: "Share couldn't start",
        description:
          "A network hiccup interrupted the share sheet. The card image is still ready.",
        nextAction: "Check your connection and tap Retry, or Download PNG instead.",
      };
    }
    return {
      title: "Share didn't go through",
      description:
        "The card was captured fine, but your device's share sheet returned an error.",
      nextAction: fallbackHint,
    };
  };

  const notifyError = (
    title: string,
    description: string,
    nextAction: string,
    onRetry: () => void,
    /**
     * When provided, the toast surfaces a second "Download PNG" button
     * (using sonner's `cancel` slot) that bypasses Web Share entirely.
     */
    onDownloadNow?: () => void,
  ) => {
    sonner.error(title, {
      description: `${description} ${nextAction}`,
      action: {
        label: "Retry",
        onClick: () => {
          onRetry();
        },
      },
      ...(onDownloadNow
        ? {
            cancel: {
              label: "Download PNG",
              onClick: () => {
                onDownloadNow();
              },
            },
          }
        : {}),
      duration: 10000,
    });
  };

  /**
   * Render the given DOM node to a PNG data URL. Caller is responsible
   * for ensuring the node is laid out at the intended capture
   * dimensions (e.g. an off-screen 1080x1920 container).
   */
  const renderToPng = useCallback(
    async (node: HTMLElement, backgroundColor: string): Promise<string> => {
      // pixelRatio: 1 because the off-screen container is already at the
      // target physical dimensions. Setting >1 would balloon the file.
      // width/height + canvasWidth/canvasHeight + an explicit transform
      // force the exported PNG to true portrait 1080x1920 even if the
      // capture node is briefly mis-measured during a reflow (mobile
      // keyboard, dialog resize, orientation change, etc.).
      return toPng(node, {
        pixelRatio: 1,
        cacheBust: true,
        backgroundColor,
        width: SHARE_CARD_W,
        height: SHARE_CARD_H,
        canvasWidth: SHARE_CARD_W,
        canvasHeight: SHARE_CARD_H,
        style: {
          width: `${SHARE_CARD_W}px`,
          height: `${SHARE_CARD_H}px`,
          transform: "none",
          transformOrigin: "top left",
        },
      });
    },
    [],
  );

  const downloadDataUrl = (dataUrl: string, filename: string) => {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  /**
   * Step 1 — render the PNG and stash it as a preview. The actual
   * Web Share / download happens in `confirm()`. This split lets the
   * builder show the user the real generated image before anything
   * leaves the app.
   */
  const prepare = useCallback(
    async (
      node: HTMLElement,
      backgroundColor: string,
      intent: ShareIntent,
    ) => {
      try {
        setBusy(intent);
        setLastError(null);
        const dataUrl = await renderToPng(node, backgroundColor);
        const filename = `moonseed-${new Date()
          .toISOString()
          .slice(0, 10)}.png`;
        setPreview({ intent, dataUrl, filename });
        callbacks.onPrepared?.(intent);
      } catch (e) {
        console.error("[useShareCard] prepare failed", e);
        flash(intent === "share" ? "Couldn't share" : "Couldn't save");
        const retry = () => {
          setLastError(null);
          void prepare(node, backgroundColor, intent);
        };
        const { title, description, nextAction } = describeError(e, "prepare", intent);
        // No PNG yet — Download Now would have nothing to save.
        notifyError(title, description, nextAction, retry);
        setLastError({ step: "prepare", intent, title, description, nextAction, retry });
        callbacks.onPrepareError?.(intent, e);
      } finally {
        setBusy(null);
      }
    },
    [renderToPng, callbacks],
  );

  /**
   * Step 2 — user confirmed the preview. Invoke Web Share for "share"
   * or trigger the download for "save". Closes the preview when done.
   */
  const confirm = useCallback(async () => {
    if (!preview) return;
    const { intent, dataUrl, filename } = preview;
    try {
      setBusy(intent);
      setLastError(null);
      if (intent === "save") {
        downloadDataUrl(dataUrl, filename);
        flash("PNG downloaded");
        callbacks.onShareDownload?.("user");
        setPreview(null);
        return;
      }
      // intent === "share"
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], filename, { type: "image/png" });
      const nav = navigator as Navigator & {
        canShare?: (data: ShareData) => boolean;
      };
      if (nav.canShare && nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], title: "Moonseed" });
        flash("Shared");
        callbacks.onShareSuccess?.();
      } else {
        downloadDataUrl(dataUrl, filename);
        flash("Saved (sharing not supported)");
        sonner.info("Sharing isn't supported here", {
          description:
            "We saved the image instead so you can share it manually.",
          duration: 5000,
        });
        callbacks.onShareDownload?.("share_unsupported");
      }
      setPreview(null);
    } catch (e) {
      // User dismissing the native share sheet is not an error — keep
      // the preview open so they can try again or save instead.
      if ((e as { name?: string })?.name === "AbortError") return;
      console.error("[useShareCard] confirm failed", e);
      flash(intent === "share" ? "Couldn't share" : "Couldn't save");
      const retry = () => {
        setLastError(null);
        void confirm();
      };
      // PNG was already rendered (preview exists), so we can offer an
      // immediate switch to the download path. Only meaningful for
      // share failures — for download failures, "Retry" already does
      // the same thing.
      const downloadNow =
        intent === "share"
          ? () => {
              try {
                downloadDataUrl(dataUrl, filename);
                flash("PNG downloaded");
                callbacks.onShareDownload?.("user");
                setLastError(null);
                setPreview(null);
              } catch (downloadErr) {
                console.error(
                  "[useShareCard] downloadNow failed",
                  downloadErr,
                );
                sonner.error("Download didn't start", {
                  description:
                    "Your browser blocked the download. Try again or check browser settings.",
                  duration: 6000,
                });
              }
            }
          : undefined;
      const { title, description, nextAction } = describeError(e, "confirm", intent);
      notifyError(title, description, nextAction, retry, downloadNow);
      setLastError({
        step: "confirm",
        intent,
        title,
        description,
        nextAction,
        retry,
        downloadNow,
      });
      callbacks.onShareError?.(intent, e);
    } finally {
      setBusy(null);
    }
  }, [preview, callbacks]);

  const cancelPreview = useCallback(() => {
    setPreview(null);
    setLastError(null);
  }, []);

  const dismissError = useCallback(() => setLastError(null), []);

  return {
    busy,
    toast,
    preview,
    prepare,
    confirm,
    cancelPreview,
    lastError,
    dismissError,
  };
}
