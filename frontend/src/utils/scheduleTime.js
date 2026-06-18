import { TIMEZONE_COUNTRIES, getHourInZone } from '../data/timezones.js';

/** Build UTC Date for next occurrence of hour:minute in an IANA timezone. */
export function zonedLocalToUtcDate(tz, hour = 9, minute = 0, after = new Date()) {
  const probe = new Date(after.getTime());
  for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
    const d = new Date(probe.getTime() + dayOffset * 86400000);
    const y = d.getFullYear();
    const mo = d.getMonth() + 1;
    const da = d.getDate();
    const guessUtc = new Date(Date.UTC(y, mo - 1, da, hour, minute, 0));
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(guessUtc);
    const pick = (t) => parseInt(parts.find(p => p.type === t)?.value || '0', 10);
    const localH = pick('hour') % 24;
    const localM = pick('minute');
    const diffMin = (hour * 60 + minute) - (localH * 60 + localM);
    const adjusted = new Date(guessUtc.getTime() + diffMin * 60000);
    if (adjusted.getTime() > after.getTime()) return adjusted;
  }
  return new Date(after.getTime() + 86400000);
}

/** Next 9:00 AM business send across selected country timezones (earliest valid). */
export function suggestNextBusinessSendUtc(countryIds = [], after = new Date()) {
  const countries = TIMEZONE_COUNTRIES.filter(c => countryIds.includes(c.id));
  if (!countries.length) return null;

  let best = null;
  for (const c of countries) {
    let candidate = zonedLocalToUtcDate(c.tz, 9, 0, after);
    // If still in sleep hours at candidate, bump to next day 9am
    for (let i = 0; i < 3; i++) {
      const h = getHourInZone(c.tz);
      if (h >= 8 && h < 17) break;
      candidate = zonedLocalToUtcDate(c.tz, 9, 0, new Date(candidate.getTime() + 86400000));
    }
    if (!best || candidate < best) best = candidate;
  }
  return best;
}

/** Parse local date + time strings to UTC ISO (user's browser local). */
export function localDateTimeToUtcIso(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const d = new Date(`${dateStr}T${timeStr}:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Reschedule picker: combine date + time in local browser TZ → UTC ISO. */
export function rescheduleLocalToUtcIso(dateStr, timeStr) {
  return localDateTimeToUtcIso(dateStr, timeStr);
}
