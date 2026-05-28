/**
 * EJ70 — Standalone manual-entry layout constants.
 *
 * Extracted from ManualEntryBuilder.tsx to break a module-init cycle:
 * ManualEntryBuilder imports ManualSpreadSlots from SpreadLayout, while
 * SpreadLayout and SmartCardInput imported MANUAL_ENTRY_CONTENT_MAX back
 * from ManualEntryBuilder. That cycle left the const in a temporal dead
 * zone under certain bundler init orders ("Cannot access … before
 * initialization"). Housing the constant in its own leaf module (no
 * imports) means none of the three components import each other just for
 * this value, so the cycle is gone.
 */

/** Max content width (px) for the manual-entry column + its slot/spread layout. */
export const MANUAL_ENTRY_CONTENT_MAX = 640;
