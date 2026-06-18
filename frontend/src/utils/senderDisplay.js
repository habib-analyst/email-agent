/** Match backend deriveNameFromEmail — detect auto-guessed display names. */
export function looksLikeDerivedSenderName(name, email) {
  if (!name || !email) return false;
  const local = String(email).split('@')[0] || '';
  const derived = local
    .replace(/[._-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
  return name.trim().toLowerCase() === derived.trim().toLowerCase();
}

export function pickSenderName(authName, settingsName, email) {
  const fromAuth = (authName || '').trim();
  const fromSettings = (settingsName || '').trim();
  if (fromAuth && !looksLikeDerivedSenderName(fromAuth, email)) return fromAuth;
  if (fromSettings && !looksLikeDerivedSenderName(fromSettings, email)) return fromSettings;
  return fromAuth || fromSettings || '';
}
