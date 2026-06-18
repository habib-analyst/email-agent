/**
 * Session epoch — incremented on every reset.
 * Background scrape/worker jobs capture epoch at start; if it changes, they stop writing.
 */
let cachedEpoch = null;

export function ensureEpochColumn(db) {
  try { db.exec('ALTER TABLE settings ADD COLUMN session_epoch INTEGER DEFAULT 0'); } catch {}
}

export function getSessionEpoch(db) {
  ensureEpochColumn(db);
  if (cachedEpoch === null) {
    const row = db.prepare('SELECT session_epoch FROM settings WHERE id=1').get();
    cachedEpoch = row?.session_epoch ?? 0;
  }
  return cachedEpoch;
}

export function bumpSessionEpoch(db) {
  ensureEpochColumn(db);
  const next = getSessionEpoch(db) + 1;
  db.prepare('UPDATE settings SET session_epoch=? WHERE id=1').run(next);
  cachedEpoch = next;
  return next;
}

export function isSessionEpoch(db, epoch) {
  return getSessionEpoch(db) === epoch;
}

export function invalidateEpochCache() {
  cachedEpoch = null;
}
