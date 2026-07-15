/**
 * v3.44 — Curated card-combination meanings (Phase 3, high-signal batch).
 *
 * Pure data + matcher. Symmetric pairs transcribed faithfully (one line each)
 * from the Tarot Pattern Detection reference, Parts 3–5: Major+Major, the
 * anchor tables (Tower / Death / Devil / Lovers / Sun / Moon / Three of Swords
 * / the Cups trio) and the commonly-cited Minor+Minor pairs.
 *
 * Meanings are traditional Rider-Waite-Smith reading conventions — interpretive,
 * not authoritative. Card names resolve to ids via TAROT_DECK, so this stays
 * decoupled from the numeric deck order.
 */
import { TAROT_DECK } from "./tarot";

export type ComboTheme =
  | "love"
  | "marriage"
  | "abundance"
  | "joy"
  | "pregnancy"
  | "ending"
  | "transformation"
  | "crisis"
  | "warning"
  | "deception"
  | "heartbreak"
  | "fate"
  | "awakening"
  | "spiritual"
  | "power";

type RawCombo = { a: string; b: string; theme: ComboTheme; meaning: string };

const COMBOS: RawCombo[] = [
  // ── Love & union ─────────────────────────────────────────────────────
  { a: "The Lovers", b: "Two of Cups", theme: "love", meaning: "The strongest love signal; soulmate connection, mutual devotion." },
  { a: "The Lovers", b: "Ace of Cups", theme: "love", meaning: "New love blossoming into something meaningful." },
  { a: "The Lovers", b: "Ten of Cups", theme: "love", meaning: "A soulmate bond maturing into family happiness." },
  { a: "The Lovers", b: "Four of Wands", theme: "love", meaning: "A union heading toward engagement, marriage, or moving in." },
  { a: "The Lovers", b: "The Sun", theme: "love", meaning: "Joyful love, family, marriage blessed by light and clarity." },
  { a: "The Lovers", b: "The Empress", theme: "love", meaning: "Fertile love blossoming into marriage, pregnancy, or creative partnership." },
  { a: "The Lovers", b: "The Star", theme: "love", meaning: "Hope restored; healing after heartbreak." },
  { a: "The Lovers", b: "Temperance", theme: "love", meaning: "Balance restored; harmonizing two opposites." },
  { a: "The Lovers", b: "The World", theme: "love", meaning: "Completion of a love cycle; union fulfilled." },
  { a: "The Empress", b: "Two of Cups", theme: "love", meaning: "A relationship deepening into a nurturing partnership." },
  { a: "The Empress", b: "Ace of Cups", theme: "love", meaning: "New love — or a pregnancy announcement." },
  { a: "The Emperor", b: "The Empress", theme: "love", meaning: "The archetypal parents; a stable, lasting partnership or family foundation." },
  { a: "Knight of Cups", b: "The Lovers", theme: "love", meaning: "Being courted by an emotionally available, devoted partner." },
  { a: "Four of Wands", b: "Ten of Cups", theme: "love", meaning: "Celebration of a secure, loving home; weddings." },
  { a: "Two of Cups", b: "Ten of Cups", theme: "love", meaning: "A profound, balanced partnership maturing into shared joy." },
  { a: "Two of Cups", b: "Ace of Cups", theme: "love", meaning: "Deep mutual connection; new romance ready to become partnership." },
  { a: "Two of Cups", b: "Nine of Cups", theme: "love", meaning: "Emotional satisfaction within the bond." },
  { a: "Ace of Cups", b: "Queen of Cups", theme: "love", meaning: "Mature, unconditional love." },

  // ── Marriage, commitment & tradition ─────────────────────────────────
  { a: "The Lovers", b: "The Hierophant", theme: "marriage", meaning: "Tradition blesses love; marriage, engagement, vows." },
  { a: "The Lovers", b: "Justice", theme: "marriage", meaning: "Commitment made official; contracts, licenses, long-term consequences." },
  { a: "The Hierophant", b: "Two of Cups", theme: "marriage", meaning: "Commitment through vows; engagement, marriage." },
  { a: "The Hierophant", b: "Ten of Cups", theme: "marriage", meaning: "Family joy within tradition; marriage, children, a blessed home." },
  { a: "The Hierophant", b: "Three of Cups", theme: "marriage", meaning: "Religious or cultural celebrations — weddings, baptisms." },
  { a: "The Hierophant", b: "Four of Wands", theme: "marriage", meaning: "A wedding or family milestone rooted in tradition." },
  { a: "The Hierophant", b: "Ten of Pentacles", theme: "marriage", meaning: "Legacy, ancestry, a lasting union across generations." },

  // ── Abundance, money & career ────────────────────────────────────────
  { a: "The Empress", b: "Ace of Pentacles", theme: "abundance", meaning: "Abundance and prosperity; a new venture, often pregnancy news." },
  { a: "Ace of Pentacles", b: "Ten of Pentacles", theme: "abundance", meaning: "A new opportunity growing into long-term wealth." },
  { a: "The Sun", b: "Ten of Pentacles", theme: "abundance", meaning: "Long-term security; family wealth made visible." },
  { a: "The Sun", b: "Nine of Pentacles", theme: "abundance", meaning: "Comfort, self-reliance, financial independence." },
  { a: "The Hierophant", b: "Ace of Pentacles", theme: "abundance", meaning: "Financial blessings via institutions; a new job or inheritance." },
  { a: "The Empress", b: "Ten of Pentacles", theme: "abundance", meaning: "Family legacy, generational wealth." },
  { a: "Ten of Cups", b: "Ten of Pentacles", theme: "abundance", meaning: "Ultimate emotional and material fulfillment." },

  // ── Joy & positive outcomes ──────────────────────────────────────────
  { a: "The Sun", b: "Ten of Cups", theme: "joy", meaning: "Complete joy and fulfillment; emotional and family harmony." },
  { a: "The Star", b: "The Sun", theme: "joy", meaning: "Healing hope realized into radiant happiness." },
  { a: "The World", b: "Ten of Cups", theme: "joy", meaning: "Ultimate fulfillment; a chapter completing in emotional abundance." },
  { a: "Nine of Cups", b: "The Sun", theme: "joy", meaning: "The wish card affirmed; contentment and dreams coming true." },
  { a: "The Sun", b: "Six of Wands", theme: "joy", meaning: "Public recognition, victory, earned success." },
  { a: "Six of Wands", b: "The Sun", theme: "joy", meaning: "Public recognition, a clean victory." },
  { a: "The Sun", b: "The World", theme: "joy", meaning: "Joyful, full-circle completion, celebrated openly." },
  { a: "Ten of Cups", b: "Ace of Cups", theme: "joy", meaning: "Ultimate fulfillment plus new beginnings." },
  { a: "Ten of Cups", b: "Three of Cups", theme: "joy", meaning: "Joyful gatherings." },
  { a: "Ten of Cups", b: "Six of Cups", theme: "joy", meaning: "Happy, nostalgic connection." },
  { a: "Ten of Cups", b: "Nine of Cups", theme: "joy", meaning: "Emotional wish fulfillment." },
  { a: "Two of Cups", b: "Three of Cups", theme: "joy", meaning: "Shared celebration." },
  { a: "Ace of Cups", b: "Nine of Cups", theme: "joy", meaning: "An emotional wish fulfilled." },
  { a: "Ten of Cups", b: "Four of Pentacles", theme: "joy", meaning: "Joy found by releasing material attachment and control." },

  // ── Pregnancy & fertility ────────────────────────────────────────────
  { a: "The Empress", b: "The Sun", theme: "pregnancy", meaning: "A healthy, joyful, well-progressing pregnancy." },
  { a: "The Empress", b: "Ace of Wands", theme: "pregnancy", meaning: "Peak fertility; an optimal conception window." },
  { a: "The Empress", b: "Queen of Pentacles", theme: "pregnancy", meaning: "A strong desire for motherhood." },
  { a: "The Empress", b: "Strength", theme: "pregnancy", meaning: "High fertility capacity." },
  { a: "Ace of Wands", b: "Page of Cups", theme: "pregnancy", meaning: "A positive pregnancy test; confirmed conception." },
  { a: "Ace of Cups", b: "Ten of Cups", theme: "pregnancy", meaning: "Birth of a new family member." },
  { a: "Wheel of Fortune", b: "Ace of Cups", theme: "pregnancy", meaning: "An unexpected, surprise pregnancy." },

  // ── Endings, transformation & rebirth ────────────────────────────────
  { a: "Death", b: "Ten of Swords", theme: "ending", meaning: "Absolute, definitive ending; closure with no return." },
  { a: "Death", b: "The Tower", theme: "ending", meaning: "Sudden destruction becomes a permanent, irreversible ending." },
  { a: "Death", b: "Three of Swords", theme: "ending", meaning: "A painful heartbreak or betrayal concluding for good." },
  { a: "Death", b: "Eight of Cups", theme: "ending", meaning: "An emotional walkaway that becomes final." },
  { a: "Death", b: "Ten of Wands", theme: "ending", meaning: "Heavy burdens released permanently." },
  { a: "Death", b: "The Lovers", theme: "ending", meaning: "A relationship or choice ends; a chapter closes." },
  { a: "Death", b: "Judgement", theme: "transformation", meaning: "A final ending leading directly into awakening and renewal." },
  { a: "Death", b: "Ten of Pentacles", theme: "transformation", meaning: "Shifting family legacy; inheritance or generational change." },
  { a: "Death", b: "The Star", theme: "transformation", meaning: "Hope born from loss; the past cleared so light can return." },
  { a: "Death", b: "The Sun", theme: "transformation", meaning: "Darkness dies; joy and vitality reborn." },
  { a: "Death", b: "The Devil", theme: "transformation", meaning: "Chains broken; toxic attachments die, painfully." },
  { a: "Death", b: "Five of Cups", theme: "transformation", meaning: "Grief deepens, then clears space for renewal." },
  { a: "Wheel of Fortune", b: "Death", theme: "fate", meaning: "One cycle closes; a more transformative one begins." },
  { a: "The Tower", b: "The World", theme: "transformation", meaning: "A cycle closes completely; entry to a new level." },
  { a: "Judgement", b: "The World", theme: "transformation", meaning: "Graduation energy; a major cycle completes and a new chapter begins." },

  // ── Crisis, collapse & upheaval ──────────────────────────────────────
  { a: "The Tower", b: "Ten of Swords", theme: "crisis", meaning: "Rock bottom; catastrophic breakdown pointing toward renewal." },
  { a: "The Tower", b: "Three of Swords", theme: "crisis", meaning: "Betrayal or heartbreak revealed through sudden discovery." },
  { a: "The Tower", b: "Ace of Swords", theme: "crisis", meaning: "A truth detonates; the fog clears violently." },
  { a: "The Tower", b: "Five of Cups", theme: "crisis", meaning: "Devastation that ends denial about what was already broken." },
  { a: "The Tower", b: "Five of Pentacles", theme: "crisis", meaning: "A security crisis (job loss, health scare) reveals true support." },
  { a: "Eight of Wands", b: "The Tower", theme: "crisis", meaning: "News hits like lightning; everything moving too fast." },
  { a: "The Tower", b: "The Star", theme: "awakening", meaning: "Hope rising from the ashes; the truth hurts but frees you." },
  { a: "Ten of Swords", b: "Wheel of Fortune", theme: "fate", meaning: "The low point before fortune turns upward." },

  // ── Warning, bondage & addiction ─────────────────────────────────────
  { a: "The Devil", b: "Eight of Swords", theme: "warning", meaning: "Bondage, entrapment, addiction; a self-made, fear-driven cage." },
  { a: "The Devil", b: "Nine of Swords", theme: "warning", meaning: "Anxiety addiction; the mind replaying fear compulsively." },
  { a: "The Devil", b: "The Lovers", theme: "warning", meaning: "Lust eclipses love; obsession overrides connection." },
  { a: "The Devil", b: "Two of Cups", theme: "warning", meaning: "A relationship built on unhealthy dependency or codependence." },
  { a: "The Devil", b: "Four of Pentacles", theme: "warning", meaning: "Greed; hoarding wealth, control, or possessive attachment." },
  { a: "The Devil", b: "Seven of Swords", theme: "warning", meaning: "Self-sabotage and deceit masked as secrecy." },
  { a: "The Devil", b: "Six of Cups", theme: "warning", meaning: "Nostalgia becoming emotional imprisonment; stuck in the past." },
  { a: "The Devil", b: "Ten of Wands", theme: "warning", meaning: "Burdens hardening into servitude." },
  { a: "The Tower", b: "The Devil", theme: "warning", meaning: "Toxic bonds, addiction, or manipulation exposed and broken." },
  { a: "The Devil", b: "The Emperor", theme: "warning", meaning: "Authority corrupts into domination; a controlling figure." },
  { a: "The Devil", b: "The Moon", theme: "warning", meaning: "Obsession, paranoia, manipulation cloud clarity." },
  { a: "The Devil", b: "The Chariot", theme: "warning", meaning: "Ambition consumes ethics; success at any cost, burnout." },
  { a: "Seven of Cups", b: "The Devil", theme: "warning", meaning: "Fantasy and unrealistic desire leading to unfaithful acts." },
  { a: "Five of Cups", b: "The Devil", theme: "warning", meaning: "Guilt and regret anchoring you to past betrayal." },

  // ── Deception, cheating & hidden truths ──────────────────────────────
  { a: "The Moon", b: "Seven of Swords", theme: "deception", meaning: "Hidden deception; secrets and lies — the strongest 'someone's dishonest' pair." },
  { a: "The Moon", b: "The Devil", theme: "deception", meaning: "Illusion feeding temptation, obsession, deceit." },
  { a: "The High Priestess", b: "Seven of Swords", theme: "deception", meaning: "Concealed truths and hidden affairs." },
  { a: "The Tower", b: "The Moon", theme: "deception", meaning: "Sudden revelation of infidelity; a hidden truth surfacing." },
  { a: "Three of Swords", b: "Seven of Swords", theme: "deception", meaning: "Heartbreak caused by betrayal and deception." },
  { a: "Five of Swords", b: "The Devil", theme: "deception", meaning: "Broken trust, manipulation, winning through exploitation." },
  { a: "The Sun", b: "Seven of Swords", theme: "awakening", meaning: "Secrets exposed; a strong 'truth comes out' pairing." },
  { a: "Seven of Cups", b: "The Moon", theme: "deception", meaning: "Illusion overload; fantasies, false hopes, no clarity." },

  // ── Heartbreak & loss ────────────────────────────────────────────────
  { a: "Three of Swords", b: "The Tower", theme: "heartbreak", meaning: "Sudden, shattering heartbreak." },
  { a: "Three of Swords", b: "Death", theme: "heartbreak", meaning: "The painful but final end of a love triangle or betrayal." },
  { a: "The Hierophant", b: "Three of Swords", theme: "heartbreak", meaning: "Heartbreak from rigid rules; divorce or separation." },
  { a: "The Empress", b: "Three of Swords", theme: "heartbreak", meaning: "Miscarriage or loss tied to family." },
  { a: "Three of Swords", b: "Nine of Swords", theme: "heartbreak", meaning: "Grief, anxiety, obsessive sadness — the heaviest despair pairing." },
  { a: "Three of Swords", b: "Five of Cups", theme: "heartbreak", meaning: "Compounded grief; sorrow layered on loss." },
  { a: "Three of Swords", b: "Ten of Swords", theme: "heartbreak", meaning: "An ending that devastates at the collapse point." },
  { a: "Ten of Swords", b: "Three of Swords", theme: "heartbreak", meaning: "Devastating betrayal ending a relationship." },
  { a: "Five of Cups", b: "Six of Cups", theme: "heartbreak", meaning: "Grief softened, or reactivated, by nostalgia." },
  { a: "Eight of Cups", b: "The Moon", theme: "ending", meaning: "Leaving without a clear understanding of the reasons." },

  // ── Fate, destiny & karma ────────────────────────────────────────────
  { a: "The Tower", b: "Wheel of Fortune", theme: "fate", meaning: "A fated, uncontrollable disruption marks a turning point." },
  { a: "Wheel of Fortune", b: "Judgement", theme: "fate", meaning: "A fated turning point; karma closes one cycle and begins another." },
  { a: "Wheel of Fortune", b: "The World", theme: "fate", meaning: "A karmic loop closes; release from repetition." },
  { a: "The Magician", b: "Wheel of Fortune", theme: "fate", meaning: "Using skill to deliberately influence events; a destined meeting." },
  { a: "The High Priestess", b: "Wheel of Fortune", theme: "fate", meaning: "Unseen forces guide destiny's turning." },
  { a: "Justice", b: "Death", theme: "fate", meaning: "Final judgment; karma ends a cycle cleanly." },
  { a: "The Star", b: "Wheel of Fortune", theme: "fate", meaning: "Circumstances shift favorably in destined, well-timed ways." },
  { a: "The Sun", b: "Wheel of Fortune", theme: "fate", meaning: "Fortunate timing and good luck at the right moment." },
  { a: "The Moon", b: "Wheel of Fortune", theme: "fate", meaning: "Fated shifts happen invisibly; understood only in retrospect." },
  { a: "The Lovers", b: "Wheel of Fortune", theme: "fate", meaning: "Fated, karmic love; destined choices." },
  { a: "Wheel of Fortune", b: "Ace of Pentacles", theme: "fate", meaning: "A sudden, fortunate financial opportunity." },
  { a: "Wheel of Fortune", b: "Ace of Wands", theme: "fate", meaning: "Lucky new ventures sparked by chance." },
  { a: "Wheel of Fortune", b: "Eight of Wands", theme: "fate", meaning: "Rapid, fated events; swift movement and news." },

  // ── Awakening, clarity & the spiritual ───────────────────────────────
  { a: "The Star", b: "The World", theme: "awakening", meaning: "A chapter resolves peacefully; quiet victory." },
  { a: "The Sun", b: "The Moon", theme: "awakening", meaning: "The fog lifts; confusion and projection dissolve." },
  { a: "The Moon", b: "The High Priestess", theme: "spiritual", meaning: "Mystical tension between truth and illusion intensifies." },
  { a: "The Moon", b: "The Star", theme: "spiritual", meaning: "Hope guides you through darkness; intuition becomes trustworthy." },
  { a: "The Moon", b: "Judgement", theme: "awakening", meaning: "A soul awakening; confusion becomes understanding." },
  { a: "The Star", b: "The High Priestess", theme: "spiritual", meaning: "Spiritual intuition becomes clear and reliable again." },
  { a: "The Star", b: "The Hermit", theme: "spiritual", meaning: "Solitude becomes therapeutic self-recovery." },
  { a: "Judgement", b: "The Sun", theme: "awakening", meaning: "Public truth; a clean, bright, freeing awakening." },
  { a: "Judgement", b: "The High Priestess", theme: "awakening", meaning: "A spiritual wake-up; intuition undeniable, secrets surface." },
  { a: "Judgement", b: "The Devil", theme: "awakening", meaning: "Awakening from karmic bondage; breaking free from addiction or denial." },
  { a: "The Sun", b: "The Devil", theme: "awakening", meaning: "A toxic attachment loses its power in daylight." },
  { a: "The Star", b: "The Devil", theme: "awakening", meaning: "Breaking free of addiction or obsession; life is possible without the chain." },
  { a: "The Hierophant", b: "The Star", theme: "spiritual", meaning: "A sudden, impactful spiritual awakening." },
  { a: "The High Priestess", b: "The Hierophant", theme: "spiritual", meaning: "Mystical teachings within an established tradition." },
  { a: "The Chariot", b: "Judgement", theme: "awakening", meaning: "'Get up, move' — a turning point demanding immediate action." },
  { a: "Justice", b: "Judgement", theme: "awakening", meaning: "Accountability plus awakening; truth brings consequences and clarity." },

  // ── Power, structure & wisdom ────────────────────────────────────────
  { a: "The Magician", b: "The High Priestess", theme: "power", meaning: "Skill meets intuition; logic balanced with inner knowing." },
  { a: "The Emperor", b: "The High Priestess", theme: "power", meaning: "Visible authority must balance hidden wisdom; behind-the-scenes influence." },
  { a: "The Emperor", b: "The Hierophant", theme: "power", meaning: "Traditional authority and institutional power reinforce one another." },
  { a: "The Emperor", b: "Justice", theme: "power", meaning: "Law in its purest form; authority exercised fairly." },
  { a: "The Emperor", b: "The Chariot", theme: "power", meaning: "Ambition with discipline; drive channeled into order." },
  { a: "The Emperor", b: "Strength", theme: "power", meaning: "Power tempered with compassion, not domination." },
  { a: "The Emperor", b: "The Hermit", theme: "power", meaning: "Solitary wisdom and elder guidance become authority." },
  { a: "The Magician", b: "The Emperor", theme: "power", meaning: "Building something solid; self-employment or business ownership." },
  { a: "The Magician", b: "The World", theme: "power", meaning: "Mastery brings full conclusion; teaching a broad audience." },
  { a: "Strength", b: "The Sun", theme: "power", meaning: "Confident warmth; caring for and protecting others." },
  { a: "Temperance", b: "Strength", theme: "power", meaning: "Excellent emotional mastery and self-control." },
  { a: "The Emperor", b: "Ace of Wands", theme: "power", meaning: "Strong leadership igniting a successful new endeavor." },
  { a: "The Hermit", b: "The Moon", theme: "spiritual", meaning: "Solitude as healing introspection — or a spiral into fear." },
];

// ── name → id resolution (decoupled from numeric deck order) ────────────
const NAME_TO_ID = new Map<string, number>();
TAROT_DECK.forEach((n, i) => NAME_TO_ID.set(n.toLowerCase(), i));
function idOf(name: string): number | null {
  return NAME_TO_ID.get(name.toLowerCase()) ?? null;
}
const pairKey = (x: number, y: number) => (x < y ? `${x}-${y}` : `${y}-${x}`);

export type ComboEntry = { theme: ComboTheme; meaning: string };
const PAIR_MAP = new Map<string, ComboEntry>();
/** Names in COMBOS that failed to resolve (dev diagnostic; empty in a good build). */
export const UNRESOLVED_COMBO_NAMES: string[] = [];
for (const c of COMBOS) {
  const ia = idOf(c.a);
  const ib = idOf(c.b);
  if (ia == null) UNRESOLVED_COMBO_NAMES.push(c.a);
  if (ib == null) UNRESOLVED_COMBO_NAMES.push(c.b);
  if (ia == null || ib == null || ia === ib) continue;
  const k = pairKey(ia, ib);
  if (!PAIR_MAP.has(k)) PAIR_MAP.set(k, { theme: c.theme, meaning: c.meaning });
}

const THEME_LABEL: Record<ComboTheme, string> = {
  love: "love",
  marriage: "commitment",
  abundance: "abundance",
  joy: "joy",
  pregnancy: "pregnancy & fertility",
  ending: "endings",
  transformation: "transformation",
  crisis: "crisis",
  warning: "warning",
  deception: "deception",
  heartbreak: "heartbreak",
  fate: "fate & destiny",
  awakening: "awakening",
  spiritual: "the spiritual",
  power: "power",
};

export type MatchedCombo = {
  aId: number;
  bId: number;
  aName: string;
  bName: string;
  theme: ComboTheme;
  meaning: string;
};

/** Number of unique pairs in the table (for tests / diagnostics). */
export function comboPairCount(): number {
  return PAIR_MAP.size;
}

/**
 * Find every known combination present in the cast, tag the dominant theme
 * (the theme shared by the most matched pairs, when 2+ share one), and return
 * matches ordered dominant-theme-first.
 */
export function matchCombinations(cardIds: number[]): {
  pairs: MatchedCombo[];
  dominantTheme: string | null;
} {
  const uniq = Array.from(new Set(cardIds));
  const pairs: MatchedCombo[] = [];
  for (let i = 0; i < uniq.length; i += 1) {
    for (let j = i + 1; j < uniq.length; j += 1) {
      const entry = PAIR_MAP.get(pairKey(uniq[i], uniq[j]));
      if (!entry) continue;
      pairs.push({
        aId: uniq[i],
        bId: uniq[j],
        aName: TAROT_DECK[uniq[i]] ?? `Card ${uniq[i]}`,
        bName: TAROT_DECK[uniq[j]] ?? `Card ${uniq[j]}`,
        theme: entry.theme,
        meaning: entry.meaning,
      });
    }
  }
  const counts = new Map<ComboTheme, number>();
  for (const p of pairs) counts.set(p.theme, (counts.get(p.theme) ?? 0) + 1);
  let dominant: ComboTheme | null = null;
  let best = 1;
  for (const [t, n] of counts) {
    if (n > best) {
      best = n;
      dominant = t;
    }
  }
  pairs.sort((a, b) => Number(b.theme === dominant) - Number(a.theme === dominant));
  return { pairs, dominantTheme: dominant ? THEME_LABEL[dominant] : null };
}
