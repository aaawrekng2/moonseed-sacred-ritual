// Q30 — legacy /threads URL → /stories redirect.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/threads")({
  beforeLoad: () => {
    throw redirect({ to: "/stories" });
  },
});
