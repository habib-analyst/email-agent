#!/usr/bin/env node
/** Wipe all outreach data and re-seed templates — keeps Gmail tokens and settings. */
import db from '../src/db/index.js';
import { performFullReset, verifySessionCleared, isSessionCleared } from '../src/db/resetSession.js';

try {
  const { epoch, counts } = performFullReset(db);
  const cleared = isSessionCleared(db);
  console.log(JSON.stringify({ success: true, sessionEpoch: epoch, counts, cleared }, null, 2));
  if (!cleared) {
    console.error('Warning: some tables still have rows:', verifySessionCleared(db));
    process.exit(1);
  }
} catch (e) {
  console.error(JSON.stringify({ success: false, error: e.message }));
  process.exit(1);
}
