import db from '../db/index.js';
import { basicLastNameResearch, hasBasicLastName } from '../research/basicLastNameResearch.js';
import { extractAccurateKeywords, keywordsFromProfileOnly, isGenericKeyword } from '../ai/index.js';
import { formatGreetingLastName } from '../utils/professor.js';
import { stripInterestFromHtml, buildBasicOutreachSubject } from '../gmail/basicTemplate.js';

function buildBasicPreviewHtml(rawHtml, lastName) {
  if (!rawHtml) return '';
  return stripInterestFromHtml(rawHtml)
    .replace(/\{\{LAST_NAME\}\}/g, formatGreetingLastName(lastName));
}

function hasUsefulData(dossier) {
  if (!dossier?.last_name || dossier.last_name.length < 2) return false;
  return (dossier.research_areas?.length > 0) || (dossier.papers?.length > 0) || (dossier.department?.length > 3);
}

/** Draft one professor for basic_scheduled batch — last name + optional subject mode. */
export async function draftBasicScheduledProfessor(prof, tpl, subjectMode = 'fixed') {
  let lastName = prof.last_name;
  let dossier = prof.dossier ? JSON.parse(prof.dossier) : null;
  let subjectKeyword = '';

  if (subjectMode === 'search') {
    try {
      const scrapedProfileSources = new Set(['profile_data', 'profile_verified', 'directory_card', 'json_ld']);
      const hasScrapedKeywords = dossier && (
        scrapedProfileSources.has(dossier.research_source)
        || (dossier.research_areas?.length >= 1 && dossier.research_evidence)
      );

      if (!hasScrapedKeywords) {
        if (dossier?.research_areas?.length || dossier?.papers?.length) {
          const fromProfile = keywordsFromProfileOnly(dossier);
          if (fromProfile?.subject_keyword && !isGenericKeyword(fromProfile.subject_keyword)) {
            subjectKeyword = fromProfile.subject_keyword;
          } else {
            const kw = await extractAccurateKeywords(dossier, dossier.papers || [], (dossier.research_areas || []).join(', '));
            if (kw.subject_keyword && !kw.error && !isGenericKeyword(kw.subject_keyword)) {
              subjectKeyword = kw.subject_keyword;
            }
          }
        }
        if (!subjectKeyword) {
          return { needsWebResearch: true, prof };
        }
      }

      if (dossier?.last_name) lastName = dossier.last_name;
      const canExtractKw = hasUsefulData(dossier) || hasScrapedKeywords || (dossier?.research_areas?.length >= 1);
      if (canExtractKw && hasScrapedKeywords && !subjectKeyword) {
        const kw = await extractAccurateKeywords(dossier, dossier.papers || [], (dossier.research_areas || []).join(', '));
        if (kw.subject_keyword && !kw.error && !isGenericKeyword(kw.subject_keyword)) {
          subjectKeyword = kw.subject_keyword;
        }
      }
      if (dossier) {
        db.prepare('UPDATE scheduled_professors SET dossier=?, last_name=?, research_areas=?, university=COALESCE(NULLIF(university,\'\'), ?) WHERE id=?').run(
          JSON.stringify(dossier),
          lastName,
          (dossier.research_areas || []).join(', '),
          dossier.university || '',
          prof.id,
        );
      }
    } catch (e) {
      console.error(`[Scheduler:Basic] Keyword research failed for ${prof.email}:`, e.message);
    }
  }

  if (!hasBasicLastName({ last_name: lastName })) {
    try {
      const nameDossier = await basicLastNameResearch(prof.email, prof.source_url || '', dossier?.profile_url || '');
      lastName = nameDossier.last_name;
      db.prepare('UPDATE scheduled_professors SET last_name=?, dossier=?, university=COALESCE(NULLIF(university,\'\'), ?) WHERE id=?').run(
        lastName,
        JSON.stringify({ ...(dossier || {}), ...nameDossier }),
        nameDossier.university || dossier?.university || '',
        prof.id,
      );
    } catch (e) {
      return { error: 'Last name mandatory — could not verify professor surname', prof };
    }
  }

  if (!hasBasicLastName({ last_name: lastName })) {
    return { error: 'Last name mandatory — could not verify professor surname', prof };
  }

  const subject = buildBasicOutreachSubject(subjectMode, subjectKeyword);
  const htmlPreview = buildBasicPreviewHtml(tpl?.raw_html, lastName);

  prof.last_name = lastName;
  return { prof, subject, interestLine: '', htmlPreview };
}
