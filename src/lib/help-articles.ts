/**
 * DP-5 — Help system v1 article registry.
 *
 * Five articles across six categories. Body is light markdown rendered
 * by the article view component (paragraphs, headings, bullets, bold,
 * italic, links). Cross-links use [text](#article-id) syntax — the
 * renderer rewrites them to /help/{category}/{article}.
 */

export type HelpCategoryId =
  | "getting-started"
  | "tarot-and-readings"
  | "stories-and-memory"
  | "sharing"
  | "customization"
  | "account-and-premium";

export type HelpCategory = {
  id: HelpCategoryId;
  name: string;
  blurb: string;
};

export const HELP_CATEGORIES: HelpCategory[] = [
  {
    id: "getting-started",
    name: "Getting Started",
    blurb: "What Moonseed is, and how to begin.",
  },
  {
    id: "tarot-and-readings",
    name: "Tarot & Readings",
    blurb: "How interpretation works. Mirror Artifact.",
  },
  {
    id: "stories-and-memory",
    name: "Stories & Memory",
    blurb: "How Moonseed remembers you across readings.",
  },
  {
    id: "sharing",
    name: "Sharing",
    blurb: "The five share levels and when to use each.",
  },
  {
    id: "customization",
    name: "Customization",
    blurb: "Themes, decks, and atmosphere.",
  },
  {
    id: "account-and-premium",
    name: "Account & Premium",
    blurb: "Sign in, backup, premium features.",
  },
];

export type HelpArticle = {
  id: string;
  title: string;
  category: HelpCategoryId;
  /** One-line preview shown in the hub list. */
  summary: string;
  /** Light markdown — paragraphs, ##, bullets, **bold**, *italic*, [text](#id) */
  body: string;
  /** Other article ids worth surfacing as "related". */
  related?: string[];
};

export const HELP_ARTICLES: HelpArticle[] = [
  {
    id: "getting-started",
    title: "Getting Started",
    category: "getting-started",
    summary: "Your first reading, and what makes Moonseed different.",
    body: `Moonseed is tarot that remembers you. It is a daily ritual app built around three small movements — a *draw*, a *reading*, and a *journal* — that, together, become a record of your inner weather over time.

## A first reading

Tap the deck on the home screen. Choose a spread (start with a single card if you are new). The cards scatter; pick the ones that call to you, then reveal them. A short interpretation appears, voiced by your active guide. Stay with it for a moment — the reading is the encounter, not the words.

## Draw, reading, journal

- A **draw** is the moment you pull cards. It is brief and bodily.
- A **reading** is the interpretation that follows — what the cards seem to say *here, now, to you*.
- The **journal** holds every reading you keep, so you can return to them later.

## "Tarot that remembers you"

Most tarot apps treat each reading as a fresh stranger. Moonseed does not. As you accumulate readings, recurring themes surface as [Stories](#stories), and your guide grows more specific to the patterns of your life. The cards stay the same; the conversation deepens.`,
    related: ["how-interpretation-works", "stories"],
  },
  {
    id: "how-interpretation-works",
    title: "How interpretation works",
    category: "tarot-and-readings",
    summary: "Standard readings, Deep Readings, and the guide system.",
    body: `When you reveal cards, Moonseed asks an AI — held inside the *voice* of your chosen guide — to write a short interpretation. The interpretation reflects three things: the cards drawn, the spread positions, and (if you offered one) your question.

## Standard vs. Deep Reading

A **standard reading** is a single, unified interpretation: an overview, a per-position read, a closing line. It is the everyday gesture.

A **Deep Reading** is longer, slower, and layered. It introduces *Lenses* — alternate angles on the same draw (psychological, mythic, somatic, practical) — so you can sit with the spread from more than one direction. Deep Readings are best for thresholds: a decision, a grief, a beginning.

## Voice, Lens, Facets

The guide system is shaped around three knobs:

- **Voice** — *who* is speaking. Each guide has a tone, a worldview, a vocabulary.
- **Lens** — *how* they are looking at the cards in this moment.
- **Facets** — small dials for length, directness, mysticism vs. plainness.

## Why interpretations evolve

The more you journal, the more the system knows about your patterns. Future readings can quietly reference what came before — a card returning, a question still open. This is the *memory* in tarot that remembers you.`,
    related: ["mirror-artifact", "stories"],
  },
  {
    id: "stories",
    title: "Stories & Memory",
    category: "stories-and-memory",
    summary: "How recurring threads across your readings become a Story.",
    body: `A **Story** is a short evocative name — usually two or three words — that Moonseed surfaces when it notices the same theme returning across several of your readings.

## How a Story forms

After enough readings accumulate, a background pass looks for repetition: cards that keep appearing, questions that keep circling, an emotional weather that lingers. When a pattern crystallizes, it is given a name (e.g. *Quiet Threshold*, *Patient Fire*) and the readings that contributed are linked to it.

## Where you see Stories

- In the **journal**, each reading that belongs to a Story shows a small network glyph next to it.
- The interpretation panel may say *"this aligns with your Story: …"* with a link to the thread.
- The dedicated **Stories** screen lists every Story you have, ordered by recency.

## Why this matters

Single readings are gestures. Stories are *the shape your inner life makes over time*. The system does not invent them — it surfaces what was already there.`,
    related: ["how-interpretation-works", "mirror-artifact"],
  },
  {
    id: "mirror-artifact",
    title: "Mirror Artifact",
    category: "tarot-and-readings",
    summary: "The deepest share level — the reading that became a relic.",
    body: `The **Mirror Artifact** is the rarest of the five [share levels](#share-levels). It is reserved for readings that have, over time, *become something*: a reference point you keep returning to, a turning, a hinge.

## What it is

An Artifact is a composed image-and-text card that treats the reading as a small relic. It includes the cards, a distilled phrase from the interpretation, and a quiet visual frame meant for keeping rather than for scrolling past.

## When it surfaces

The Artifact share becomes available when a reading has been **revisited**, **journaled into**, or **linked to a [Story](#stories)** — i.e., when it has earned the weight to be one. A first-pull single-card reading does not need to be an Artifact, and Moonseed will not pretend that it is.

## How to share one

Open the share menu on a qualifying reading and select **Mirror Artifact** at the top of the level list. The composed card is captured and ready to save or share.`,
    related: ["share-levels", "stories"],
  },
  {
    id: "share-levels",
    title: "Share Levels overview",
    category: "sharing",
    summary: "Five ways to share a reading. How to choose between them.",
    body: `Every reading can be shared at one of five levels. Each level shows progressively *more* of the reading; choose the depth that matches the moment.

## The five levels

1. **Single Pull** — just the card(s), face up, no interpretation. The moment of revelation. Use when the cards speak for themselves.
2. **Full Reading** — cards plus a short distilled snippet of the interpretation. The standard share.
3. **Spread Position** — focus on one position in the spread (e.g. *the past* card, *the obstacle* card). Use when one card carries the weight.
4. **Deep Lens** — share a single Lens from a Deep Reading. For when the angle, not the cards, is what you want to send.
5. **[Mirror Artifact](#mirror-artifact)** — the rarest. A composed relic for readings that have earned weight.

## How to choose

If you are sharing a moment, choose **Single Pull**. If you are sharing the *insight*, choose **Full Reading**. If you want to point at one specific thing, choose **Spread Position** or **Deep Lens**. The Artifact is for the few readings you will still be thinking about months from now.`,
    related: ["mirror-artifact"],
  },
  {
    id: "four-lenses",
    title: "The Four Lenses of a Deep Reading",
    category: "tarot-and-readings",
    summary: "Present Resonance, Thread Awareness, Shadow Layer, Mirror Artifact.",
    body: `A Deep Reading is what happens when you ask Moonseed to look more carefully at a reading you've already drawn. Where the regular interpretation gives you one cohesive read, a Deep Reading offers four distinct perspectives — four lenses through which the same cards reveal different layers.

This isn't decoration. Tarot has always invited multiple readings of the same draw. The cards don't change; what shifts is the question you bring to them. The four lenses formalize four classic angles of inquiry that experienced readers naturally cycle through. Moonseed makes them explicit so you can use them deliberately.

## Present Resonance

This is the "you are here" of the reading. Present Resonance reads the cards as a description of what's actually happening in your life right now — the texture of this moment, the dynamics in motion, the weather of your inner and outer world. It's the most immediate lens. If you only had time to read one, you'd read this one.

Use it when: you want grounded, current-moment clarity. *"What's going on?"*

## Thread Awareness

This lens looks beyond this specific reading and notices what threads it shares with your past readings. Have similar cards appeared before? Are you returning to a question you've asked in different forms? Thread Awareness surfaces the larger story your readings have been telling — the recurring symbols, the unresolved tensions, the arcs you're still living through.

This lens is sometimes empty — it only fills when the system can connect this reading to meaningful patterns in your history. When it does fill, pay attention. Repetition in tarot is rarely accidental.

Use it when: you want to see this reading in context. *"How does this fit with the Stories I've been carrying?"*

## Shadow Layer

Shadow Layer is the harder, less-comfortable read of the cards. It asks the question most readings politely sidestep: **what doesn't this reading want to look at?** Where might you be flattering yourself? What's the reading suggesting you've been avoiding? What's the version of this interpretation you'd resist hearing from a friend?

Shadow Layer is not negativity. It's honesty. The cards always carry both their face value and their inverse — this lens reads the inverse explicitly so you can hold both at once. Some seekers find this lens uncomfortable. That discomfort is often the point.

Use it when: you trust the reading too much, OR you want a balancing perspective on something you're hoping to hear. *"What am I not seeing?"*

## Mirror Artifact

Mirror Artifact is a poetic, quotable reflection on the reading — distilled, compressed, save-worthy. It's the line you might write down in a paper journal, or screenshot for later. Where the other three lenses analyze, Mirror Artifact crystallizes.

If a reading really lands, Mirror Artifact is what stays with you after you close the app. You can save any reading to your journal (the bookmark icon next to its row) so the Mirror lens — and the rest of the reading — stays easy to find.

Use it when: you want something to carry away. The cards' essence in a few sentences.

## How to use the lenses

There's no required order. Most seekers scan all four after a Deep Reading, pause on whichever resonates most, and dismiss the rest. Some readings, all four lenses speak. Other readings, only one matters. Both are normal.

If a lens feels off, dismiss it. The cards know what they came to say — the lenses are just four ways of asking. Trust your instinct about which questions belong to this reading.`,
    related: ["how-interpretation-works", "mirror-artifact"],
  },
];

export function getArticleById(id: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((a) => a.id === id);
}

export function getArticlesByCategory(cat: HelpCategoryId): HelpArticle[] {
  return HELP_ARTICLES.filter((a) => a.category === cat);
}