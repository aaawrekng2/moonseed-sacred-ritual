/**
 * 26-05-08-Q12 — Curated journaling prompts indexed by the canonical
 * 0..77 tarot card id from `src/lib/tarot.ts`. Voice: introspective,
 * second-person, gentle. ~3-5 prompts per card.
 */
export const STANDARD_TAROT_PROMPTS: Record<number, string[]> = {
  // --- Majors ---
  0: [
    "What new beginning is calling you?",
    "Where are you being asked to leap without a plan?",
    "What would shift if you trusted you have what you need?",
    "What is your heart eager to begin?",
  ],
  1: [
    "What tools or strengths are already in your hands?",
    "Where are you being asked to focus your will?",
    "What are you ready to bring into form?",
    "How can you act with intention today?",
  ],
  2: [
    "What does your intuition already know?",
    "Where are you being asked to listen rather than speak?",
    "What truth lives in the silence beneath this question?",
  ],
  3: [
    "What in your life is asking to be nurtured?",
    "Where can you be more generous with yourself?",
    "What creative seed is ready to grow?",
  ],
  4: [
    "What structure is steadying you right now?",
    "Where do you need to claim your own authority?",
    "What boundary is ready to be drawn?",
  ],
  5: [
    "What inherited belief is asking to be examined?",
    "Whose voice are you mistaking for your own?",
    "What tradition still serves you, and which can be released?",
  ],
  6: [
    "What choice is asking for your whole heart?",
    "Where are your values and your actions aligned?",
    "Who or what are you being called into deeper relationship with?",
  ],
  7: [
    "What direction is your will pointing you toward?",
    "Where are you being asked to gather your forces?",
    "What are you driving forward, and what is driving you?",
  ],
  8: [
    "Where can gentleness be your strength?",
    "What part of you is asking to be met with compassion, not force?",
    "How are you taming what once felt wild within you?",
  ],
  9: [
    "What does your solitude have to teach you?",
    "What inner light are you being asked to follow?",
    "Where do you need to slow down and look inward?",
  ],
  10: [
    "What cycle is turning in your life?",
    "What can you release control of right now?",
    "Where is fate inviting you to participate, not resist?",
  ],
  11: [
    "What truth are you being asked to face honestly?",
    "Where in your life is balance being restored?",
    "What choice are you accountable for today?",
  ],
  12: [
    "What perspective is asking to be reversed?",
    "Where are you being asked to surrender, not strive?",
    "What new way of seeing is becoming possible?",
  ],
  13: [
    "What is ready to end so something new can begin?",
    "What part of an old self are you grieving?",
    "Where is transformation already underway?",
  ],
  14: [
    "Where can you bring more patience and proportion?",
    "What two opposites are asking to be blended?",
    "What middle path are you being shown?",
  ],
  15: [
    "What chain are you mistaking for safety?",
    "Where is your shadow asking to be acknowledged, not banished?",
    "What attachment are you ready to loosen?",
  ],
  16: [
    "What false structure is collapsing — and what truth does it reveal?",
    "Where is sudden clarity arriving, even if it stings?",
    "What can be rebuilt now that the old form has fallen?",
  ],
  17: [
    "What hope is quietly returning to you?",
    "Where in your life is healing beginning?",
    "What vision is worth following, even softly?",
  ],
  18: [
    "What is being illuminated in the half-light?",
    "What old fear is rising to be witnessed?",
    "Where are you being asked to trust the unseen?",
  ],
  19: [
    "What part of you is ready to be seen?",
    "Where is joy returning to your life?",
    "What truth feels warm to stand inside of?",
  ],
  20: [
    "What is calling you to rise up and answer?",
    "What old version of yourself is being released?",
    "Where is forgiveness — of self or other — becoming possible?",
  ],
  21: [
    "What chapter is reaching its completion?",
    "What have you woven together that you can now stand inside?",
    "Where do you feel a sense of arrival?",
  ],

  // --- Wands (22..35) ---
  22: ["What spark is asking to be acted on?", "Where is new energy beginning to move?", "What inspired idea wants to take its first form?"],
  23: ["What plan are you on the verge of choosing between?", "Where do you need to widen your horizon?", "What feels possible if you commit?"],
  24: ["What long-term vision are you building toward?", "Where is your patient effort already paying off?", "What collaboration is asking for your trust?"],
  25: ["What homecoming are you celebrating?", "Where can you let yourself be seen for what you've built?", "What stable ground deserves to be honored?"],
  26: ["Where are competing voices clashing inside you?", "What disagreement is actually a chance to refine your craft?", "How can friction sharpen rather than wound you?"],
  27: ["What victory deserves to be acknowledged out loud?", "Where are you being recognized — and how does that feel?", "What momentum is worth riding next?"],
  28: ["What boundary are you defending, and is it still worth the cost?", "Where do you need to hold your ground?", "What feels like opposition but might be a test of your conviction?"],
  29: ["What news is moving quickly in your life?", "Where do you need to act without overthinking?", "What message wants to be delivered now?"],
  30: ["Where are you carrying more than is yours to carry?", "What burden can be set down or shared?", "What part of the load is almost finished?"],
  31: ["Where are you on guard, and is the threat still real?", "What rest would you allow yourself if you let go of vigilance?", "What just ended that you haven't yet exhaled from?"],
  32: ["What spark of possibility is waiting on your reply?", "Where is curiosity asking to be followed?", "What restless energy wants somewhere to go?"],
  33: ["What journey are you in the middle of?", "Where are you being moved, even if you didn't choose the direction?", "What does this passage have to teach you?"],
  34: ["What truth are you ready to speak with confidence?", "Where can warmth and conviction live in the same breath?", "What invitation are you ready to extend?"],
  35: ["What vision are you being entrusted with?", "Where can you lead from your own fire, not someone else's?", "What does mature creative power look like for you now?"],

  // --- Cups (36..49) ---
  36: ["What feeling is asking to be received with open hands?", "Where is love beginning, in any form?", "What inner spring is rising to the surface?"],
  37: ["What connection is being offered to you?", "Where do you feel met, equal to equal?", "What partnership is asking for honesty?"],
  38: ["Who are your people right now?", "Where is joy meant to be shared, not held alone?", "What community deserves your gratitude?"],
  39: ["What familiar comfort no longer satisfies you?", "Where is restlessness pointing you toward something more honest?", "What fourth cup is already waiting if you turn toward it?"],
  40: ["What grief still wants to be sat with?", "What can you find in what was not lost?", "Where is something whole still standing beside what spilled?"],
  41: ["What memory is asking to be visited gently?", "Where is innocence offering you wisdom?", "What from your past wants to be brought into your present?"],
  42: ["Which of your dreams deserves a clear-eyed look?", "Where are you choosing fantasy over the next real step?", "What would you choose if every option were possible?"],
  43: ["What are you walking away from, and is the leaving the point?", "Where is disappointment opening a door?", "What deeper search is calling you?"],
  44: ["What inner work are you quietly mastering?", "Where have you arrived at emotional fluency?", "What feeling is yours to feel fully now?"],
  45: ["What wish, if you let yourself name it, is closer than you thought?", "Where can satisfaction be allowed without guilt?", "What contentment is asking to be celebrated?"],
  46: ["What invitation is curiosity offering you?", "Where is your heart asking to start something new?", "What soft message wants to be delivered?"],
  47: ["Where is your own depth surprising you?", "What feeling are you exploring, slowly, on purpose?", "What inner current is worth following?"],
  48: ["What truth are you ready to speak with feeling?", "Where do compassion and clarity meet in you?", "What emotional honesty is being asked of you?"],
  49: ["What feeling have you become wise about?", "Where is your love steadier than it used to be?", "What does emotional sovereignty look like for you?"],

  // --- Swords (50..63) ---
  50: ["What clear thought is cutting through the fog?", "What truth wants to be named simply?", "Where is decisiveness called for?"],
  51: ["What choice are you avoiding by keeping your eyes closed?", "Where is the standoff actually inside you?", "What would shift if you let yourself look?"],
  52: ["What rest are you finally allowed to take?", "Where is your mind asking for stillness?", "What recovery is in process?"],
  53: ["What grief is asking to be felt, not solved?", "Where can sorrow be honored without being amplified?", "What is true even underneath the heartbreak?"],
  54: ["What 'win' is leaving an aftertaste?", "Where are you being asked to act with more honor than cunning?", "What price does this success ask of you?"],
  55: ["What are you carrying away from this chapter?", "Where is moving on the wisest act of self-respect?", "What does the leaving make room for?"],
  56: ["Where is your inner critic louder than your truth?", "What story are you repeating that no longer fits?", "Whose voice is haunting your nights?"],
  57: ["What old pattern is asking to be cut, finally?", "Where are you the one keeping the cage closed?", "What would freedom of mind feel like today?"],
  58: ["Where is action faster than understanding right now?", "What do you need to slow down enough to actually see?", "What thought are you running from?"],
  59: ["What truth are you ready to speak out loud?", "Where is honesty more important than comfort?", "What needs to be named directly?"],
  60: ["What young, sharp curiosity is alive in you?", "Where do you need to ask the bold question?", "What truth are you scouting for?"],
  61: ["What clear-eyed conviction is moving you?", "Where can directness be a kindness?", "What stand are you ready to take?"],
  62: ["What painful clarity have you earned?", "Where can wisdom replace bitterness?", "What truth do you now hold with grace?"],
  63: ["What perspective is asking for full sovereignty?", "Where is your discernment your gift to others?", "What truth do you no longer flinch from?"],

  // --- Pentacles (64..77) ---
  64: ["What new opportunity is taking root?", "Where is something tangible beginning?", "What seed deserves your steady attention?"],
  65: ["What rhythm of work and rest is asking to be honored?", "Where can you juggle without dropping yourself?", "What balance feels almost playful right now?"],
  66: ["What craft are you quietly devoted to?", "Where can patience and skill keep deepening?", "What practice is becoming who you are?"],
  67: ["What are you being too tightly grasped about?", "Where can security loosen into generosity?", "What is enough, today?"],
  68: ["What lack are you grieving — and what is still here, beside it?", "Where is help available if you'd let yourself ask?", "What warmth exists even in this cold stretch?"],
  69: ["What can you give from genuine abundance?", "Where is fair exchange the lesson?", "What does dignified receiving look like for you?"],
  70: ["Where is it time to assess what you've built?", "What deserves more of your time, not less?", "What investment is asking for a clearer yes or no?"],
  71: ["What are you patiently mastering?", "Where can pride in steady work live without apology?", "What craft is becoming yours?"],
  72: ["What independence are you growing into?", "Where can self-trust replace asking for permission?", "What stability is yours to enjoy?"],
  73: ["What lineage are you grateful to belong to?", "Where is wealth — material, relational, spiritual — already abundant?", "What legacy are you tending?"],
  74: ["What opportunity is being offered you to learn?", "Where are you a willing student again?", "What practical step is the next right one?"],
  75: ["What slow, steady effort is paying off?", "Where can reliability be a form of love?", "What feels good to keep showing up for?"],
  76: ["What are you tending with quiet generosity?", "Where is care the most strategic move?", "What feels rooted and warm in your life?"],
  77: ["What mastery have you arrived at without quite noticing?", "Where can you enjoy the fruits of your labor?", "What does grounded abundance look like for you?"],
};

export type StandardTarotPromptId = keyof typeof STANDARD_TAROT_PROMPTS;