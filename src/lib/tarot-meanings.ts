/**
 * Q64 — Standard Rider-Waite-Smith card meanings, indexed by card id (0..77).
 * Used by the Card Trace page (`src/routes/insights.card.$cardId.tsx`).
 *
 * Majors: 0..21 (individual elemental, zodiac, planetary correspondences).
 * Minors: 22..77 (Wands=Fire, Cups=Water, Swords=Air, Pentacles=Earth).
 */
export type YesNo = "yes" | "no" | "maybe";

export type CardMeaning = {
  name: string;
  uprightKeywords: string[];
  reversedKeywords: string[];
  uprightMeaning: string;
  reversedMeaning: string;
  element: string;
  zodiac: string | null;
  planet: string | null;
  numerology: number | null;
  yesNo: YesNo;
};

export const TAROT_MEANINGS: Record<number, CardMeaning> = {
  "0": {
    "name": "The Fool",
    "uprightKeywords": [
      "beginnings",
      "innocence",
      "spontaneity",
      "free spirit"
    ],
    "reversedKeywords": [
      "recklessness",
      "hesitation",
      "naivety",
      "risk"
    ],
    "uprightMeaning": "A leap of faith into the unknown. Fresh starts, open horizons, and the courage to begin without all the answers.",
    "reversedMeaning": "Hesitation born of fear, or leaping without looking. Reconsider the timing or the recklessness of the next step.",
    "element": "Air",
    "zodiac": null,
    "planet": "Uranus",
    "numerology": 0,
    "yesNo": "yes"
  },
  "1": {
    "name": "The Magician",
    "uprightKeywords": [
      "manifestation",
      "willpower",
      "skill",
      "action"
    ],
    "reversedKeywords": [
      "trickery",
      "untapped potential",
      "manipulation"
    ],
    "uprightMeaning": "You hold every tool you need. Channel intention into clear, decisive action and the world responds.",
    "reversedMeaning": "Power scattered or misused. Self-deception, distraction, or a gap between what you say and what you do.",
    "element": "Air",
    "zodiac": null,
    "planet": "Mercury",
    "numerology": 1,
    "yesNo": "yes"
  },
  "2": {
    "name": "The High Priestess",
    "uprightKeywords": [
      "intuition",
      "mystery",
      "inner knowing",
      "the subconscious"
    ],
    "reversedKeywords": [
      "secrets revealed",
      "blocked intuition",
      "withdrawal"
    ],
    "uprightMeaning": "Trust the quiet voice beneath the noise. Wisdom rises from stillness, not striving.",
    "reversedMeaning": "Ignored intuition or hidden things rising to the surface. The veil thins; pay attention.",
    "element": "Water",
    "zodiac": null,
    "planet": "Moon",
    "numerology": 2,
    "yesNo": "maybe"
  },
  "3": {
    "name": "The Empress",
    "uprightKeywords": [
      "abundance",
      "nurture",
      "creativity",
      "sensuality"
    ],
    "reversedKeywords": [
      "creative block",
      "dependence",
      "smothering"
    ],
    "uprightMeaning": "Life flowering through care, beauty, and embodied creativity. Tend what you love and watch it grow.",
    "reversedMeaning": "Creative drought or care turned into control. Reconnect with your senses and your own ground.",
    "element": "Earth",
    "zodiac": null,
    "planet": "Venus",
    "numerology": 3,
    "yesNo": "yes"
  },
  "4": {
    "name": "The Emperor",
    "uprightKeywords": [
      "structure",
      "authority",
      "leadership",
      "stability"
    ],
    "reversedKeywords": [
      "rigidity",
      "control",
      "domination"
    ],
    "uprightMeaning": "Order, boundaries, and strength applied with discipline. A solid frame holds the future you're building.",
    "reversedMeaning": "Power that has hardened into rigidity. Where might leadership soften without losing its spine?",
    "element": "Fire",
    "zodiac": "Aries",
    "planet": null,
    "numerology": 4,
    "yesNo": "yes"
  },
  "5": {
    "name": "The Hierophant",
    "uprightKeywords": [
      "tradition",
      "learning",
      "ritual",
      "belonging"
    ],
    "reversedKeywords": [
      "dogma",
      "rebellion",
      "unconventionality"
    ],
    "uprightMeaning": "Wisdom passed down through teachers, lineages, and practice. There is value in the well-trodden path.",
    "reversedMeaning": "An invitation to question the inherited rules. Walk your own path even when it costs you belonging.",
    "element": "Earth",
    "zodiac": "Taurus",
    "planet": null,
    "numerology": 5,
    "yesNo": "maybe"
  },
  "6": {
    "name": "The Lovers",
    "uprightKeywords": [
      "union",
      "choice",
      "alignment",
      "partnership"
    ],
    "reversedKeywords": [
      "misalignment",
      "indecision",
      "disharmony"
    ],
    "uprightMeaning": "A meaningful choice rooted in values. When head and heart align, the way forward is unmistakable.",
    "reversedMeaning": "Tension between what you want and what you've chosen. Check the alignment before going further.",
    "element": "Air",
    "zodiac": "Gemini",
    "planet": null,
    "numerology": 6,
    "yesNo": "yes"
  },
  "7": {
    "name": "The Chariot",
    "uprightKeywords": [
      "willpower",
      "victory",
      "momentum",
      "focus"
    ],
    "reversedKeywords": [
      "scattered",
      "lack of control",
      "defeat"
    ],
    "uprightMeaning": "Forward motion through directed will. Hold the reins of opposing forces and ride them toward your aim.",
    "reversedMeaning": "Direction is unclear or competing impulses are stalling progress. Reclaim the reins.",
    "element": "Water",
    "zodiac": "Cancer",
    "planet": null,
    "numerology": 7,
    "yesNo": "yes"
  },
  "8": {
    "name": "Strength",
    "uprightKeywords": [
      "courage",
      "gentleness",
      "inner power",
      "patience"
    ],
    "reversedKeywords": [
      "self-doubt",
      "force",
      "weakness"
    ],
    "uprightMeaning": "Quiet courage tames what seemed wild. Soft hands, steady heart — the lion lays down willingly.",
    "reversedMeaning": "Fear masquerading as weakness, or force where tenderness was needed. Return to compassion.",
    "element": "Fire",
    "zodiac": "Leo",
    "planet": null,
    "numerology": 8,
    "yesNo": "yes"
  },
  "9": {
    "name": "The Hermit",
    "uprightKeywords": [
      "solitude",
      "introspection",
      "guidance",
      "inner light"
    ],
    "reversedKeywords": [
      "isolation",
      "withdrawal",
      "lost"
    ],
    "uprightMeaning": "A season of inward turning. The lantern you carry is meant to light your own next step.",
    "reversedMeaning": "Solitude has tipped into isolation, or you've lost the thread. Reach for company or for light.",
    "element": "Earth",
    "zodiac": "Virgo",
    "planet": null,
    "numerology": 9,
    "yesNo": "maybe"
  },
  "10": {
    "name": "Wheel of Fortune",
    "uprightKeywords": [
      "cycles",
      "fate",
      "turning points",
      "luck"
    ],
    "reversedKeywords": [
      "setbacks",
      "resistance",
      "bad luck"
    ],
    "uprightMeaning": "The wheel turns. Meet the change with openness — what's rising will rise, what's falling will fall.",
    "reversedMeaning": "Resistance to a turn that wants to happen. Notice what you're gripping.",
    "element": "Fire",
    "zodiac": null,
    "planet": "Jupiter",
    "numerology": 10,
    "yesNo": "maybe"
  },
  "11": {
    "name": "Justice",
    "uprightKeywords": [
      "fairness",
      "truth",
      "accountability",
      "cause and effect"
    ],
    "reversedKeywords": [
      "unfairness",
      "dishonesty",
      "avoidance"
    ],
    "uprightMeaning": "The scales weigh true. Speak honestly, take responsibility, and let outcomes follow.",
    "reversedMeaning": "A truth dodged or a verdict you don't want to hear. Integrity asks something of you here.",
    "element": "Air",
    "zodiac": "Libra",
    "planet": null,
    "numerology": 11,
    "yesNo": "maybe"
  },
  "12": {
    "name": "The Hanged Man",
    "uprightKeywords": [
      "surrender",
      "perspective",
      "pause",
      "suspension"
    ],
    "reversedKeywords": [
      "stalling",
      "sacrifice",
      "stuck"
    ],
    "uprightMeaning": "A pause that reveals what motion was hiding. New perspective comes when you stop forcing.",
    "reversedMeaning": "Stalled in a pose of waiting that is no longer serving. Either commit to the surrender or move.",
    "element": "Water",
    "zodiac": null,
    "planet": "Neptune",
    "numerology": 12,
    "yesNo": "no"
  },
  "13": {
    "name": "Death",
    "uprightKeywords": [
      "ending",
      "transformation",
      "release",
      "transition"
    ],
    "reversedKeywords": [
      "resistance to change",
      "stagnation"
    ],
    "uprightMeaning": "An ending that clears ground for what's next. Grieve cleanly; the door behind you is closing.",
    "reversedMeaning": "Clinging to what is already gone. The transition will be gentler if you stop bracing against it.",
    "element": "Water",
    "zodiac": "Scorpio",
    "planet": null,
    "numerology": 13,
    "yesNo": "maybe"
  },
  "14": {
    "name": "Temperance",
    "uprightKeywords": [
      "balance",
      "patience",
      "blending",
      "moderation"
    ],
    "reversedKeywords": [
      "imbalance",
      "excess",
      "haste"
    ],
    "uprightMeaning": "Slow alchemy. The right proportion of opposites makes something neither could become alone.",
    "reversedMeaning": "Out of balance — too much or too fast. Step back and recalibrate the mix.",
    "element": "Fire",
    "zodiac": "Sagittarius",
    "planet": null,
    "numerology": 14,
    "yesNo": "yes"
  },
  "15": {
    "name": "The Devil",
    "uprightKeywords": [
      "attachment",
      "shadow",
      "materialism",
      "bondage"
    ],
    "reversedKeywords": [
      "release",
      "awareness",
      "breaking free"
    ],
    "uprightMeaning": "A pattern that has you in its grip. Name what you're chained to; the chains are looser than they look.",
    "reversedMeaning": "The grip is loosening. Awareness of the pattern is the first step out of it.",
    "element": "Earth",
    "zodiac": "Capricorn",
    "planet": null,
    "numerology": 15,
    "yesNo": "no"
  },
  "16": {
    "name": "The Tower",
    "uprightKeywords": [
      "upheaval",
      "sudden change",
      "revelation",
      "collapse"
    ],
    "reversedKeywords": [
      "narrowly avoided disaster",
      "fear of change"
    ],
    "uprightMeaning": "A structure built on shaky foundations comes down. What survives the lightning was always real.",
    "reversedMeaning": "A reckoning postponed, or upheaval feared but not yet arrived. The warning is the gift.",
    "element": "Fire",
    "zodiac": null,
    "planet": "Mars",
    "numerology": 16,
    "yesNo": "no"
  },
  "17": {
    "name": "The Star",
    "uprightKeywords": [
      "hope",
      "renewal",
      "inspiration",
      "healing"
    ],
    "reversedKeywords": [
      "despair",
      "disconnection",
      "faithlessness"
    ],
    "uprightMeaning": "After the storm, clear water. Pour generously — the well is being refilled as you give.",
    "reversedMeaning": "Hope is harder to find right now. Let yourself rest before reaching for the next thing.",
    "element": "Air",
    "zodiac": "Aquarius",
    "planet": null,
    "numerology": 17,
    "yesNo": "yes"
  },
  "18": {
    "name": "The Moon",
    "uprightKeywords": [
      "intuition",
      "illusion",
      "dreams",
      "the unconscious"
    ],
    "reversedKeywords": [
      "confusion lifting",
      "misread signals"
    ],
    "uprightMeaning": "Walk by moonlight. Not everything will be clear, but what matters is being shown to your dream-self.",
    "reversedMeaning": "The fog is starting to lift. Old fears reveal themselves as just shadows.",
    "element": "Water",
    "zodiac": "Pisces",
    "planet": null,
    "numerology": 18,
    "yesNo": "maybe"
  },
  "19": {
    "name": "The Sun",
    "uprightKeywords": [
      "joy",
      "vitality",
      "success",
      "clarity"
    ],
    "reversedKeywords": [
      "temporary clouds",
      "ego",
      "dimmed joy"
    ],
    "uprightMeaning": "Pure light. Celebrate openly — what is good here is meant to be felt and shared.",
    "reversedMeaning": "Joy is muted right now, but the sun has not gone out. Step into the warmth on offer.",
    "element": "Fire",
    "zodiac": null,
    "planet": "Sun",
    "numerology": 19,
    "yesNo": "yes"
  },
  "20": {
    "name": "Judgement",
    "uprightKeywords": [
      "awakening",
      "reckoning",
      "calling",
      "rebirth"
    ],
    "reversedKeywords": [
      "self-doubt",
      "ignored calling",
      "harsh judgement"
    ],
    "uprightMeaning": "A clear call you cannot un-hear. Rise to meet it — the past has prepared you for exactly this.",
    "reversedMeaning": "The call is muffled by self-judgement. Be more merciful with yourself, then listen again.",
    "element": "Fire",
    "zodiac": null,
    "planet": "Pluto",
    "numerology": 20,
    "yesNo": "yes"
  },
  "21": {
    "name": "The World",
    "uprightKeywords": [
      "completion",
      "integration",
      "fulfilment",
      "wholeness"
    ],
    "reversedKeywords": [
      "unfinished business",
      "delay",
      "lack of closure"
    ],
    "uprightMeaning": "A cycle closes whole. Stand in the centre of what you've built and feel the full circle.",
    "reversedMeaning": "Almost-there. One last thread is asking to be tied before the next chapter can truly begin.",
    "element": "Earth",
    "zodiac": null,
    "planet": "Saturn",
    "numerology": 21,
    "yesNo": "yes"
  },
  "22": {
    "name": "Ace of Wands",
    "uprightKeywords": [
      "spark",
      "beginning",
      "inspiration",
      "potential"
    ],
    "reversedKeywords": [
      "delays",
      "false starts",
      "missed spark"
    ],
    "uprightMeaning": "A creative spark wants to ignite. Say yes to the impulse before doubt names it.",
    "reversedMeaning": "The impulse stalled or misfired. The fuel is there; check what's smothering the flame.",
    "element": "Fire",
    "zodiac": null,
    "planet": null,
    "numerology": 1,
    "yesNo": "yes"
  },
  "23": {
    "name": "Two of Wands",
    "uprightKeywords": [
      "planning",
      "choice",
      "vision",
      "future"
    ],
    "reversedKeywords": [
      "fear of the unknown",
      "restricted choices"
    ],
    "uprightMeaning": "You see two roads and the will to choose. Step beyond the familiar horizon.",
    "reversedMeaning": "Fear of the wider world is shrinking your options. Widen the view before deciding.",
    "element": "Fire",
    "zodiac": null,
    "planet": null,
    "numerology": 2,
    "yesNo": "yes"
  },
  "24": {
    "name": "Three of Wands",
    "uprightKeywords": [
      "expansion",
      "foresight",
      "ships coming in"
    ],
    "reversedKeywords": [
      "delays",
      "lack of foresight",
      "frustration"
    ],
    "uprightMeaning": "Plans set in motion are returning rewards. Keep watching the horizon.",
    "reversedMeaning": "Hoped-for returns are slow. Be patient and check what you're not yet seeing.",
    "element": "Fire",
    "zodiac": null,
    "planet": null,
    "numerology": 3,
    "yesNo": "yes"
  },
  "25": {
    "name": "Four of Wands",
    "uprightKeywords": [
      "celebration",
      "milestones",
      "home",
      "harmony"
    ],
    "reversedKeywords": [
      "instability",
      "transition",
      "lack of support"
    ],
    "uprightMeaning": "A homecoming or milestone worth marking. Joy with the people who hold you.",
    "reversedMeaning": "Celebration feels muted or the foundation feels shaky. Tend the relationships first.",
    "element": "Fire",
    "zodiac": null,
    "planet": null,
    "numerology": 4,
    "yesNo": "yes"
  },
  "26": {
    "name": "Five of Wands",
    "uprightKeywords": [
      "conflict",
      "competition",
      "friction",
      "contest"
    ],
    "reversedKeywords": [
      "resolution",
      "avoidance",
      "exhausted fighting"
    ],
    "uprightMeaning": "Clashing energies. Conflict can sharpen the work — or just exhaust everyone.",
    "reversedMeaning": "Conflict winding down or being avoided. Decide what's worth the fire.",
    "element": "Fire",
    "zodiac": null,
    "planet": null,
    "numerology": 5,
    "yesNo": "maybe"
  },
  "27": {
    "name": "Six of Wands",
    "uprightKeywords": [
      "victory",
      "recognition",
      "public success"
    ],
    "reversedKeywords": [
      "ego",
      "fall from grace",
      "private win"
    ],
    "uprightMeaning": "Recognition for work well done. Receive it cleanly.",
    "reversedMeaning": "Recognition delayed or hollow. The win may need to be private first.",
    "element": "Fire",
    "zodiac": null,
    "planet": null,
    "numerology": 6,
    "yesNo": "yes"
  },
  "28": {
    "name": "Seven of Wands",
    "uprightKeywords": [
      "defending your ground",
      "perseverance"
    ],
    "reversedKeywords": [
      "overwhelm",
      "giving up",
      "defensiveness"
    ],
    "uprightMeaning": "You hold the high ground. Stand your ground without becoming the fight.",
    "reversedMeaning": "The position has tipped from defence into rigidity. Pick your battles.",
    "element": "Fire",
    "zodiac": null,
    "planet": null,
    "numerology": 7,
    "yesNo": "maybe"
  },
  "29": {
    "name": "Eight of Wands",
    "uprightKeywords": [
      "swift movement",
      "momentum",
      "news"
    ],
    "reversedKeywords": [
      "delays",
      "frustration",
      "scattered energy"
    ],
    "uprightMeaning": "Things move fast. Catch the wave; the news is in flight.",
    "reversedMeaning": "Momentum sputters. Check what's catching the wind in the sails.",
    "element": "Fire",
    "zodiac": null,
    "planet": null,
    "numerology": 8,
    "yesNo": "yes"
  },
  "30": {
    "name": "Nine of Wands",
    "uprightKeywords": [
      "resilience",
      "last stand",
      "vigilance"
    ],
    "reversedKeywords": [
      "exhaustion",
      "paranoia",
      "stubbornness"
    ],
    "uprightMeaning": "Tired but standing. One more push will see this through.",
    "reversedMeaning": "Resilience has tipped into stubborn defensiveness. Rest is allowed.",
    "element": "Fire",
    "zodiac": null,
    "planet": null,
    "numerology": 9,
    "yesNo": "maybe"
  },
  "31": {
    "name": "Ten of Wands",
    "uprightKeywords": [
      "burden",
      "responsibility",
      "near completion"
    ],
    "reversedKeywords": [
      "release",
      "delegation",
      "overwhelm"
    ],
    "uprightMeaning": "Carrying a lot, near the end. Set it down soon — you've nearly arrived.",
    "reversedMeaning": "Time to delegate or put down what was never yours. Permission to release.",
    "element": "Fire",
    "zodiac": null,
    "planet": null,
    "numerology": 10,
    "yesNo": "maybe"
  },
  "32": {
    "name": "Page of Wands",
    "uprightKeywords": [
      "curiosity",
      "news",
      "fresh inspiration"
    ],
    "reversedKeywords": [
      "delayed news",
      "distraction",
      "immaturity"
    ],
    "uprightMeaning": "A spark of curiosity or word of something new. Follow the thread.",
    "reversedMeaning": "The fresh impulse keeps fizzling. Discipline the curiosity into action.",
    "element": "Fire",
    "zodiac": null,
    "planet": null,
    "numerology": null,
    "yesNo": "yes"
  },
  "33": {
    "name": "Knight of Wands",
    "uprightKeywords": [
      "bold action",
      "adventure",
      "charge ahead"
    ],
    "reversedKeywords": [
      "recklessness",
      "scattered haste",
      "burnout"
    ],
    "uprightMeaning": "Charge in. The fire is yours to ride.",
    "reversedMeaning": "Speed without direction. Slow enough to aim before you fire.",
    "element": "Fire",
    "zodiac": null,
    "planet": null,
    "numerology": null,
    "yesNo": "yes"
  },
  "34": {
    "name": "Queen of Wands",
    "uprightKeywords": [
      "passionate leadership",
      "magnetism",
      "warmth"
    ],
    "reversedKeywords": [
      "jealousy",
      "demanding",
      "overbearing"
    ],
    "uprightMeaning": "Generous fire. Lead with passion that warms the room.",
    "reversedMeaning": "Warmth turned into heat. Notice where passion has become possession.",
    "element": "Fire",
    "zodiac": null,
    "planet": null,
    "numerology": null,
    "yesNo": "yes"
  },
  "35": {
    "name": "King of Wands",
    "uprightKeywords": [
      "visionary leadership",
      "charisma",
      "mastery"
    ],
    "reversedKeywords": [
      "tyrant",
      "impulsive",
      "ruthless"
    ],
    "uprightMeaning": "A natural-born leader with vision and reach. Mastery worn lightly.",
    "reversedMeaning": "Power without compassion. The fire is consuming what it was meant to create.",
    "element": "Fire",
    "zodiac": null,
    "planet": null,
    "numerology": null,
    "yesNo": "yes"
  },
  "36": {
    "name": "Ace of Cups",
    "uprightKeywords": [
      "new feeling",
      "love",
      "opening",
      "intuition"
    ],
    "reversedKeywords": [
      "blocked feeling",
      "emotional flood"
    ],
    "uprightMeaning": "An emotional or spiritual gift overflows. Cup your hands and receive.",
    "reversedMeaning": "Feelings dammed up or spilling without form. Make space to feel cleanly.",
    "element": "Water",
    "zodiac": null,
    "planet": null,
    "numerology": 1,
    "yesNo": "yes"
  },
  "37": {
    "name": "Two of Cups",
    "uprightKeywords": [
      "partnership",
      "connection",
      "mutual respect"
    ],
    "reversedKeywords": [
      "disconnection",
      "imbalance",
      "breakup"
    ],
    "uprightMeaning": "A meeting of equals. The bond is real because it's mutual.",
    "reversedMeaning": "Mismatch in what each is offering. Talk before assuming.",
    "element": "Water",
    "zodiac": null,
    "planet": null,
    "numerology": 2,
    "yesNo": "yes"
  },
  "38": {
    "name": "Three of Cups",
    "uprightKeywords": [
      "friendship",
      "celebration",
      "community"
    ],
    "reversedKeywords": [
      "over-indulgence",
      "gossip",
      "isolation"
    ],
    "uprightMeaning": "Joy with your people. Raise a glass.",
    "reversedMeaning": "Community feels off — too much of one flavour. Curate the company.",
    "element": "Water",
    "zodiac": null,
    "planet": null,
    "numerology": 3,
    "yesNo": "yes"
  },
  "39": {
    "name": "Four of Cups",
    "uprightKeywords": [
      "apathy",
      "contemplation",
      "missed offer"
    ],
    "reversedKeywords": [
      "awareness",
      "acceptance",
      "new offer noticed"
    ],
    "uprightMeaning": "An offer is being made — but you're looking inward. Lift your eyes.",
    "reversedMeaning": "The offer is being seen now. Wake up and respond.",
    "element": "Water",
    "zodiac": null,
    "planet": null,
    "numerology": 4,
    "yesNo": "maybe"
  },
  "40": {
    "name": "Five of Cups",
    "uprightKeywords": [
      "grief",
      "loss",
      "regret",
      "focus on what's gone"
    ],
    "reversedKeywords": [
      "acceptance",
      "moving on",
      "finding what remains"
    ],
    "uprightMeaning": "Mourning what is gone. Two cups still stand — turn slowly when ready.",
    "reversedMeaning": "Grief loosening. The cups still standing come back into view.",
    "element": "Water",
    "zodiac": null,
    "planet": null,
    "numerology": 5,
    "yesNo": "no"
  },
  "41": {
    "name": "Six of Cups",
    "uprightKeywords": [
      "nostalgia",
      "memory",
      "gentle reunion"
    ],
    "reversedKeywords": [
      "stuck in the past",
      "leaving home"
    ],
    "uprightMeaning": "A sweet return to something or someone from before. Innocence revisited.",
    "reversedMeaning": "The past is pulling too hard. The future is the only place you can live.",
    "element": "Water",
    "zodiac": null,
    "planet": null,
    "numerology": 6,
    "yesNo": "maybe"
  },
  "42": {
    "name": "Seven of Cups",
    "uprightKeywords": [
      "choices",
      "fantasy",
      "illusion",
      "daydreams"
    ],
    "reversedKeywords": [
      "clarity",
      "decision",
      "reality check"
    ],
    "uprightMeaning": "Many tempting cups. Notice which are real and which are smoke.",
    "reversedMeaning": "Clarity returns. The right cup steps forward.",
    "element": "Water",
    "zodiac": null,
    "planet": null,
    "numerology": 7,
    "yesNo": "maybe"
  },
  "43": {
    "name": "Eight of Cups",
    "uprightKeywords": [
      "walking away",
      "dissatisfaction",
      "deeper search"
    ],
    "reversedKeywords": [
      "fear of change",
      "returning",
      "stagnation"
    ],
    "uprightMeaning": "Leaving what no longer feeds you, even if it looks fine from outside. The deeper thing is calling.",
    "reversedMeaning": "Hesitating at the threshold. Stay or go, but don't linger half-out.",
    "element": "Water",
    "zodiac": null,
    "planet": null,
    "numerology": 8,
    "yesNo": "maybe"
  },
  "44": {
    "name": "Nine of Cups",
    "uprightKeywords": [
      "wishes granted",
      "satisfaction",
      "contentment"
    ],
    "reversedKeywords": [
      "unmet wishes",
      "smugness",
      "materialism"
    ],
    "uprightMeaning": "A wish fulfilled. Sit in the satisfaction.",
    "reversedMeaning": "The wish hasn't landed, or the prize feels hollow. Reconsider what you actually wanted.",
    "element": "Water",
    "zodiac": null,
    "planet": null,
    "numerology": 9,
    "yesNo": "yes"
  },
  "45": {
    "name": "Ten of Cups",
    "uprightKeywords": [
      "family joy",
      "lasting happiness",
      "harmony"
    ],
    "reversedKeywords": [
      "disharmony",
      "broken vows",
      "neglected bonds"
    ],
    "uprightMeaning": "Lasting fulfilment with the people who matter. Home is here.",
    "reversedMeaning": "Domestic harmony strained. Tend the bonds with attention.",
    "element": "Water",
    "zodiac": null,
    "planet": null,
    "numerology": 10,
    "yesNo": "yes"
  },
  "46": {
    "name": "Page of Cups",
    "uprightKeywords": [
      "a sweet message",
      "creative play",
      "openness"
    ],
    "reversedKeywords": [
      "emotional immaturity",
      "blocked creativity"
    ],
    "uprightMeaning": "A tender message or playful invitation arrives. Stay open.",
    "reversedMeaning": "The message is muddled or the playfulness is missing. Be patient with the soft thing.",
    "element": "Water",
    "zodiac": null,
    "planet": null,
    "numerology": null,
    "yesNo": "yes"
  },
  "47": {
    "name": "Knight of Cups",
    "uprightKeywords": [
      "romance",
      "proposal",
      "dreamer",
      "charm"
    ],
    "reversedKeywords": [
      "moodiness",
      "jealousy",
      "unrealistic"
    ],
    "uprightMeaning": "A romantic gesture or quest. Follow the heart bravely.",
    "reversedMeaning": "Idealism hardening into mood. Land in reality.",
    "element": "Water",
    "zodiac": null,
    "planet": null,
    "numerology": null,
    "yesNo": "yes"
  },
  "48": {
    "name": "Queen of Cups",
    "uprightKeywords": [
      "compassionate love",
      "intuition",
      "deep care"
    ],
    "reversedKeywords": [
      "co-dependency",
      "martyrdom",
      "emotional flooding"
    ],
    "uprightMeaning": "Love poured generously without losing yourself. Mature feeling.",
    "reversedMeaning": "Care has tipped into self-abandonment. Cup yourself first.",
    "element": "Water",
    "zodiac": null,
    "planet": null,
    "numerology": null,
    "yesNo": "yes"
  },
  "49": {
    "name": "King of Cups",
    "uprightKeywords": [
      "emotional mastery",
      "calm wisdom",
      "deep love"
    ],
    "reversedKeywords": [
      "manipulation",
      "emotional repression",
      "coldness"
    ],
    "uprightMeaning": "Steady emotional ground. You hold the sea without being swept.",
    "reversedMeaning": "Feelings frozen or used as leverage. Let yourself feel, then speak.",
    "element": "Water",
    "zodiac": null,
    "planet": null,
    "numerology": null,
    "yesNo": "maybe"
  },
  "50": {
    "name": "Ace of Swords",
    "uprightKeywords": [
      "clarity",
      "breakthrough",
      "truth",
      "mental edge"
    ],
    "reversedKeywords": [
      "confusion",
      "miscommunication",
      "mental fog"
    ],
    "uprightMeaning": "A blade of clarity. The truth cuts cleanly when you let it.",
    "reversedMeaning": "Thinking is muddled. Sleep, then re-approach.",
    "element": "Air",
    "zodiac": null,
    "planet": null,
    "numerology": 1,
    "yesNo": "maybe"
  },
  "51": {
    "name": "Two of Swords",
    "uprightKeywords": [
      "stalemate",
      "indecision",
      "blindfold"
    ],
    "reversedKeywords": [
      "truth revealed",
      "decision forced"
    ],
    "uprightMeaning": "Held in indecision; the blindfold is self-imposed. Lift it when ready.",
    "reversedMeaning": "The blindfold falls. The choice can finally be made.",
    "element": "Air",
    "zodiac": null,
    "planet": null,
    "numerology": 2,
    "yesNo": "no"
  },
  "52": {
    "name": "Three of Swords",
    "uprightKeywords": [
      "heartbreak",
      "sorrow",
      "painful truth"
    ],
    "reversedKeywords": [
      "release",
      "healing",
      "forgiveness"
    ],
    "uprightMeaning": "A sharp sorrow. Let the rain do its work.",
    "reversedMeaning": "The grief is moving. Healing follows the honesty.",
    "element": "Air",
    "zodiac": null,
    "planet": null,
    "numerology": 3,
    "yesNo": "no"
  },
  "53": {
    "name": "Four of Swords",
    "uprightKeywords": [
      "rest",
      "retreat",
      "recovery",
      "contemplation"
    ],
    "reversedKeywords": [
      "restlessness",
      "burnout",
      "re-emergence"
    ],
    "uprightMeaning": "Lie down. Rest is the work right now.",
    "reversedMeaning": "Re-emerging from rest. Move gently back into the world.",
    "element": "Air",
    "zodiac": null,
    "planet": null,
    "numerology": 4,
    "yesNo": "maybe"
  },
  "54": {
    "name": "Five of Swords",
    "uprightKeywords": [
      "conflict",
      "defeat",
      "hollow victory"
    ],
    "reversedKeywords": [
      "reconciliation",
      "regret",
      "walking away"
    ],
    "uprightMeaning": "A win that costs more than it's worth. Choose differently.",
    "reversedMeaning": "Mending after conflict, or admitting the fight wasn't yours.",
    "element": "Air",
    "zodiac": null,
    "planet": null,
    "numerology": 5,
    "yesNo": "no"
  },
  "55": {
    "name": "Six of Swords",
    "uprightKeywords": [
      "transition",
      "moving on",
      "journey to better"
    ],
    "reversedKeywords": [
      "stuck",
      "unresolved past",
      "heavy passage"
    ],
    "uprightMeaning": "Moving toward calmer waters. Pack only what you need.",
    "reversedMeaning": "The crossing is heavy because old weight wasn't put down.",
    "element": "Air",
    "zodiac": null,
    "planet": null,
    "numerology": 6,
    "yesNo": "maybe"
  },
  "56": {
    "name": "Seven of Swords",
    "uprightKeywords": [
      "strategy",
      "stealth",
      "half-truths"
    ],
    "reversedKeywords": [
      "confession",
      "return",
      "accountability"
    ],
    "uprightMeaning": "Going your own way, perhaps not telling everyone. Move carefully.",
    "reversedMeaning": "The hidden thing surfaces. Honesty becomes possible.",
    "element": "Air",
    "zodiac": null,
    "planet": null,
    "numerology": 7,
    "yesNo": "maybe"
  },
  "57": {
    "name": "Eight of Swords",
    "uprightKeywords": [
      "self-imposed restriction",
      "victim mindset"
    ],
    "reversedKeywords": [
      "release",
      "self-acceptance",
      "new perspective"
    ],
    "uprightMeaning": "Bound by stories you've told yourself. The blades aren't holding you in.",
    "reversedMeaning": "Stepping out of the bindings. New options become visible.",
    "element": "Air",
    "zodiac": null,
    "planet": null,
    "numerology": 8,
    "yesNo": "no"
  },
  "58": {
    "name": "Nine of Swords",
    "uprightKeywords": [
      "anxiety",
      "worry",
      "sleepless mind"
    ],
    "reversedKeywords": [
      "hope returning",
      "recovery",
      "perspective"
    ],
    "uprightMeaning": "The 3am mind. Most of what you fear lives only in the dark.",
    "reversedMeaning": "Worry loosening. Daylight returns to thinking.",
    "element": "Air",
    "zodiac": null,
    "planet": null,
    "numerology": 9,
    "yesNo": "no"
  },
  "59": {
    "name": "Ten of Swords",
    "uprightKeywords": [
      "rock bottom",
      "ending",
      "painful conclusion"
    ],
    "reversedKeywords": [
      "recovery",
      "dawn after dark",
      "refusal to end"
    ],
    "uprightMeaning": "An ending that feels final. The sun will rise again behind you.",
    "reversedMeaning": "The bottom held. From here only up.",
    "element": "Air",
    "zodiac": null,
    "planet": null,
    "numerology": 10,
    "yesNo": "no"
  },
  "60": {
    "name": "Page of Swords",
    "uprightKeywords": [
      "curious mind",
      "news",
      "sharp questions"
    ],
    "reversedKeywords": [
      "gossip",
      "hasty conclusions",
      "scattered"
    ],
    "uprightMeaning": "A sharp question or piece of news. Investigate fairly.",
    "reversedMeaning": "Mind racing without landing. Slow the questions down.",
    "element": "Air",
    "zodiac": null,
    "planet": null,
    "numerology": null,
    "yesNo": "maybe"
  },
  "61": {
    "name": "Knight of Swords",
    "uprightKeywords": [
      "decisive action",
      "ambition",
      "charge"
    ],
    "reversedKeywords": [
      "aggression",
      "recklessness",
      "impulsiveness"
    ],
    "uprightMeaning": "Cut through. Ambitious, focused movement.",
    "reversedMeaning": "Ambition tipping into harm. Sheath the blade.",
    "element": "Air",
    "zodiac": null,
    "planet": null,
    "numerology": null,
    "yesNo": "yes"
  },
  "62": {
    "name": "Queen of Swords",
    "uprightKeywords": [
      "clear-eyed truth",
      "independence",
      "intellect"
    ],
    "reversedKeywords": [
      "cold judgement",
      "harshness",
      "isolation"
    ],
    "uprightMeaning": "Discerning, independent, fair. Truth-telling at its best.",
    "reversedMeaning": "Truth becoming weapon. Add warmth.",
    "element": "Air",
    "zodiac": null,
    "planet": null,
    "numerology": null,
    "yesNo": "maybe"
  },
  "63": {
    "name": "King of Swords",
    "uprightKeywords": [
      "authority through truth",
      "fairness",
      "intellect"
    ],
    "reversedKeywords": [
      "tyranny",
      "manipulation",
      "abuse of power"
    ],
    "uprightMeaning": "Wisdom held with authority. Decisions are clean.",
    "reversedMeaning": "Power without warmth. The blade is misused.",
    "element": "Air",
    "zodiac": null,
    "planet": null,
    "numerology": null,
    "yesNo": "maybe"
  },
  "64": {
    "name": "Ace of Pentacles",
    "uprightKeywords": [
      "new opportunity",
      "prosperity",
      "manifestation",
      "seed"
    ],
    "reversedKeywords": [
      "missed chance",
      "scarcity mindset"
    ],
    "uprightMeaning": "A solid opportunity is offered. Plant the seed in good soil.",
    "reversedMeaning": "The opportunity is being missed or distrusted. Look again.",
    "element": "Earth",
    "zodiac": null,
    "planet": null,
    "numerology": 1,
    "yesNo": "yes"
  },
  "65": {
    "name": "Two of Pentacles",
    "uprightKeywords": [
      "balance",
      "juggling",
      "adaptability"
    ],
    "reversedKeywords": [
      "imbalance",
      "overwhelm",
      "dropping balls"
    ],
    "uprightMeaning": "Holding many things in motion. Flow with the ups and downs.",
    "reversedMeaning": "Too much in the air. Set something down.",
    "element": "Earth",
    "zodiac": null,
    "planet": null,
    "numerology": 2,
    "yesNo": "maybe"
  },
  "66": {
    "name": "Three of Pentacles",
    "uprightKeywords": [
      "collaboration",
      "craft",
      "learning by doing"
    ],
    "reversedKeywords": [
      "poor teamwork",
      "mediocrity",
      "isolated work"
    ],
    "uprightMeaning": "Skills coming together. Apprentice and master both grow.",
    "reversedMeaning": "The collaboration is off. Realign roles.",
    "element": "Earth",
    "zodiac": null,
    "planet": null,
    "numerology": 3,
    "yesNo": "yes"
  },
  "67": {
    "name": "Four of Pentacles",
    "uprightKeywords": [
      "holding tight",
      "security",
      "control over resources"
    ],
    "reversedKeywords": [
      "release",
      "generosity",
      "opening hands"
    ],
    "uprightMeaning": "Holding what you have firmly. Make sure security isn't becoming clutch.",
    "reversedMeaning": "The grip loosens. Generosity returns flow.",
    "element": "Earth",
    "zodiac": null,
    "planet": null,
    "numerology": 4,
    "yesNo": "maybe"
  },
  "68": {
    "name": "Five of Pentacles",
    "uprightKeywords": [
      "hardship",
      "exclusion",
      "scarcity",
      "isolation"
    ],
    "reversedKeywords": [
      "recovery",
      "support",
      "returning home"
    ],
    "uprightMeaning": "A cold patch — outside looking in. Help is closer than it appears.",
    "reversedMeaning": "Coming in from the cold. Accept the warmth.",
    "element": "Earth",
    "zodiac": null,
    "planet": null,
    "numerology": 5,
    "yesNo": "no"
  },
  "69": {
    "name": "Six of Pentacles",
    "uprightKeywords": [
      "generosity",
      "fair exchange",
      "support"
    ],
    "reversedKeywords": [
      "unequal exchange",
      "debts",
      "strings attached"
    ],
    "uprightMeaning": "Fair flow of resources. Give and receive with clear hands.",
    "reversedMeaning": "Imbalance in giving. Notice the strings.",
    "element": "Earth",
    "zodiac": null,
    "planet": null,
    "numerology": 6,
    "yesNo": "yes"
  },
  "70": {
    "name": "Seven of Pentacles",
    "uprightKeywords": [
      "assessment",
      "patience",
      "slow growth"
    ],
    "reversedKeywords": [
      "impatience",
      "lack of long-term view"
    ],
    "uprightMeaning": "Pause to evaluate. The harvest comes if you keep tending.",
    "reversedMeaning": "Impatience with slow returns. Stay the course.",
    "element": "Earth",
    "zodiac": null,
    "planet": null,
    "numerology": 7,
    "yesNo": "maybe"
  },
  "71": {
    "name": "Eight of Pentacles",
    "uprightKeywords": [
      "mastery through practice",
      "dedication",
      "craft"
    ],
    "reversedKeywords": [
      "perfectionism",
      "burnout",
      "lack of focus"
    ],
    "uprightMeaning": "Diligent practice. Mastery is built one stroke at a time.",
    "reversedMeaning": "Perfectionism stalling progress. Done is better than perfect.",
    "element": "Earth",
    "zodiac": null,
    "planet": null,
    "numerology": 8,
    "yesNo": "yes"
  },
  "72": {
    "name": "Nine of Pentacles",
    "uprightKeywords": [
      "self-sufficiency",
      "refinement",
      "sensual abundance"
    ],
    "reversedKeywords": [
      "reliance on others",
      "superficial pleasure"
    ],
    "uprightMeaning": "Independent abundance. Enjoy the luxury you've earned.",
    "reversedMeaning": "Abundance feels hollow or owed. Reconnect with what truly nourishes.",
    "element": "Earth",
    "zodiac": null,
    "planet": null,
    "numerology": 9,
    "yesNo": "yes"
  },
  "73": {
    "name": "Ten of Pentacles",
    "uprightKeywords": [
      "legacy",
      "family wealth",
      "generational stability"
    ],
    "reversedKeywords": [
      "family discord",
      "inheritance issues",
      "instability"
    ],
    "uprightMeaning": "Lasting wealth in every sense — family, home, legacy.",
    "reversedMeaning": "Trouble in the foundations. Tend what is meant to last.",
    "element": "Earth",
    "zodiac": null,
    "planet": null,
    "numerology": 10,
    "yesNo": "yes"
  },
  "74": {
    "name": "Page of Pentacles",
    "uprightKeywords": [
      "new study",
      "opportunity",
      "steady learner"
    ],
    "reversedKeywords": [
      "procrastination",
      "lack of progress",
      "impractical plans"
    ],
    "uprightMeaning": "A patient new beginning in skill or finances. Show up daily.",
    "reversedMeaning": "The plan keeps not starting. Pick a tiny first step.",
    "element": "Earth",
    "zodiac": null,
    "planet": null,
    "numerology": null,
    "yesNo": "yes"
  },
  "75": {
    "name": "Knight of Pentacles",
    "uprightKeywords": [
      "reliable effort",
      "persistence",
      "slow and steady"
    ],
    "reversedKeywords": [
      "stagnation",
      "boredom",
      "lack of progress"
    ],
    "uprightMeaning": "Methodical work. Reliable as the seasons.",
    "reversedMeaning": "Steady has tipped into stuck. Vary the routine.",
    "element": "Earth",
    "zodiac": null,
    "planet": null,
    "numerology": null,
    "yesNo": "maybe"
  },
  "76": {
    "name": "Queen of Pentacles",
    "uprightKeywords": [
      "nurturer",
      "abundance",
      "sensual",
      "grounded"
    ],
    "reversedKeywords": [
      "self-care neglect",
      "smothering",
      "materialism"
    ],
    "uprightMeaning": "Generous, grounded care. Tend self and others alike.",
    "reversedMeaning": "Care imbalanced. Pour into yourself before the cup empties.",
    "element": "Earth",
    "zodiac": null,
    "planet": null,
    "numerology": null,
    "yesNo": "yes"
  },
  "77": {
    "name": "King of Pentacles",
    "uprightKeywords": [
      "successful",
      "generous",
      "prosperous",
      "stable"
    ],
    "reversedKeywords": [
      "greed",
      "excess",
      "poor management"
    ],
    "uprightMeaning": "The realm thrives. Prosperity built and shared well.",
    "reversedMeaning": "Wealth without wisdom. Reconsider what success is for.",
    "element": "Earth",
    "zodiac": null,
    "planet": null,
    "numerology": null,
    "yesNo": "yes"
  }
};

export function getCardMeaning(id: number): CardMeaning | null {
  return TAROT_MEANINGS[id] ?? null;
}
