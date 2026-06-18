import { buildProfessorDossier } from './index.js';
import {
  lastNameFromEmail,
  universityFromEmail,
  capitalizeWord,
} from '../utils/professor.js';

/** Last name from scraped profile or email — no web search tokens. */
export async function basicLastNameResearch(email, sourceUrl = '', profileUrl = '') {
  const university = universityFromEmail(email);
  const emailFallback = capitalizeWord(lastNameFromEmail(email));

  if (profileUrl || sourceUrl) {
    try {
      const scraped = await buildProfessorDossier({
        email,
        profile_url: profileUrl || '',
        source_url: sourceUrl || '',
      });
      const ln = capitalizeWord(String(scraped?.last_name || '').trim());
      if (ln.length >= 2) {
        return {
          email,
          last_name: ln,
          name: scraped.name || ln,
          university: scraped.university || university,
          research_areas: scraped.research_areas || [],
          papers: scraped.papers || [],
          profile_url: scraped.profile_url || profileUrl || '',
          verified: true,
          research_source: scraped.research_source || 'profile_data',
          email_verified: scraped.email_verified !== false,
        };
      }
    } catch (e) {
      console.error(`[BasicLastName] Profile scrape failed for ${email}:`, e.message);
    }
  }

  if (emailFallback.length >= 2) {
    return {
      email,
      last_name: emailFallback,
      name: emailFallback,
      university,
      verified: true,
      research_source: 'basic_lastname_email',
      email_verified: false,
    };
  }

  return {
    email,
    last_name: '',
    name: '',
    university,
    verified: false,
    research_source: 'basic_lastname_failed',
    email_verified: false,
  };
}

export function hasBasicLastName(dossier) {
  if (!dossier) return false;
  const d = typeof dossier === 'string' ? JSON.parse(dossier) : dossier;
  return !!(d.last_name && d.last_name.length >= 2);
}
