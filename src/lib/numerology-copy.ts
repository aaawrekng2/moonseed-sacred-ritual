/**
 * Q51a — Static archetype copy for numerology numbers.
 * Used by Numerology page UI in Q51b+.
 * Tarot Seed voice: oracle / serif / italic / brief.
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
 * reduce to is used by the caller. Tarot Seed voice: serif, italic,
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

// ===== Q52c — Cycles copy: Pinnacles, Challenges, Period Cycles, Personal Year =====

export const PINNACLE_MEANINGS: Record<number, NumberMeaning> = {
  1: { keyword: "Self & Independence", short: "A chapter of becoming your own person.", full: "This chapter asks you to stand on your own feet — to choose your direction and walk it without waiting for company. The work is initiation; the gift is sovereignty." },
  2: { keyword: "Partnership & Patience", short: "A chapter of softening and cooperation.", full: "A long apprenticeship in relationship. You learn to listen, to share the weight, to build with someone rather than past them. The reward is intimacy that does not erode the self." },
  3: { keyword: "Expression & Joy", short: "A chapter of voice, creation, and lightness.", full: "Your voice wants to leave the body. Make, speak, sing, write — let colour out of you. This chapter rewards the willingness to be seen mid-bloom." },
  4: { keyword: "Foundation & Discipline", short: "A chapter of building stability.", full: "Stone upon stone. Slow, patient, devotional work that outlasts the mood that began it. Glamour is scarce; ground is abundant." },
  5: { keyword: "Change & Adventure", short: "A chapter of movement and reinvention.", full: "Plans rearrange themselves; the body wants to travel. Stay loose. The lesson is to ride change rather than brace against it." },
  6: { keyword: "Love & Service", short: "A chapter of family, harmony, and care.", full: "Hearth, home, and the long arts of devotion. You are weaving the people around you into something that holds — without losing yourself in the weaving." },
  7: { keyword: "Wisdom & Solitude", short: "A chapter of inner study and depth.", full: "The hermit on the hill. Pull back, study, listen. Truths arrive in the quiet that crowds cannot deliver." },
  8: { keyword: "Power & Mastery", short: "A chapter of material and worldly achievement.", full: "Authority, money, and the visible use of influence rise toward you. Hold them with integrity and they bless what you build." },
  9: { keyword: "Completion & Humanitarianism", short: "A chapter of release and service to the larger whole.", full: "A great circle is closing. You give back what you have learned and let what is finished go cleanly. Wisdom is the harvest." },
  11: { keyword: "Illumination", short: "A chapter of intuition and spiritual sight.", full: "The veil thins. You receive what others cannot yet see. Protect the channel — sensitivity is the price of clarity." },
  22: { keyword: "Master Building", short: "A chapter of manifesting the grand vision.", full: "Vision married to hand. Bring large things into form, slowly, faithfully, with others. Do not shrink the dream to fit the room." },
  33: { keyword: "Master Teaching", short: "A chapter of service through love.", full: "Teach by presence. Love at scale, without losing the small and tender places in yourself. Compassion becomes the discipline." },
};

export const CHALLENGE_MEANINGS: Record<number, NumberMeaning> = {
  0: { keyword: "Amplified Test", short: "Tested on all fronts — a season of rapid spiritual growth.", full: "All challenges are available; the soul chose the full curriculum. Meet each test as it comes and the chapter forges unusual depth." },
  1: { keyword: "Asserting Self", short: "Learning to lead without overpowering.", full: "The work is to claim your direction without needing to flatten anyone else's. Real leadership grows from rooted self-trust, not volume." },
  2: { keyword: "Sensitivity", short: "Learning to feel without being consumed.", full: "Other people's weather moves through you. The challenge is to stay porous without losing your own shape." },
  3: { keyword: "Scattered Focus", short: "Learning to channel creative energy.", full: "Inspiration is plentiful; finishing is rare. The work is to choose one thread and follow it all the way to a finished thing." },
  4: { keyword: "Rigidity", short: "Learning structure without becoming brittle.", full: "Discipline that cannot bend will break. The challenge is to build a life solid enough to hold you and soft enough to let you grow." },
  5: { keyword: "Restlessness", short: "Learning freedom without recklessness.", full: "The wanting to leave is constant. The work is to discern when motion is the medicine and when it is the avoidance." },
  6: { keyword: "Burden of Care", short: "Learning to serve without self-erasure.", full: "Responsibility for others can become the place you hide. The challenge is to give from fullness, not from the desire to be needed." },
  7: { keyword: "Isolation", short: "Learning solitude without withdrawal.", full: "Depth wants quiet; the soul also wants to be known. The work is to take the inner journey without disappearing from your own life." },
  8: { keyword: "Material Test", short: "Learning power without grasping.", full: "Money and authority test the hand that holds them. Wield real power for what it can build — not for the proof that you have it." },
};

export const PERIOD_CYCLE_MEANINGS: Record<number, NumberMeaning> = {
  1: { keyword: "Self-Direction", short: "A phase of asserting independence.", full: "The early work of choosing your own path. You are learning to begin, to stand alone long enough for direction to clarify." },
  2: { keyword: "Cooperation", short: "A phase of partnership and patience.", full: "You grow through relationship. Listening, weighing, partnering — these are the soul's apprenticeship in this phase." },
  3: { keyword: "Expression", short: "A phase of creativity and voice.", full: "A long season of making and speaking. The work is to let what is in you out, in colour and word and song." },
  4: { keyword: "Foundation", short: "A phase of structure and persistence.", full: "Slow building. You lay ground others will eventually stand on, including the future self you are becoming." },
  5: { keyword: "Change", short: "A phase of motion and learning.", full: "Travel, study, reinvention. The phase rewards the willingness to be a beginner more than once." },
  6: { keyword: "Service", short: "A phase of love and responsibility.", full: "Family, hearth, devotion. You are tending — to people, to beauty, to the conditions in which others can flourish." },
  7: { keyword: "Inner Work", short: "A phase of reflection and study.", full: "A long inward turn. Solitude becomes a teacher; depth becomes the gift you carry forward." },
  8: { keyword: "Achievement", short: "A phase of building and stewarding power.", full: "Visible mastery. Material and structural success arrive in proportion to the integrity that holds them." },
  9: { keyword: "Completion", short: "A phase of release and wisdom-sharing.", full: "An era closes. You give back what you have learned and let what is finished go, with grace." },
  11: { keyword: "Illumination", short: "A phase of heightened intuition.", full: "A long stretch of thinned veil. Insight arrives unbidden; the work is to honour and protect the channel." },
  22: { keyword: "Master Building", short: "A phase of grand-scale manifestation.", full: "Vision becomes architecture. You build the kind of structure that outlives its builder." },
  33: { keyword: "Master Teaching", short: "A phase of devotional service.", full: "Love made visible at scale. Presence itself becomes the lesson you offer." },
};

export const PERSONAL_YEAR_MEANINGS: Record<number, NumberMeaning> = {
  1: { keyword: "Year of Beginnings", short: "Plant the seed. Set the direction.", full: "A new nine-year cycle opens. Choose with care — what you start now shapes the next decade. Move first; perfection comes later." },
  2: { keyword: "Year of Patience", short: "Build slowly. Cooperate.", full: "The soil is still settling. Partner, listen, wait. Forced action this year tends to undo itself; gentle action compounds." },
  3: { keyword: "Year of Joy", short: "Create. Express. Celebrate.", full: "Voice wants out. Make, share, gather, play. The work is to enjoy the work — your colour returns to the room." },
  4: { keyword: "Year of Foundation", short: "Build the structure. Work the work.", full: "Steady hands. Discipline, systems, ground. Glamour is thin; what you build this year holds for years." },
  5: { keyword: "Year of Change", short: "Expect the unexpected. Stay flexible.", full: "Plans rearrange. Travel, pivots, surprise openings. Stay loose; the year rewards adaptability over control." },
  6: { keyword: "Year of Service", short: "Tend to home, family, love.", full: "Hearth and harmony. Relationships, beauty, and care take the foreground. Tend without losing yourself in the tending." },
  7: { keyword: "Year of Reflection", short: "Turn inward. Study. Listen.", full: "A quieter chapter. Less doing, more sensing. Truths surface that the busy years could not bring forward." },
  8: { keyword: "Year of Power", short: "Step into mastery. Steward abundance.", full: "Visible return. Money, authority, recognition arrive in proportion to the work. Hold them with integrity." },
  9: { keyword: "Year of Completion", short: "Release. Forgive. Make space.", full: "An era ends. Let go cleanly — the next 1 year cannot fully arrive while you cling to what is finished." },
  11: { keyword: "Master Year of Illumination", short: "Heightened intuition. Listen carefully.", full: "A 2 year intensified to a master octave. Insight is unusually available; sensitivity is too. Move slowly and protect the channel." },
  22: { keyword: "Master Year of Building", short: "A grand structure wants to come through.", full: "A 4 year intensified. Large-scale building is favoured — vision married to discipline. Do not shrink the dream." },
  33: { keyword: "Master Year of Teaching", short: "Love made visible.", full: "A 6 year intensified. Service through presence is the calling. Lead by tending; teach by being tended-to first." },
};