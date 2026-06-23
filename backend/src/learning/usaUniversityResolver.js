import { getUsaTargetUniversities } from './usaCatalog.js';

const DOMAIN_ALIASES = new Map([
  ['msu.edu', { name: 'Michigan State University', state: 'Michigan' }],
  ['arizona.edu', { name: 'University of Arizona', state: 'Arizona' }],
  ['caltech.edu', { name: 'California Institute of Technology', state: 'California' }],
  ['txstate.edu', { name: 'Texas State University', state: 'Texas' }],
  ['tamu.edu', { name: 'Texas A&M University', state: 'Texas' }],
  ['fau.edu', { name: 'Florida Atlantic University', state: 'Florida' }],
  ['utexas.edu', { name: 'University of Texas at Austin', state: 'Texas' }],
  ['berkeley.edu', { name: 'UC Berkeley', state: 'California' }],
  ['mtu.edu', { name: 'Michigan Technological University', state: 'Michigan' }],
  ['asu.edu', { name: 'Arizona State University', state: 'Arizona' }],
  ['ufl.edu', { name: 'University of Florida', state: 'Florida' }],
  ['sfsu.edu', { name: 'San Francisco State University', state: 'California' }],
  ['umich.edu', { name: 'University of Michigan', state: 'Michigan' }],
  ['floridapoly.edu', { name: 'Florida Polytechnic University', state: 'Florida' }],
  ['ttu.edu', { name: 'Texas Tech University', state: 'Texas' }],
  ['fit.edu', { name: 'Florida Institute of Technology', state: 'Florida' }],
  ['uta.edu', { name: 'The University of Texas at Arlington', state: 'Texas' }],
  ['usfca.edu', { name: 'University of San Francisco', state: 'California' }],
  ['mst.edu', { name: 'Missouri University of Science and Technology', state: 'Missouri' }],
  ['mit.edu', { name: 'Massachusetts Institute of Technology', state: 'Massachusetts' }],
  ['cornell.edu', { name: 'Cornell University', state: 'New York' }],
  ['upenn.edu', { name: 'University of Pennsylvania', state: 'Pennsylvania' }],
  ['northwestern.edu', { name: 'Northwestern University', state: 'Illinois' }],
  ['vanderbilt.edu', { name: 'Vanderbilt University', state: 'Tennessee' }],
  ['wustl.edu', { name: 'Washington University in St. Louis', state: 'Missouri' }],
  ['stanford.edu', { name: 'Stanford University', state: 'California' }],
  ['harvard.edu', { name: 'Harvard University', state: 'Massachusetts' }],
  ['yale.edu', { name: 'Yale University', state: 'Connecticut' }],
  ['princeton.edu', { name: 'Princeton University', state: 'New Jersey' }],
  ['columbia.edu', { name: 'Columbia University', state: 'New York' }],
  ['gatech.edu', { name: 'Georgia Institute of Technology', state: 'Georgia' }],
  ['ucla.edu', { name: 'University of California Los Angeles', state: 'California' }],
  ['sfbu.edu', { name: 'San Francisco Bay University', state: 'California' }],
  ['ucmo.edu', { name: 'University of Central Missouri', state: 'Missouri' }],
]);

const ACADEMIC_SUBDOMAINS = new Set([
  'cs', 'cse', 'ece', 'ee', 'eng', 'engineering', 'faculty', 'math', 'med',
  'medicine', 'research', 'science', 'staff', 'www', 'mail',
]);

function normalizeToken(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function domainParts(email) {
  const domain = String(email || '').split('@')[1]?.toLowerCase().trim() || '';
  if (!domain.endsWith('.edu')) return { domain, tokens: [] };
  const labels = domain.split('.').filter(Boolean);
  const tokens = labels
    .slice(0, -1)
    .filter(label => !ACADEMIC_SUBDOMAINS.has(label))
    .map(normalizeToken)
    .filter(token => token.length >= 3);
  return { domain, tokens: [...new Set(tokens.reverse())] };
}

let catalogTokenIndex = null;

function getCatalogTokenIndex() {
  if (catalogTokenIndex) return catalogTokenIndex;
  const index = new Map();
  const add = (token, university) => {
    if (!token || token.length < 4) return;
    if (!index.has(token)) index.set(token, new Set());
    index.get(token).add(university);
  };

  for (const entry of getUsaTargetUniversities()) {
    const name = normalizeToken(entry.name);
    add(name, entry.name);
    for (const hint of entry.hints || []) add(normalizeToken(hint), entry.name);
  }
  catalogTokenIndex = index;
  return index;
}

export function resolveUsaUniversityDetailsFromEmail(email) {
  const { domain, tokens } = domainParts(email);
  if (!domain.endsWith('.edu')) return null;

  for (const [suffix, university] of DOMAIN_ALIASES) {
    if (domain === suffix || domain.endsWith(`.${suffix}`)) return university;
  }

  const index = getCatalogTokenIndex();
  for (const token of tokens) {
    const matches = index.get(token);
    if (matches?.size === 1) {
      const name = [...matches][0];
      const state = getUsaTargetUniversities().find(entry => entry.name === name)?.state || 'Unknown';
      return { name, state };
    }
  }
  return null;
}

export function resolveUsaUniversityFromEmail(email) {
  return resolveUsaUniversityDetailsFromEmail(email)?.name || null;
}
