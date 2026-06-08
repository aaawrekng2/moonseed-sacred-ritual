/**
 * EK72 — /card-numbering reference page.
 *
 * A standalone, URL-only reference (not pinned in nav) that shows all 78
 * tarot cards in canonical order so seekers know exactly how to name their
 * scanned card images for bulk import. Each card shows its art with the
 * filename convention below it: NN_name — the zero-padded index (00..77),
 * an underscore, then the lowercased card name with "the" dropped and spaces
 * turned into underscores (e.g. 00_fool, 12_hanged_man, 22_ace_of_wands).
 *
 * This NN_name scheme round-trips cleanly through the deck-import matcher
 * (majors match on keyword + number, minors on rank + suit words).
 *
 * Hovering any card opens the shared rich popover (CardHoverTip) with the
 * data card only (showConstellation={false}) — the constellation web is
 * omitted since a first-time importer has little co-occurrence data yet.
 *
 * The TopNav rail renders here (route is registered in TOP_NAV_ROUTES), so
 * the bottom nav defers and seekers can navigate away from the top.
 */
import { createFileRoute } from "@tanstack/react-router";
import { getCardName } from "@/lib/tarot";
import { CardImage } from "@/components/card/CardImage";
import { CardHoverTip } from "@/components/card/CardRichPopover";
import { DEFAULT_FILTERS } from "@/lib/insights.types";

export const Route = createFileRoute("/card-numbering")({
  head: () => ({
    meta: [
      { title: "Card numbering — Tarot Seed" },
      {
        name: "description",
        content:
          "Name your scanned card images for import: the card number, an underscore, then the card name.",
      },
    ],
  }),
  component: CardNumberingPage,
});

/** NN_name slug for a card id: "00_fool", "12_hanged_man", "22_ace_of_wands". */
function fileLabel(id: number): string {
  const name = getCardName(id);
  const slug = name
    .replace(/^the\s+/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${String(id).padStart(2, "0")}_${slug}`;
}

const CARD_IDS = Array.from({ length: 78 }, (_, i) => i);

function CardNumberingPage() {
  return (
    <div
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "12px 16px 56px",
      }}
    >
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontStyle: "italic",
          fontSize: "var(--text-heading-lg)",
          color: "var(--color-foreground)",
          textAlign: "center",
          margin: "8px 0 6px",
        }}
      >
        Card numbering
      </h1>
      <p
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: "var(--text-body-sm)",
          color: "var(--color-foreground-muted)",
          textAlign: "center",
          lineHeight: 1.6,
          maxWidth: 460,
          margin: "0 auto 24px",
        }}
      >
        Name each scanned image with its number, an underscore, then the card
        name — for example{" "}
        <span style={{ fontFamily: "var(--font-mono)" }}>00_fool</span>. Hover
        any card to preview its details.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))",
          gap: 18,
        }}
      >
        {CARD_IDS.map((id) => (
          <div
            key={id}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 7,
            }}
          >
            <CardHoverTip
              cardId={id}
              filters={DEFAULT_FILTERS}
              showConstellation={false}
            >
              <CardImage cardId={id} variant="face" size="custom" widthPx={96} />
            </CardHoverTip>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-caption)",
                color: "var(--color-foreground)",
                textAlign: "center",
                wordBreak: "break-word",
                lineHeight: 1.3,
              }}
            >
              {fileLabel(id)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
