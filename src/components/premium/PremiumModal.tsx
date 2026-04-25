import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  featureName?: string;
};

/**
 * Premium upsell modal. Moonseed has no paid tier, so this is a friendly
 * acknowledgment screen rather than a real upsell — it exists for source
 * compatibility and so callers can wire it without wiring conditional
 * imports. No crown icons (per spec).
 */
export function PremiumModal({ open, onOpenChange, featureName }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            All features unlocked <Sparkles className="h-4 w-4 text-gold" />
          </DialogTitle>
          <DialogDescription>
            {featureName
              ? `${featureName} is available for everyone in Moonseed.`
              : "Every Moonseed feature is available to you — no upgrades needed."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="default" onClick={() => onOpenChange(false)}>
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}