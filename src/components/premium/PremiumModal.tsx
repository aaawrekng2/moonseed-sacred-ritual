/**
 * Q69 — Premium tier removed. This component is a no-op kept only so
 * existing imports compile. Safe to delete once all references are gone.
 */
type Props = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  featureName?: string;
};

export function PremiumModal(_props: Props) {
  void _props;
  return null;
}
