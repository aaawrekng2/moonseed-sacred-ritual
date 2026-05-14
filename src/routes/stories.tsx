/**
 * Q52a — /stories collapses into Insights → Stories sub-tab.
 * Detail route /stories/$patternId still works because the redirect
 * only fires on the exact /stories path.
 */
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/stories")({
  beforeLoad: ({ location }) => {
    if (
      location.pathname === "/stories" ||
      location.pathname === "/stories/"
    ) {
      throw redirect({ to: "/insights", search: { tab: "stories" } });
    }
  },
  component: () => <Outlet />,
});