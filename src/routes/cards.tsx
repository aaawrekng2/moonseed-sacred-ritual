import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/cards")({
  head: () => ({
    meta: [
      { title: "Cards — Moonseed" },
      { name: "description", content: "Browse the tarot deck." },
      { property: "og:title", content: "Cards — Moonseed" },
      { property: "og:description", content: "Browse the tarot deck." },
    ],
  }),
  component: CardsPage,
});

function CardsPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 pb-24">
      <h1 className="font-display text-3xl text-foreground">Cards</h1>
      <p className="mt-3 max-w-xs text-center text-sm italic text-muted-foreground">
        The deck will live here — swipe, study, and reflect.
      </p>
    </main>
  );
}