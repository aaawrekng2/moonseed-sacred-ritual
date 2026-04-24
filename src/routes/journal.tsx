import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/journal")({
  head: () => ({
    meta: [
      { title: "Journal — Moonseed" },
      { name: "description", content: "Your tarot journal." },
    ],
  }),
  component: JournalPage,
});

function JournalPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 pb-24">
      <h1 className="font-display text-3xl text-foreground">Journal</h1>
      <p className="mt-3 max-w-xs text-center text-sm italic text-muted-foreground">
        Your readings will gather here.
      </p>
    </main>
  );
}