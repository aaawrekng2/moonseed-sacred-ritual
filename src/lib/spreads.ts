/**
 * EJ12 — Tarot spread definitions.
 *
 * Used by the Manual Entry slot row to label each slot with its
 * positional meaning ("Past", "Present", "Future", etc.) when a
 * spread type is selected from the slot-row dropdown. Each spread
 * has a short key, a display label, an array of slot names (in
 * placement order), and a one-line descriptor explaining what the
 * spread is for.
 *
 * Slot names are passed through to the labels row beneath the slot
 * cards. The label row truncates long names visually with CSS; the
 * hover tip surfaces the full name and the spread descriptor. Slots
 * beyond the spread's defined count remain unlabeled (free slots).
 *
 * "None" is the default — no labels render.
 *
 * Verified against widely-cited tarot sources (Waite Pictorial Key,
 * Labyrinthos, Elvi Tarot, Curious Cauldron, The Tarot Guide).
 */

export type SpreadKey =
  | "none"
  | "single"
  | "three_card"
  | "celtic_cross"
  | "yes_no"
  | "horseshoe"
  | "relationship"
  | "year_ahead"
  | "cross_of_decision";

export type SpreadDefinition = {
  /** Stable internal key. */
  key: SpreadKey;
  /** Display label shown in the dropdown trigger and menu. */
  label: string;
  /** One-line descriptor surfaced in label hover tips. */
  descriptor: string;
  /** Slot names in placement order. Empty array = no labels. */
  slotNames: string[];
  /**
   * EJ14 — short slot names for the labels row. Used when the long
   * name (slotNames[i]) is too long to fit a slot card width without
   * crowding. Same length / order as `slotNames`. Empty array allowed
   * for the "none" key.
   */
  slotNamesShort: string[];
  /**
   * EJ15 — per-slot interpretive meaning. One paragraph (~60-100 words)
   * per slot describing what that specific slot represents in this
   * specific spread. Surfaced in the slot-label hover popover so the
   * seeker can study the spread's anatomy at any time. Same length /
   * order as `slotNames`. Empty array allowed for the "none" key.
   */
  slotMeanings: string[];
};

export const SPREADS: ReadonlyArray<SpreadDefinition> = [
  {
    key: "none",
    label: "None",
    descriptor: "No spread selected — slots remain unlabeled.",
    slotNames: [],
    slotNamesShort: [],
    slotMeanings: [],
  },
  {
    key: "single",
    label: "Single",
    descriptor: "Your card for today; a single focus or daily draw.",
    slotNames: ["The Card"],
    slotNamesShort: ["Card"],
    slotMeanings: [
      "A single card carries the full weight of the reading. Without other positions to lean on, the meaning comes entirely from your relationship to the card itself — its imagery, its number, its suit, the way it lands in your day. This is the most intimate spread in tarot: nothing to compare against, nothing to soften the message. Sit with it. Notice what it asks of you. A single card draw rewards attention and rereads more than any other spread.",
    ],
  },
  {
    key: "three_card",
    label: "Three Card",
    descriptor: "Past, present, future — or a story arc in three beats.",
    slotNames: ["Past", "Present", "Future"],
    slotNamesShort: ["Past", "Now", "Next"],
    slotMeanings: [
      "What is moving out of your situation — the energies, decisions, or circumstances that brought you to this moment but are now receding. The Past slot is not about distant history; it is about the immediate currents that shaped the question you are asking right now. Look here for what you are letting go of, what is completing, or what has set the stage for what comes next.",
      "Where you actually stand. This is the card that names the real situation, not the version you wish it were or the version you fear. The Present slot is the most honest position in the spread — it shows the truth of the moment so the rest of the reading has something to push against. If this card surprises you, that surprise is the reading.",
      "Where the current energy is heading if nothing changes. Not a prediction set in stone — tarot does not work that way — but the natural arc of what's in motion. The Future slot is an invitation: if you like where this is pointing, lean in; if you don't, the reading just told you where to intervene. The future is the most editable part of any three-card draw.",
    ],
  },
  {
    key: "celtic_cross",
    label: "Celtic Cross",
    descriptor: "The classic ten-card spread; the deepest read on a single question.",
    slotNames: [
      "The Present",
      "The Cross (Obstacle)",
      "Foundation",
      "Past",
      "Crown (Conscious Goal)",
      "Near Future",
      "Self",
      "Environment",
      "Hopes & Fears",
      "Outcome",
    ],
    slotNamesShort: ["Now", "Cross", "Root", "Past", "Goal", "Soon", "Self", "Env", "Hope", "Out"],
    slotMeanings: [
      "The heart of the reading. This card names the situation as it truly is — not as you frame it in the question, but as the spread sees it. Everything that follows is read in relationship to this card. In the Celtic Cross specifically, The Present is laid first and remains the anchor of the entire ten-card pattern. If you only had time to read one card, this would be it.",
      "What complicates or resists the present situation. Laid sideways across the first card, this is the force that crosses the heart of the reading — sometimes a literal obstacle, sometimes an unexpected source of tension, occasionally a blessing in disguise. Even when this card appears positive, treat it as something to navigate. Naming the obstacle clearly is often more useful than the rest of the reading combined.",
      "What underlies the situation — the deep current beneath everything else. This card speaks to the roots: what's really driving the question, often unconsciously. The Foundation is the slot that reveals motivations the seeker hasn't yet named, old patterns still shaping new circumstances, or the bedrock truth that the upper cards are dancing around. Sit with this one before reading on.",
      "Recent energies moving out of the situation. Not deep history — the past few weeks or months, the chain of events that led directly to the question being asked now. This card explains how you got here and what is finishing or releasing. The Past is also a tell: if it surprises you, the reading is about to teach you something about your own narrative.",
      "What you consciously seek or know — the best-case version of the situation as you understand it. Placed above the central cross, the Crown is your stated goal, your aspiration, or the answer you're hoping the reading confirms. Compare it to the Outcome card later: where they agree, you are aligned with reality; where they disagree, your goal may need refining.",
      "What is approaching in the immediate future — usually within weeks. This card describes the next event, energy, or development that will shape the situation. The Near Future is not the final answer of the reading (the Outcome holds that role) but the next step on the path. Read it as: this is what will happen next, regardless of how the rest unfolds.",
      "Your stance, attitude, or role in the situation. Not who you are as a person, but how you are showing up to this specific question — empowered or guarded, open or defended, clear or confused. The Self card is often the most uncomfortable in the spread because it shows the seeker themselves. Read it honestly. If it stings, the reading is doing its work.",
      "The people, energies, and circumstances surrounding you that you do not directly control. This card describes the climate of the situation — what others bring, what the world is doing, what forces are at play beyond your stance. Environment is the context in which Self operates. Together they describe the dance between you and everything else around the question.",
      "Hopes and fears live in the same card because, in tarot, they are the same energy with different framings. This slot reveals what you most want to happen AND what you most dread — often two faces of the same underlying truth. Read this card twice: once for what you want, once for what you fear. The honest answer is usually somewhere between them.",
      "Where the energy is tending, given everything above. The Outcome is the spread's final word — not a fixed prophecy, but the trajectory of the current situation if nothing fundamental shifts. Compare it to the Crown: if the two agree, your goal is reachable; if they diverge, something in the reading is asking you to change course. The Outcome is the most actionable card in the spread.",
    ],
  },
  {
    key: "yes_no",
    label: "Yes/No",
    descriptor: "A single card; upright is yes, reversed is no.",
    slotNames: ["Answer"],
    slotNamesShort: ["Y/N"],
    slotMeanings: [
      "The clearest spread tarot offers. Upright = yes, reversed = no — but the card itself adds the why. A yes from The Tower means yes, and brace for the upheaval that comes with it; a no from the Three of Cups means no, and there's joy in the path you don't take. The Yes/No spread works best when the question is genuinely binary. Ambiguous questions produce ambiguous cards. Ask cleanly and the answer arrives cleanly.",
    ],
  },
  {
    key: "horseshoe",
    label: "Horseshoe (7)",
    descriptor: "A broader life-situation reading in seven beats.",
    slotNames: [
      "Past",
      "Present",
      "Hidden Influences",
      "Obstacles",
      "External Influences",
      "Advice",
      "Outcome",
    ],
    slotNamesShort: ["Past", "Now", "Hid", "Obs", "Ext", "Adv", "Out"],
    slotMeanings: [
      "What brought you to this moment. The Horseshoe Past is broader than the Celtic Cross Past — it can reach back further, taking in the longer arc of how you arrived at the present question. Look here for patterns that have been repeating, decisions that compounded, or seasons of life now ending. The first card of the horseshoe sets the curve everything else bends toward.",
      "Where you stand right now. In the Horseshoe, the Present is the second card and serves as the read's center of gravity — everything to its left (Past) is moving away, everything to its right is moving toward the Outcome. Read this card carefully; it determines whether the rest of the spread feels like a continuation or a turning point.",
      "What you cannot see yet — currents, motives, or facts moving beneath the surface of the situation. Hidden Influences are not necessarily malicious; they're simply unknown to you at the moment of asking. This slot often reveals what someone else knows that you don't, what your own subconscious is doing behind your back, or what circumstance is quietly shaping the outcome.",
      "What stands in the way. The Obstacles slot names the specific resistance you'll meet between now and the outcome. Unlike the Celtic Cross's Cross slot (which crosses the present), the Horseshoe Obstacles point forward — they describe what's ahead, not what's happening now. Read this card as a forecast: this is the friction you should prepare to navigate, not the friction you're already in.",
      "What the people, systems, or environments around you are bringing to the situation. External Influences sit between Obstacles (what blocks) and Advice (what helps) because they can be either — depending on how you engage with them. This slot names the dominant outside force that will shape the outcome. Ally or adversary, this is what's coming at you from beyond your own choices.",
      "What the cards counsel you to do. This is the most directly actionable slot in the Horseshoe. Read this card as a recommendation, not a prediction — it suggests a stance, an action, or a quality you should bring to the situation to shape the Outcome in your favor. If the Advice card surprises you, that surprise is the gift of the reading.",
      "Where the energy resolves. The Outcome of a Horseshoe is the result of how the previous six cards interact — Past flowing into Present, Hidden surfacing, Obstacles met, External engaged, Advice heeded or ignored. This card is not a fixed future but the projection of the current trajectory. Treat it as a question: do you want to arrive here? If yes, keep going; if no, the Advice slot tells you where to pivot.",
    ],
  },
  {
    key: "relationship",
    label: "Relationship (5)",
    descriptor: "You, them, the bond, the challenge, the outcome.",
    slotNames: ["You", "Your Partner", "The Connection", "The Challenge", "The Outcome"],
    slotNamesShort: ["You", "Them", "Bond", "Chal", "End"],
    slotMeanings: [
      "How you are showing up in this relationship right now — your stance, your needs, your unspoken hopes, the version of yourself this person draws out. Not who you are in the rest of your life, but who you become in proximity to them. Read this card without flattery and without self-criticism: it's a mirror, and mirrors are most useful when read clearly. The relationship reading starts with you because it ends with you.",
      "Who they are in this relationship — their stance, their pattern, what they bring and what they hold back. This is the card to study most carefully, because we usually project onto our partners far more than we see them. The Partner slot offers a corrective: this is who the cards say they are, separate from your story about them. If it doesn't match your assumptions, the assumption is what's worth examining.",
      "The energy between you — the thing that exists in the space between two people that belongs to neither of them alone. The Connection slot names the bond itself: its quality, its purpose, its season. Some connections are built for lifetimes; others are built for lessons. This card tells you which you're inside. It is the most honest slot of the five because it speaks of the relationship itself, not either person's view of it.",
      "What you must navigate together. The Challenge is not the same as the obstacle in a Celtic Cross — it is specifically a shared challenge, something both people must face if the connection is to grow. Sometimes it's an external pressure; more often it's a pattern between you. Read this card as something to discuss with your partner, not something to solve in your head. The Challenge is the work of the relationship.",
      "Where the connection is heading if both people keep showing up as they are. Not a prediction — relationships are made and remade by daily choices — but the natural trajectory of the current pattern. Compare the Outcome to the Connection slot: if they match, the relationship is true to itself; if they diverge, something between you is asking to change. The Outcome is the most editable card in any relationship reading.",
    ],
  },
  {
    key: "year_ahead",
    label: "Year Ahead (12)",
    descriptor: "One card per month for the year.",
    slotNames: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    slotNamesShort: [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ],
    slotMeanings: [
      "January sets the year's opening note. Whatever card lands here colors how you cross the threshold — what you carry in, what you set down, what your nervous system already knows about the shape of the year. The first card of a Year Ahead is also the most reread: at the end of the year, look back and see how January's card foreshadowed everything that followed. The opening card almost always tells you the truth.",
      "February deepens January's theme — or interrupts it. Often the shortest month brings the year's first real test: what looked steady in January is questioned here. Read this card as the response to the opening, the second beat of the year's music. If February's card amplifies January's, expect a long arc; if it disrupts, the year will be more cyclical than linear.",
      "March is the year's first turning. The thaw card. What dormant thing is now stirring? What ground is now soft enough to plant in? This month often delivers the first real movement of the year — the first decision that actually changes something. Whatever card lands here is the year's first true action. Track what shifts in March and you'll have a thread to follow into spring.",
      "April is acceleration. The year's energy doubles down — what March began, April commits to. This month often brings effort, expansion, or external pressure that asks more of you than the previous three. Read this card as the year's first real demand. If April lands hard, the rest of the year will reward stamina; if it lands gently, you've earned a runway and should use it.",
      "May is bloom and stretch. The year's first peak — relationships, projects, or self all reach toward something. The May card describes what you're growing into. Mid-spring is also when the year's first signs of friction show up: too much sun, not enough rain, more than you can carry. Read this card honestly. May rewards seeing clearly what you're actually capable of holding.",
      "June is fullness. The longest days, the most light, the year at its widest. Whatever card lands here describes the year's high noon — the moment of greatest visibility. This is often when the year's purpose becomes legible: you can finally see what the first six months were building toward. Mark June. The card here is the year's most honest snapshot of where you actually stand.",
      "July is the turn. After June's peak, the year begins its long descent. The July card describes the first acknowledgment of that turn — sometimes a celebration of what's been gathered, sometimes a quiet reckoning with what hasn't. This month asks: what will you carry into the second half? What have you outgrown? July is the year's most reflective month, even when it doesn't feel that way.",
      "August is harvest's first taste. What you planted in spring begins to show — for better or for the cards. The August card reveals the year's first real return on effort. If the card is generous, savor it; if it's stark, the year is teaching you about the gap between intention and execution. August does not judge you. It simply shows you what's actually growing.",
      "September is recommitment. The year asks: knowing what you now know, will you stay the course? The September card is the answer the cards give to that question. This month often brings clarity — a decision crystallizes, a path opens or closes, a chapter ends. September is the year's most decisive month because it's the last chance to redirect before the year's final quarter.",
      "October is depth. The veil thins. The year's quieter truths surface — what was hidden in summer's glare becomes visible in autumn's slant light. The October card often names something the previous nine months have been circling without naming. Read it carefully. This month rewards stillness more than action; you are gathering, not pushing.",
      "November is release. What you do not carry into December is released here. The November card describes that letting go — the relationships, projects, identities, or hopes that complete their season this year. Sometimes the release is grief; sometimes it's relief. Either way, the card is honest about what the year is ending. Trust it. November tells you what the year was for.",
      "December closes the circle. The final card of a Year Ahead is the year's last word — what it taught, what it built, what it asks you to remember as the next year begins. Compare December to January: see the journey. The closing card is also the seed of the next year; whatever lands here becomes the soil January will plant in. The year does not end. It composts.",
    ],
  },
  {
    key: "cross_of_decision",
    label: "Cross of Decision (5)",
    descriptor: "A five-card spread for choosing between two paths.",
    slotNames: ["The Situation", "Path A", "Path B", "Hidden Influence", "Likely Outcome"],
    slotNamesShort: ["Now", "A", "B", "Hid", "End"],
    slotMeanings: [
      "The fork in the road as it actually is. Before reading either path, the Situation card tells you what you're really deciding — which is often not what you think you're deciding. The framing of a choice shapes the choice itself. Read this card first and let it adjust the question you brought. If the Situation card surprises you, the rest of the spread will too.",
      "What happens if you take the first path. Path A is not better or worse than Path B — it is simply itself. Read this card as the energy, lesson, or shape of the life that unfolds down this branch. Notice what the card asks of you, what it gives you, and what it costs. Pair it with Path B before deciding; the comparison reveals what each path is for.",
      "What happens if you take the second path. Path B mirrors Path A — same instructions, different branch. The two paths often look superficially similar but ask very different things of you, or grant very different rewards. The decision is rarely about which path is better in isolation; it's about which path matches who you're trying to become. Hold both cards together and listen for which one you flinch from or lean toward.",
      "What's shaping the decision that you haven't named yet. Hidden Influence is the most important card in this spread because it usually changes the read. It might be an unconscious fear, an external pressure, an old story still running, or simply a fact you haven't acknowledged. Once this card is named, the choice between Path A and Path B often becomes clearer — sometimes it becomes obvious. Read it last and let it recolor the whole spread.",
      "Where the energy is tending, given the Situation, the two paths, and the Hidden Influence. The Likely Outcome card describes what unfolds if the decision goes the way the spread is pointing — usually toward whichever path resolves the Hidden Influence rather than the path that looked best in isolation. Treat this card as guidance, not prophecy. You still get to choose. The cards are simply telling you which choice they see.",
    ],
  },
];

/** Look up a spread by key. Defaults to "none" when not found. */
export function getSpread(key: SpreadKey): SpreadDefinition {
  return SPREADS.find((s) => s.key === key) ?? SPREADS[0];
}

/** localStorage key for the seeker's chosen spread on /constellation. */
export const SPREAD_STORAGE_KEY = "tarotseed:constellation-spread";
// EJ70 — Extended to mirror the Manual Entry SPREADS list so the
// Tabletop spread picker can offer the same options. The four new
// spreads (horseshoe, relationship, year_ahead, cross_of_decision)
// were previously available only on the Manual Entry constellation.
export type SpreadMode =
  | "daily"
  | "single"
  | "three"
  | "celtic"
  | "yes_no"
  | "horseshoe"
  | "relationship"
  | "year_ahead"
  | "cross_of_decision"
  | "custom";

export const SPREAD_META: Record<
  SpreadMode,
  {
    label: string;
    count: number;
    description: string;
    positions?: string[];
    /** Compact labels used when slot rail is space-constrained. */
    positionsShort?: string[];
    /**
     * One-line description of each position. Used by the draw-screen whisper
     * to give the user a sentence of guidance about what they're drawing for.
     * Indices line up 1:1 with `positions`.
     */
    positionDescriptions?: string[];
  }
> = {
  daily: { label: "Daily Draw", count: 1, description: "One card for today" },
  single: { label: "Single Reading", count: 1, description: "A single card" },
  three: {
    label: "Past · Present · Future",
    count: 3,
    description: "Three cards across time",
    positions: ["Past", "Present", "Future"],
    positionsShort: ["Past", "Pres", "Fut"],
    positionDescriptions: [
      "Energies and influences moving out",
      "Where you stand right now",
      "Where the energy is heading",
    ],
  },
  celtic: {
    label: "Celtic Cross",
    count: 10,
    description: "Ten positions, classic spread",
    positions: [
      "The Present",
      "The Challenge",
      "The Foundation",
      "The Past",
      "The Goal",
      "Near Future",
      "You / Self",
      "Environment",
      "Hopes & Fears",
      "The Outcome",
    ],
    positionsShort: ["Pres", "Obs", "Root", "Past", "Pot", "Fut", "Self", "Ext", "Hope", "Out"],
    positionDescriptions: [
      "What the reading centers on now",
      "What crosses or complicates the situation",
      "Underlying influences, what lies beneath",
      "Recent energies moving out",
      "What is consciously known or sought",
      "What is approaching soon",
      "Your stance, attitude, or role",
      "Outside influences and surrounding energy",
      "Often both live in the same card",
      "Where the energy is tending",
    ],
  },
  yes_no: { label: "Yes / No", count: 1, description: "A single guiding card" },
  horseshoe: {
    label: "Horseshoe",
    count: 7,
    description: "A broader life-situation reading in seven beats.",
    positions: [
      "Past",
      "Present",
      "Hidden Influences",
      "Obstacles",
      "External Influences",
      "Advice",
      "Outcome",
    ],
    positionsShort: ["Past", "Now", "Hid", "Obs", "Ext", "Adv", "Out"],
  },
  relationship: {
    label: "Relationship",
    count: 5,
    description: "You, them, the bond, the challenge, the outcome.",
    positions: ["You", "Your Partner", "The Connection", "The Challenge", "The Outcome"],
    positionsShort: ["You", "Them", "Bond", "Chal", "End"],
  },
  year_ahead: {
    label: "Year Ahead",
    count: 12,
    description: "One card per month for the year.",
    positions: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    positionsShort: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  },
  cross_of_decision: {
    label: "Cross of Decision",
    count: 5,
    description: "A five-card spread for choosing between two paths.",
    positions: ["The Situation", "Path A", "Path B", "Hidden Influence", "Likely Outcome"],
    positionsShort: ["Now", "A", "B", "Hid", "End"],
  },
  // 9-6-O — Custom: count is a placeholder; the runtime count comes
  // from the URL search param ?n= (1-10).
  custom: { label: "Custom", count: 1, description: "Pick how many cards." },
};

export function getSpreadCount(mode: SpreadMode): number {
  return SPREAD_META[mode].count;
}

/**
 * Whether this spread should render the bottom slot rail for selected cards.
 * Single-card flows (daily / single / yes_no) keep the existing in-place
 * selection feel — no slot rail.
 */
export function spreadUsesSlots(mode: SpreadMode, count?: number): boolean {
  if (mode === "custom") return (count ?? 1) >= 2;
  // EJ70 — Every multi-card named spread uses the slot rail.
  return (
    mode === "three" ||
    mode === "celtic" ||
    mode === "horseshoe" ||
    mode === "relationship" ||
    mode === "year_ahead" ||
    mode === "cross_of_decision"
  );
}

export function isValidSpreadMode(v: string | undefined | null): v is SpreadMode {
  return (
    v === "daily" ||
    v === "single" ||
    v === "three" ||
    v === "celtic" ||
    v === "yes_no" ||
    v === "horseshoe" ||
    v === "relationship" ||
    v === "year_ahead" ||
    v === "cross_of_decision" ||
    v === "custom"
  );
}
