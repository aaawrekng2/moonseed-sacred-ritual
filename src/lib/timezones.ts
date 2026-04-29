/**
 * Curated IANA timezone list for the profile picker. Not exhaustive — covers
 * the common cases users actually pick. Falls back to the device tz if the
 * user's actual zone isn't here, which is fine because `auto` mode uses
 * whatever Intl reports.
 */
export const COMMON_TIMEZONES: Array<{ value: string; label: string }> = [
  { value: "Pacific/Honolulu", label: "Honolulu (HST)" },
  { value: "America/Anchorage", label: "Anchorage (AKST)" },
  { value: "America/Los_Angeles", label: "Los Angeles (PT)" },
  { value: "America/Denver", label: "Denver (MT)" },
  { value: "America/Phoenix", label: "Phoenix (MST, no DST)" },
  { value: "America/Chicago", label: "Chicago (CT)" },
  { value: "America/New_York", label: "New York (ET)" },
  { value: "America/Halifax", label: "Halifax (AT)" },
  { value: "America/Sao_Paulo", label: "São Paulo (BRT)" },
  { value: "Atlantic/Azores", label: "Azores" },
  { value: "Europe/London", label: "London (GMT/BST)" },
  { value: "Europe/Paris", label: "Paris (CET)" },
  { value: "Europe/Berlin", label: "Berlin (CET)" },
  { value: "Europe/Athens", label: "Athens (EET)" },
  { value: "Europe/Moscow", label: "Moscow (MSK)" },
  { value: "Africa/Johannesburg", label: "Johannesburg (SAST)" },
  { value: "Asia/Dubai", label: "Dubai (GST)" },
  { value: "Asia/Karachi", label: "Karachi (PKT)" },
  { value: "Asia/Kolkata", label: "India (IST)" },
  { value: "Asia/Bangkok", label: "Bangkok (ICT)" },
  { value: "Asia/Singapore", label: "Singapore (SGT)" },
  { value: "Asia/Hong_Kong", label: "Hong Kong (HKT)" },
  { value: "Asia/Tokyo", label: "Tokyo (JST)" },
  { value: "Australia/Perth", label: "Perth (AWST)" },
  { value: "Australia/Sydney", label: "Sydney (AEST/AEDT)" },
  { value: "Pacific/Auckland", label: "Auckland (NZST/NZDT)" },
  { value: "UTC", label: "UTC" },
];

/** Friendly label for a tz value; falls back to the raw IANA string. */
export function timezoneLabel(tz: string): string {
  return COMMON_TIMEZONES.find((t) => t.value === tz)?.label ?? tz;
}