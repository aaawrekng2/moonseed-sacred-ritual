/**
 * Settings → Data tab.
 *
 * Three actions:
 *   1. Export — downloads readings + preferences as JSON
 *   2. Sign out — ends the Supabase session
 *   3. Clear local cache — wipes localStorage moonseed:* keys
 *
 * Account deletion is intentionally not exposed in-app — users contact
 * support so we can clean up across all tables atomically.
 */
import { useState } from "react";
import { Download, Loader2, LogOut, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "./SettingsContext";
import { SettingsSection } from "./sections";

export function DataTab() {
  const { user } = useSettings();
  const [exporting, setExporting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const exportData = async () => {
    setExporting(true);
    try {
      const [{ data: readings }, { data: prefs }] = await Promise.all([
        supabase.from("readings").select("*").eq("user_id", user.id),
        supabase
          .from("user_preferences")
          .select("*")
          .eq("user_id", user.id)
          .maybeSingle(),
      ]);
      const payload = {
        app: "Moonseed",
        exported_at: new Date().toISOString(),
        user_id: user.id,
        preferences: prefs,
        readings: readings ?? [],
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `moonseed-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Export downloaded");
    } catch {
      toast.error("Couldn't export your data");
    } finally {
      setExporting(false);
    }
  };

  const signOut = async () => {
    setSigningOut(true);
    const { error } = await supabase.auth.signOut();
    setSigningOut(false);
    if (error) {
      toast.error("Couldn't sign out");
      return;
    }
    window.location.href = "/";
  };

  const clearLocal = () => {
    if (typeof window === "undefined") return;
    if (!window.confirm("Clear all locally cached Moonseed settings?")) return;
    Object.keys(localStorage)
      .filter((k) => k.startsWith("moonseed:") || k.startsWith("arcana:"))
      .forEach((k) => localStorage.removeItem(k));
    window.location.reload();
  };

  return (
    <div className="space-y-10">
      <SettingsSection
        title="Your Data"
        description="Everything you've created in Moonseed lives in your account."
      >
        <div className="space-y-3">
          <Button
            variant="outline"
            onClick={() => void exportData()}
            disabled={exporting}
            className="w-full justify-start gap-2 sm:w-auto"
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Export readings + settings
          </Button>
          <p className="text-xs text-muted-foreground">
            Downloads a JSON file with every reading and your full preference row.
          </p>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Local Cache"
        description="Reset locally cached settings without touching your account."
      >
        <Button
          variant="ghost"
          onClick={clearLocal}
          className="w-full justify-start gap-2 sm:w-auto"
        >
          <RotateCcw className="h-4 w-4" />
          Clear local cache
        </Button>
      </SettingsSection>

      <SettingsSection
        title="Session"
        description="Sign out from this device."
      >
        <Button
          variant="outline"
          onClick={() => void signOut()}
          disabled={signingOut}
          className="w-full justify-start gap-2 sm:w-auto"
        >
          {signingOut ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <LogOut className="h-4 w-4" />
          )}
          Sign out
        </Button>
        <p className="text-xs text-muted-foreground">
          To delete your account permanently, please contact support.
        </p>
      </SettingsSection>
    </div>
  );
}