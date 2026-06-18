import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { USA_TARGET_UNIVERSITIES } from './usaTargetUniversities.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = resolve(__dir, '../../data/usa_universities_catalog.json');

let cached = null;

/** Full USA pool (500+) — built catalog with per-school strengths from User_Majors file. */
export function getUsaTargetUniversities() {
  if (cached) return cached;

  if (existsSync(CATALOG_PATH)) {
    try {
      const data = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
      if (Array.isArray(data.universities) && data.universities.length >= 100) {
        cached = data.universities;
        return cached;
      }
    } catch (e) {
      console.warn('[usaCatalog] Failed to load catalog JSON:', e.message);
    }
  }

  cached = USA_TARGET_UNIVERSITIES;
  return cached;
}
