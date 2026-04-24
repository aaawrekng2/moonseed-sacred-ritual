import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 pb-24 text-center">
      <h1 className="font-display text-2xl text-foreground">Settings</h1>
      <p className="mt-2 font-display text-sm italic text-muted-foreground">
        Coming soon.
      </p>
    </main>
  );
}