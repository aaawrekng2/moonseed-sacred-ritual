/**
 * /admin layout — renders the Outlet so child routes (admin.index,
 * admin.usage, admin.usage.users.$userId) can mount.
 */
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin — Tarot Seed" }] }),
  component: () => <Outlet />,
});
