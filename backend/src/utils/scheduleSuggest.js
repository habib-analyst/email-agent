/** Minimal timezone helpers for schedule suggestions (mirrors frontend timezones.js). */
const COUNTRY_TZ = {
  'us-east': 'America/New_York', 'us-central': 'America/Chicago', 'us-west': 'America/Los_Angeles',
  canada: 'America/Toronto', uk: 'Europe/London', germany: 'Europe/Berlin', france: 'Europe/Paris',
  netherlands: 'Europe/Amsterdam', switzerland: 'Europe/Zurich', sweden: 'Europe/Stockholm',
  italy: 'Europe/Rome', spain: 'Europe/Madrid', austria: 'Europe/Vienna', ireland: 'Europe/Dublin',
  finland: 'Europe/Helsinki', china: 'Asia/Shanghai', japan: 'Asia/Tokyo', 'south-korea': 'Asia/Seoul',
  singapore: 'Asia/Singapore', malaysia: 'Asia/Kuala_Lumpur', 'hong-kong': 'Asia/Hong_Kong',
  taiwan: 'Asia/Taipei', australia: 'Australia/Sydney', 'new-zealand': 'Pacific/Auckland',
};

function getHourInZone(tz) {
  return parseInt(new Date().toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }), 10);
}

function classifyTimeInZone(tz) {
  const h = getHourInZone(tz);
  if (h >= 8 && h < 17) return 'business';
  if (h >= 17 && h < 22) return 'off';
  return 'sleep';
}

/** Suggest next business-hour send time (local user time) for selected country IDs. */
export function suggestScheduledAt(countryIds = [], fromDate = new Date()) {
  const zones = (countryIds || []).map(id => COUNTRY_TZ[id]).filter(Boolean);
  if (!zones.length) {
    const d = new Date(fromDate);
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return { suggested: d.toISOString(), reason: 'Default: tomorrow 9:00 AM (no timezone countries selected)' };
  }

  const bad = zones.some(tz => classifyTimeInZone(tz) !== 'business');
  const d = new Date(fromDate);
  if (bad) {
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return { suggested: d.toISOString(), reason: 'Some targets outside business hours — suggested tomorrow 9:00 AM your time' };
  }

  d.setMinutes(d.getMinutes() + 30);
  return { suggested: d.toISOString(), reason: 'All targets in business hours — send in ~30 minutes' };
}

export function splitIntoWaves(emails, waveSize) {
  const size = Math.max(1, Number(waveSize) || 50);
  const waves = [];
  for (let i = 0; i < emails.length; i += size) {
    waves.push(emails.slice(i, i + size));
  }
  return waves;
}
