/**
 * v3.52 — /admin/activity route. Admin-gated (server fns also enforce it).
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { ActivityTab } from "@/components/admin/ActivityTab";

export const Route = createFileRoute("/admin/activity")({
  component: AdminActivityPage,
});

function AdminActivityPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!user?.id) {
        if (!cancelled) setAllowed(false);
        return;
      }
      const { data } = await supabase
        .from("user_preferences")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();
      const role = (data as { role?: string } | null)?.role ?? "user";
      const ok = role === "admin" || role === "super_admin";
      if (!cancelled) {
        setAllowed(ok);
        if (!ok) void navigate({ to: "/" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, navigate]);

  if (allowed !== true) return null;

  return (
    <div style={{ padding: "20px 16px", maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ fontFamily: "var(--font-display, serif)", marginBottom: 12 }}>Activity</h1>
      <ActivityTab />
    </div>
  );
}
