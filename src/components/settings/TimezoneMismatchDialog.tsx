import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useTimezone } from "@/lib/use-timezone";
import { timezoneLabel } from "@/lib/timezones";

/**
 * Mounted globally at the root. Surfaces a one-time popup when the seeker's
 * device timezone differs from the timezone saved on their profile and they
 * haven't dismissed the warning. Two clear paths:
 *  - "Use this device's time" → switches mode to auto + saves device tz.
 *  - "Keep my saved timezone" → just dismisses; profile + fixed mode untouched.
 */
export function TimezoneMismatchDialog() {
  const tz = useTimezone();
  const open = tz.mismatch && Boolean(tz.profileTz);

  if (!open || !tz.profileTz) return null;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) tz.dismissMismatch();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Your timezone has changed</AlertDialogTitle>
          <AlertDialogDescription>
            We have <strong>{timezoneLabel(tz.profileTz)}</strong> saved on
            your profile, but this device is set to{" "}
            <strong>{timezoneLabel(tz.deviceTz)}</strong>.
            <br />
            <br />
            Moon peaks and night windows will be shown in your saved timezone
            unless you switch.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-2">
          <AlertDialogCancel onClick={() => tz.dismissMismatch()}>
            Keep saved timezone
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={async () => {
              await tz.acceptDeviceTimezone();
            }}
          >
            Use this device's time
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}