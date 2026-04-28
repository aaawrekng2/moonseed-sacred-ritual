import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  featureName?: string;
};

/**
 * PremiumModal — replaced with a redirect to /settings/moon. Any caller
 * that opens the modal will instead navigate to the dedicated Moon
 * settings page (the full premium shell).
 */
export function PremiumModal({ open, onOpenChange }: Props) {
  const navigate = useNavigate();
  useEffect(() => {
    if (open) {
      onOpenChange(false);
      void navigate({ to: "/settings/moon" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return null;
}