// Q30 — legacy /threads/:patternId URL → /stories/:patternId redirect.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/threads/$patternId")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/stories/$patternId", params });
  },
});
