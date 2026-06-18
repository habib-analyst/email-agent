/** Allow same email in instant vs basic_instant (unique on email + mode). */
export function migrateProfessorsEmailMode(db) {
  try {
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='professors'").get();
    if (!row?.sql) return;

    const sql = row.sql;
    const hasCompositeUnique = sql.includes('UNIQUE(email, mode)') || sql.includes('UNIQUE (email, mode)');
    const hasEmailOnlyUnique = /email TEXT UNIQUE/i.test(sql) && !hasCompositeUnique;

    if (hasCompositeUnique) return;

    if (!hasEmailOnlyUnique) {
      try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_professors_email_mode ON professors(email, mode)'); } catch {}
      return;
    }

    console.log('[DB] Migrating professors → UNIQUE(email, mode)');

    db.exec(`
      CREATE TABLE IF NOT EXISTS professors_migrated (
        id INTEGER PRIMARY KEY,
        email TEXT NOT NULL,
        last_name TEXT,
        university TEXT,
        research_areas TEXT,
        dossier TEXT,
        source_url TEXT,
        mode TEXT NOT NULL DEFAULT 'instant',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        verified_name TEXT,
        name_source TEXT,
        name_verified INTEGER DEFAULT 0,
        name_mismatch TEXT,
        UNIQUE(email, mode)
      );

      INSERT OR IGNORE INTO professors_migrated
        (id, email, last_name, university, research_areas, dossier, source_url, mode, created_at,
         verified_name, name_source, name_verified, name_mismatch)
      SELECT id, email, last_name, university, research_areas, dossier, source_url,
             COALESCE(mode, 'instant'), created_at,
             verified_name, name_source, name_verified, name_mismatch
      FROM professors;

      DROP TABLE professors;
      ALTER TABLE professors_migrated RENAME TO professors;

      CREATE INDEX IF NOT EXISTS idx_professors_email ON professors(email);
      CREATE INDEX IF NOT EXISTS idx_professors_mode ON professors(mode);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_professors_email_mode ON professors(email, mode);
    `);

    console.log('[DB] professors migration complete');
  } catch (e) {
    console.error('[DB] professors migration failed:', e.message);
  }
}
