/**
 * Q51a — Static archetype copy for numerology numbers.
 * Used by Numerology page UI in Q51b+.
 * Moonseed voice: oracle / serif / italic / brief.
 */

export type NumberMeaning = {
  keyword: string; // 2-4 word headline
  short: string; // 1-sentence description
  full: string; // 2-3 sentence expansion
};

export const NUMBER_MEANINGS: Record<number, NumberMeaning> = {
  1: {
    keyword: "Beginnings",
    short: "The spark of new direction.",
    full: "The first breath of any cycle. You are asked to lead, to begin, to stand alone before the path is clear. Initiation is yours, and so is its risk.",
  },
  2: {
    keyword: "Balance",
    short: "Partnership and duality.",
    full: "Two lights in conversation. The work is to listen, to soften, to weigh what cannot be measured. Your power moves through relationship, not domination.",
  },
  3: {
    keyword: "Creation",
    short: "Self-expression and joy.",
    full: "The blossoming of voice. You are made to make — to speak, to sing, to bring colour into a room. Hide this and the gift turns inward and dims.",
  },
  4: {
    keyword: "Foundation",
    short: "Structure and stability.",
    full: "Stone upon stone. Slow, patient, devotional work that outlasts the mood that built it. The reward is not glamour but ground others can stand on.",
  },
  5: {
    keyword: "Freedom",
    short: "Change and movement.",
    full: "The wind through the loom. Restless, curious, unwilling to be pinned. The lesson is to choose movement that serves the spirit, not movement that flees it.",
  },
  6: {
    keyword: "Harmony",
    short: "Love, family, and service.",
    full: "The hearth-keeper. Beauty, care, and the long arts of devotion. Your gift is to weave the people around you into something that holds — without losing yourself in the weaving.",
  },
  7: {
    keyword: "Inner Wisdom",
    short: "Solitude and seeking.",
    full: "The hermit on the hill. You were given depth in place of speed. Trust what comes in silence, and protect the quiet that lets it arrive.",
  },
  8: {
    keyword: "Power",
    short: "Mastery and abundance.",
    full: "The architect of the visible world. Money, authority, and the long use of influence. Power held without integrity becomes the wound it once tried to heal.",
  },
  9: {
    keyword: "Completion",
    short: "Endings and wisdom.",
    full: "The closing of a great circle. You carry the memory of every threshold you have crossed. The work is to release with grace what is already finished.",
  },
  11: {
    keyword: "Intuition",
    short: "Master illumination.",
    full: "A thinner veil than most. You receive what others cannot yet see. The cost of clarity is sensitivity — protect the channel and trust what arrives through it.",
  },
  22: {
    keyword: "Master Builder",
    short: "Manifest the grand vision.",
    full: "Vision married to hand. You are made to bring large things into form — slowly, faithfully, with others. The temptation is to shrink the dream; the calling is to honour it.",
  },
  33: {
    keyword: "Master Teacher",
    short: "Service through love.",
    full: "The teacher whose lesson is presence itself. You are asked to love at scale, without losing the small and tender places in yourself. Compassion is the discipline.",
  },
};

/**
 * Q51b — Moon × Numerology synthesis lookup.
 *
 * Static composition of (digit 1-9) × (8 moon phases) = 72 short oracle
 * lines. Built programmatically at module load to keep this file small
 * while still satisfying the lookup contract: callers do
 * `MOON_NUMEROLOGY_SYNTHESIS["${digit}_${phase}"]` and fall back to
 * `NUMBER_MEANINGS[digit].short` if missing.
 *
 * Master numbers (11/22/33) are not separately keyed; the digit they
 * reduce to is used by the caller. Moonseed voice: serif, italic,
 * brief, never longer than ~120 chars.
 */

const DIGIT_SUBJECT: Record<number, string> = {
  1: "A beginning",
  2: "A partnership",
  3: "A creation",
  4: "A foundation",
  5: "A change",
  6: "A tending",
  7: "An inward turn",
  8: "A held power",
  9: "A completion",
};

const PHASE_CLAUSE: Record<string, string> = {
  "New Moon": "meets the dark — plant the seed before you can see it.",
  "Waxing Crescent": "draws its first breath — name what you intend.",
  "First Quarter": "asks for a decision — choose, then commit the body.",
  "Waxing Gibbous": "gathers momentum — refine, do not rush the bloom.",
  "Full Moon": "stands fully lit — see what you have actually built.",
  "Waning Gibbous": "gives thanks and teaches — share what is already true.",
  "Last Quarter": "asks what to release — forgive the version that brought you here.",
  "Waning Crescent": "rests in the long quiet — listen before the next seed.",
};

function buildSynthesis(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let d = 1; d <= 9; d++) {
    for (const phase of Object.keys(PHASE_CLAUSE)) {
      out[`${d}_${phase}`] = `${DIGIT_SUBJECT[d]} ${PHASE_CLAUSE[phase]}`;
    }
  }
  return out;
}

export const MOON_NUMEROLOGY_SYNTHESIS: Record<string, string> = buildSynthesis();