/**
 * CSV import — known-format detection (CS).
 *
 * Recognizes named tarot-app exports by header signature so the wizard
 * can pre-fill column mappings and skip the manual mapping step. The
 * "generic" entry is the catch-all fallback.
 */

export type MoonseedField =
  | "date"
  | "created_at_override"
  | "question"
  | "notes"
  | "tags"
  | "card_1" | "card_2" | "card_3" | "card_4" | "card_5"
  | "card_6" | "card_7" | "card_8" | "card_9" | "card_10"
  | "card_1_reversed" | "card_2_reversed" | "card_3_reversed"
  | "card_4_reversed" | "card_5_reversed" | "card_6_reversed"
  | "card_7_reversed" | "card_8_reversed" | "card_9_reversed"
  | "card_10_reversed"
  | "card_1_position" | "card_2_position" | "card_3_position"
  | "card_4_position" | "card_5_position" | "card_6_position"
  | "card_7_position" | "card_8_position" | "card_9_position"
  | "card_10_position"
  | "ignore";

export type FormatId = "tarotpulse" | "generic";

export type FormatSignature = {
  id: FormatId;
  label: string;
  detect: (headers: string[]) => boolean;
  preMap?: Record<string, MoonseedField>;
};

function buildTarotPulsePreMap(): Record<string, MoonseedField> {
  const map: Record<string, MoonseedField> = {
    Date: "date",
    "Question Text": "question",
    Notes: "notes",
    Tags: "tags",
    "Created At": "created_at_override",
  };
  for (let i = 1; i <= 10; i++) {
    map[`Card ${i}`] = `card_${i}` as MoonseedField;
    map[`Card ${i} Reversed`] = `card_${i}_reversed` as MoonseedField;
    map[`Card ${i} Position`] = `card_${i}_position` as MoonseedField;
  }
  return map;
}

export const KNOWN_FORMATS: FormatSignature[] = [
  {
    id: "tarotpulse",
    label: "TarotPulse",
    detect: (h) =>
      [
        "Date",
        "Question Text",
        "Notes",
        "Tags",
        "Card 1",
        "Card 1 Reversed",
        "Card 1 Position",
      ].every((expected) => h.includes(expected)),
    preMap: buildTarotPulsePreMap(),
  },
  {
    id: "generic",
    label: "Generic CSV",
    detect: () => true,
  },
];

export function detectFormat(headers: string[]): FormatSignature {
  for (const f of KNOWN_FORMATS) {
    if (f.detect(headers)) return f;
  }
  return KNOWN_FORMATS[KNOWN_FORMATS.length - 1];
}

/** Suggest a Moonseed field for a single CSV header by fuzzy keyword match. */
export function suggestField(header: string): MoonseedField {
  const h = header.trim().toLowerCase().replace(/[._-]/g, " ").replace(/\s+/g, " ");
  if (!h) return "ignore";

  // Card N reversed / position checks first (more specific).
  const cardN = h.match(/^card\s*(\d{1,2})(.*)$/) || h.match(/^c\s*(\d{1,2})(.*)$/);
  if (cardN) {
    const n = Number(cardN[1]);
    if (n >= 1 && n <= 10) {
      const rest = cardN[2].trim();
      if (/(reversed|reverse|orientation|inverted)/.test(rest)) {
        return `card_${n}_reversed` as MoonseedField;
      }
      if (/(position|slot|pos|spot|placement)/.test(rest)) {
        return `card_${n}_position` as MoonseedField;
      }
      return `card_${n}` as MoonseedField;
    }
  }
  if (h === "first card") return "card_1";
  if (h === "second card") return "card_2";
  if (h === "third card") return "card_3";

  if (/(^|\s)(date|reading date|drawn|drawn at|date drawn)(\s|$)/.test(h)) return "date";
  if (/(created|imported|inserted)/.test(h) && /(at|on|date|time)/.test(h)) {
    return "created_at_override";
  }
  if (/(question|query|prompt|ask|intention)/.test(h)) return "question";
  if (/(notes?|description|comments?|reflection|journal|interpretation)/.test(h)) {
    return "notes";
  }
  if (/(tags?|labels?|categories|category|topics?)/.test(h)) return "tags";

  return "ignore";
}