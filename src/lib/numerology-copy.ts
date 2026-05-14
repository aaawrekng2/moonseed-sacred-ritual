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

// ===== Q52b — Karmic Debt, Karmic Lessons, Letter Energy =====

export const KARMIC_DEBT_MEANINGS: Record<number, NumberMeaning> = {
  13: {
    keyword: "The Sacred Labor",
    short: "Build through effort, not shortcuts.",
    full: "A debt of discipline. In another lifetime the easy road was chosen; this time the work itself is the medicine. Lay one stone, then another — refuse the shortcut and the foundation becomes unshakable.",
  },
  14: {
    keyword: "The Disciplined Freedom",
    short: "Master restraint, then receive abundance.",
    full: "A debt of moderation. Once, the senses ruled; now they must be apprenticed. Freedom returns when desire learns to serve the soul instead of devouring it.",
  },
  16: {
    keyword: "The Tower's Lesson",
    short: "Pride dismantled, ego rebuilt in truth.",
    full: "A debt of humility. Structures built on ego will fall — and the falling is the gift. What rises after is yours, finally and truly.",
  },
  19: {
    keyword: "The Solitary Sun",
    short: "Stand in your own light, alone if needed.",
    full: "A debt of self-reliance. In another life, power was used over others; here it must be carried without leaning on them. The reward is sovereignty — light that needs no audience.",
  },
};

export const KARMIC_LESSON_MEANINGS: Record<number, NumberMeaning> = {
  1: {
    keyword: "Underdeveloped 1",
    short: "Learning to lead.",
    full: "Initiative does not yet feel native. The lesson is to choose first — to begin without waiting for permission, and to let your direction become a path others can follow.",
  },
  2: {
    keyword: "Underdeveloped 2",
    short: "Learning to partner.",
    full: "Cooperation, patience, and the soft arts of relationship are the work. The lesson is to listen as deeply as you speak, and to trust that softness is also strength.",
  },
  3: {
    keyword: "Underdeveloped 3",
    short: "Learning to express.",
    full: "Voice, joy, and creative play feel held back. The lesson is to make — to risk being seen, to let colour leave the body before it dims inside it.",
  },
  4: {
    keyword: "Underdeveloped 4",
    short: "Learning to build.",
    full: "Structure and follow-through are the apprenticeship. The lesson is to stay — to finish what you start, slowly, and to discover that ground is freedom too.",
  },
  5: {
    keyword: "Underdeveloped 5",
    short: "Learning to flow.",
    full: "Change, risk, and the body's appetite for adventure are underused. The lesson is to move — to release the grip and let life surprise you again.",
  },
  6: {
    keyword: "Underdeveloped 6",
    short: "Learning to tend.",
    full: "Responsibility for others — and for beauty — is the work. The lesson is to weave a hearth, to take loving care without losing yourself in the giving.",
  },
  7: {
    keyword: "Underdeveloped 7",
    short: "Learning to seek.",
    full: "Solitude, depth, and the inward turn are unfamiliar. The lesson is to sit in the quiet long enough for what is true to surface.",
  },
  8: {
    keyword: "Underdeveloped 8",
    short: "Learning to hold power.",
    full: "Money, authority, and the visible use of force feel foreign. The lesson is to claim — to wield real power with integrity, neither apologising for it nor weaponising it.",
  },
  9: {
    keyword: "Underdeveloped 9",
    short: "Learning to complete.",
    full: "Endings, release, and service to something larger are the work. The lesson is to let go cleanly — and to discover the wisdom that comes with closing a circle well.",
  },
};

export const LETTER_ENERGY_MEANINGS: Record<number, string> = {
  1: "Begins with bold initiative — first foot forward, decisively.",
  2: "Begins gently — sensing the room before stepping into it.",
  3: "Begins with expression — a word, a song, a coloured gesture.",
  4: "Begins by laying ground — methodically, stone by stone.",
  5: "Begins in motion — the doorway opens and you are already through.",
  6: "Begins by tending — making a place soft enough for what comes next.",
  7: "Begins inwardly — a long pause, then a quiet, considered step.",
  8: "Begins with strategy — measuring scope before commitment.",
  9: "Begins from completion — closing the last circle to free the new one.",
};