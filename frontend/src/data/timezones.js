/**
 * Study-relevant countries for CS graduate outreach.
 * Each entry: label, flag emoji, IANA timezone, and a brief note.
 */
export const TIMEZONE_COUNTRIES = [
  // ── Americas ──
  { id: 'us-east',      label: 'USA (Eastern)',     flag: '🇺🇸', tz: 'America/New_York',     note: 'NY, MIT, Cornell, Columbia' },
  { id: 'us-central',   label: 'USA (Central)',     flag: '🇺🇸', tz: 'America/Chicago',      note: 'UIUC, UT Austin, Purdue' },
  { id: 'us-west',      label: 'USA (Western)',      flag: '🇺🇸', tz: 'America/Los_Angeles',  note: 'Stanford, UCLA, UC Berkeley' },
  { id: 'canada',       label: 'Canada',             flag: '🇨🇦', tz: 'America/Toronto',      note: 'UofT, UBC, McGill' },

  // ── Europe ──
  { id: 'uk',           label: 'UK',                 flag: '🇬🇧', tz: 'Europe/London',        note: 'Oxford, Cambridge, Imperial' },
  { id: 'germany',      label: 'Germany',            flag: '🇩🇪', tz: 'Europe/Berlin',        note: 'TU Munich, LMU, KIT' },
  { id: 'france',       label: 'France',             flag: '🇫🇷', tz: 'Europe/Paris',         note: 'Sorbonne, INRIA, École Poly' },
  { id: 'netherlands',  label: 'Netherlands',        flag: '🇳🇱', tz: 'Europe/Amsterdam',     note: 'TU Delft, UvA, Leiden' },
  { id: 'switzerland',  label: 'Switzerland',        flag: '🇨🇭', tz: 'Europe/Zurich',        note: 'ETH Zurich, EPFL' },
  { id: 'sweden',       label: 'Sweden',             flag: '🇸🇪', tz: 'Europe/Stockholm',     note: 'KTH, Lund, Uppsala' },
  { id: 'italy',        label: 'Italy',              flag: '🇮🇹', tz: 'Europe/Rome',          note: 'Polimi, Bologna, Sapienza' },
  { id: 'spain',        label: 'Spain',              flag: '🇪🇸', tz: 'Europe/Madrid',        note: 'UPC, UAB, UC3M' },
  { id: 'austria',      label: 'Austria',            flag: '🇦🇹', tz: 'Europe/Vienna',        note: 'TU Wien, Uni Wien' },
  { id: 'ireland',      label: 'Ireland',            flag: '🇮🇪', tz: 'Europe/Dublin',        note: 'Trinity, UCD, DCU' },
  { id: 'finland',      label: 'Finland',            flag: '🇫🇮', tz: 'Europe/Helsinki',      note: 'Aalto, Helsinki' },

  // ── Asia ──
  { id: 'china',        label: 'China',              flag: '🇨🇳', tz: 'Asia/Shanghai',        note: 'Tsinghua, Peking, SJTU' },
  { id: 'japan',        label: 'Japan',              flag: '🇯🇵', tz: 'Asia/Tokyo',           note: 'Tokyo, Kyoto, Osaka' },
  { id: 'south-korea',  label: 'South Korea',        flag: '🇰🇷', tz: 'Asia/Seoul',           note: 'KAIST, Seoul Natl, Yonsei' },
  { id: 'singapore',    label: 'Singapore',          flag: '🇸🇬', tz: 'Asia/Singapore',       note: 'NUS, NTU, SUTD' },
  { id: 'malaysia',     label: 'Malaysia',            flag: '🇲🇾', tz: 'Asia/Kuala_Lumpur',   note: 'UM, UTM, USM' },
  { id: 'hong-kong',    label: 'Hong Kong',          flag: '🇭🇰', tz: 'Asia/Hong_Kong',      note: 'HKU, HKUST, CUHK' },
  { id: 'taiwan',       label: 'Taiwan',              flag: '🇹🇼', tz: 'Asia/Taipei',          note: 'NTU, NTHU, NCKU' },

  // ── Oceania ──
  { id: 'australia',    label: 'Australia',           flag: '🇦🇺', tz: 'Australia/Sydney',     note: 'UNSW, Melbourne, ANU' },
  { id: 'new-zealand',  label: 'New Zealand',         flag: '🇳🇿', tz: 'Pacific/Auckland',    note: 'UoA, Canterbury' },
];

/** Pakistan timezone — always shown prominently */
export const PK_TZ = 'Asia/Karachi';

/**
 * Get current time in an IANA timezone as a formatted string.
 * Uses Intl.DateTimeFormat for proper DST handling.
 */
export function getTimeInZone(tz, format = 'full') {
  const now = new Date();
  if (format === 'time') {
    return now.toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  if (format === 'date') {
    return now.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' });
  }
  return now.toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * Get hour (0-23) in a timezone for timing advice.
 */
export function getHourInZone(tz) {
  return parseInt(new Date().toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }));
}

/**
 * Classify the current time as business hours / off-hours / sleep hours.
 * Returns: 'business' (8-17), 'off' (17-22), 'sleep' (22-8)
 */
export function classifyTimeInZone(tz) {
  const h = getHourInZone(tz);
  if (h >= 8 && h < 17)  return 'business';
  if (h >= 17 && h < 22) return 'off';
  return 'sleep';
}

/**
 * Human-readable label for time classification.
 */
export const TIME_CLASS_LABELS = {
  business: { label: 'Business Hours', textClass: 'text-emerald-700 dark:text-emerald-300', icon: '✅' },
  off:      { label: 'Off Hours',      textClass: 'text-amber-700 dark:text-amber-300',    icon: '⚠️' },
  sleep:    { label: 'Sleep Hours',    textClass: 'text-red-700 dark:text-red-300',        icon: '❌' },
};

/**
 * UTC offset string (e.g. "UTC+5" for PK, "UTC-5" for US Eastern).
 */
export function getUTCOffset(tz) {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' });
  const parts = fmt.formatToParts(now);
  const offsetPart = parts.find(p => p.type === 'timeZoneName');
  return offsetPart?.value || '';
}

/**
 * Map US state abbreviations to their primary IANA timezone.
 */
export const US_STATE_TIMEZONES = {
  // Eastern Time
  NY: 'America/New_York', NJ: 'America/New_York', PA: 'America/New_York',
  MA: 'America/New_York', CT: 'America/New_York', RI: 'America/New_York',
  VT: 'America/New_York', NH: 'America/New_York', ME: 'America/New_York',
  MD: 'America/New_York', DE: 'America/New_York', VA: 'America/New_York',
  WV: 'America/New_York', NC: 'America/New_York', SC: 'America/New_York',
  GA: 'America/New_York', FL: 'America/New_York', DC: 'America/New_York',
  OH: 'America/New_York', MI: 'America/Detroit', KY: 'America/New_York',
  // Central Time
  IL: 'America/Chicago', IN: 'America/Chicago', WI: 'America/Chicago',
  MN: 'America/Chicago', IA: 'America/Chicago', MO: 'America/Chicago',
  ND: 'America/Chicago', SD: 'America/Chicago', NE: 'America/Chicago',
  KS: 'America/Chicago', OK: 'America/Chicago', TX: 'America/Chicago',
  LA: 'America/Chicago', AR: 'America/Chicago', MS: 'America/Chicago',
  AL: 'America/Chicago', TN: 'America/Chicago',
  // Mountain Time
  MT: 'America/Denver', WY: 'America/Denver', CO: 'America/Denver',
  NM: 'America/Denver', UT: 'America/Denver', ID: 'America/Boise', AZ: 'America/Phoenix',
  // Pacific Time
  WA: 'America/Los_Angeles', OR: 'America/Los_Angeles', CA: 'America/Los_Angeles',
  NV: 'America/Los_Angeles',
  // Alaska & Hawaii
  AK: 'America/Anchorage', HI: 'Pacific/Honolulu',
};

/**
 * Get the IANA timezone for a US state abbreviation. Falls back to Eastern Time.
 */
export function getStateTimezone(stateAbbr) {
  return US_STATE_TIMEZONES[stateAbbr?.toUpperCase()] || 'America/New_York';
}
