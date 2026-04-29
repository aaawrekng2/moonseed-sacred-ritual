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

export function useShareCard() {
  const [busy, setBusy] = useState<ShareBusyState>(null);
  const [toast, setToast] = useState<string | null>(null);

  const flash = (msg: string, ms = 1800) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), ms);
  };

  /**
   * Friendly, actionable error message based on the underlying failure.
   * Returned strings are short enough to fit in a sonner toast title.
   */
  const describeError = (e: unknown): { title: string; description: string } => {
    const err = e as { name?: string; message?: string } | null | undefined;
    const name = err?.name ?? "";
    const msg = (err?.message ?? "").toLowerCase();
    if (name === "NotAllowedError" || msg.includes("permission")) {
      return {
        title: "Share permission denied",
        description:
          "Your browser blocked the share. Try Save image instead, or allow sharing in browser settings.",
      };
    }
    if (msg.includes("tainted") || msg.includes("cors") || msg.includes("security")) {
      return {
        title: "Couldn't render share image",
        description:
          "An image on the card couldn't be captured (cross-origin block). Try again, or use Save image.",
      };
    }
    if (msg.includes("network") || msg.includes("fetch")) {
      return {
        title: "Network hiccup while sharing",
        description: "Check your connection and try again.",
      };
    }
    return {
      title: "Couldn't create share image",
      description:
        "Something went wrong rendering the card. Tap Retry, or use Save image as a fallback.",
    };
  };

  const notifyError = (
    e: unknown,
    fallbackTitle: string,
    onRetry: () => void,
  ) => {
    const { title, description } = describeError(e);
    sonner.error(title === "Couldn't create share image" ? fallbackTitle : title, {
      description,
      action: {
        label: "Retry",
        onClick: () => {
          onRetry();
        },
      },
      duration: 8000,
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

  const share = useCallback(
    async (node: HTMLElement, backgroundColor: string) => {
      try {
        setBusy("share");
        const dataUrl = await renderToPng(node, backgroundColor);
        const blob = await (await fetch(dataUrl)).blob();
        const file = new File(
          [blob],
          `moonseed-${new Date().toISOString().slice(0, 10)}.png`,
          { type: "image/png" },
        );
        const nav = navigator as Navigator & {
          canShare?: (data: ShareData) => boolean;
        };
        if (nav.canShare && nav.canShare({ files: [file] })) {
          await nav.share({ files: [file], title: "Moonseed" });
          flash("Shared");
        } else {
          downloadDataUrl(dataUrl, file.name);
          flash("Saved (sharing not supported)");
          sonner.info("Sharing isn't supported here", {
            description: "We saved the image instead so you can share it manually.",
            duration: 5000,
          });
        }
      } catch (e) {
        // User dismissing the native share sheet is not an error.
        if ((e as { name?: string })?.name === "AbortError") return;
        console.error("[useShareCard] share failed", e);
        flash("Couldn't share");
        notifyError(e, "Couldn't share", () => {
          void share(node, backgroundColor);
        });
      } finally {
        setBusy(null);
      }
    },
    [renderToPng],
  );

  const save = useCallback(
    async (node: HTMLElement, backgroundColor: string) => {
      try {
        setBusy("save");
        const dataUrl = await renderToPng(node, backgroundColor);
        downloadDataUrl(
          dataUrl,
          `moonseed-${new Date().toISOString().slice(0, 10)}.png`,
        );
        flash("Image saved");
      } catch (e) {
        console.error("[useShareCard] save failed", e);
        flash("Couldn't save");
        notifyError(e, "Couldn't save image", () => {
          void save(node, backgroundColor);
        });
      } finally {
        setBusy(null);
      }
    },
    [renderToPng],
  );

  return { busy, toast, share, save };
}
