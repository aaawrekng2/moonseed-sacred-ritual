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

export type ShareBusyState = null | "share" | "save";

export function useShareCard() {
  const [busy, setBusy] = useState<ShareBusyState>(null);
  const [toast, setToast] = useState<string | null>(null);

  const flash = (msg: string, ms = 1800) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), ms);
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
      return toPng(node, {
        pixelRatio: 1,
        cacheBust: true,
        backgroundColor,
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
        }
      } catch (e) {
        if ((e as { name?: string })?.name !== "AbortError") {
          console.error("[useShareCard] share failed", e);
          flash("Couldn't share");
        }
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
      } finally {
        setBusy(null);
      }
    },
    [renderToPng],
  );

  return { busy, toast, share, save };
}
